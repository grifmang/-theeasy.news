const { openStore, migrate } = require('../storage');
const { scrapeFeeds, openIngestionStore } = require('../scrape');
jest.mock('node-cron', () => ({ schedule: jest.fn(() => ({ stop: jest.fn() })) }));
const cron = require('node-cron');
const { createCycle, startScheduler } = require('../scheduler');

const feed = { source: 'example', url: 'https://example.com/feed' };
const item = { title: 'Headline', link: '/story', contentSnippet: 'Source evidence', isoDate: '2026-09-20T12:00:00Z' };
let db, parser, logger, sleep;
beforeEach(() => {
  db = openStore(':memory:'); migrate(db);
  parser = { parseURL: jest.fn().mockResolvedValue({ items: [item] }) };
  logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  sleep = jest.fn().mockResolvedValue();
});
afterEach(() => db.close());
const run = options => scrapeFeeds({ db, parser, logger, sleep, feedList: [feed], ...options });

test('persists provenance and one classification job without touching legacy articles', async () => {
  db.exec('CREATE TABLE articles(id INTEGER PRIMARY KEY, content TEXT)');
  await run(); await run();
  const sources = db.prepare('SELECT * FROM source_items').all();
  expect(sources).toHaveLength(1);
  expect(sources[0]).toMatchObject({ title: 'Headline', url: 'https://example.com/story', evidence: 'Source evidence', published_at: '2026-09-20T12:00:00.000Z' });
  expect(db.prepare('SELECT * FROM rebuild_jobs').all()).toHaveLength(1);
  expect(db.prepare('SELECT stage,state,attempts FROM rebuild_jobs').get()).toEqual({ stage: 'classify', state: 'queued', attempts: 0 });
  expect(db.prepare('SELECT * FROM articles').all()).toEqual([]);
});

test('updated evidence at the same URL creates a new snapshot/job', async () => {
  await run();
  parser.parseURL.mockResolvedValue({ items: [{ ...item, contentSnippet: 'Updated facts' }] });
  await run();
  expect(db.prepare('SELECT evidence FROM source_items ORDER BY id').all()).toEqual([{ evidence: 'Source evidence' }, { evidence: 'Updated facts' }]);
  expect(db.prepare('SELECT COUNT(*) n FROM rebuild_jobs').get().n).toBe(2);
});

test('rejects malformed items individually and accepts subsequent good evidence', async () => {
  parser.parseURL.mockResolvedValue({ items: [null, { ...item, link: 'file:///secret' }, { ...item, isoDate: 'invalid' }, { ...item, contentSnippet: '' }, item] });
  expect(await run()).toEqual({ accepted: 1, rejected: 4, failedFeeds: 0 });
});

test('retries failed feeds once, continues other feeds and hides raw errors', async () => {
  parser.parseURL.mockRejectedValueOnce(new Error('secret')).mockRejectedValueOnce(new Error('secret')).mockResolvedValue({ items: [item] });
  expect(await run({ feedList: [feed, { ...feed, source: 'other' }] })).toEqual({ accepted: 1, rejected: 0, failedFeeds: 1 });
  expect(parser.parseURL).toHaveBeenCalledTimes(3);
  expect(sleep).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
});

test('caps per-feed intake at ten items', async () => {
  parser.parseURL.mockResolvedValue({ items: Array.from({ length: 12 }, (_, index) => ({ ...item, title: 'Headline ' + index })) });
  expect((await run()).accepted).toBe(10);
});

test('missing schema fails before fetching and DB write failures propagate', async () => {
  const empty = openStore(':memory:');
  try { await expect(run({ db: empty })).rejects.toThrow('schema missing'); }
  finally { empty.close(); }
  expect(parser.parseURL).not.toHaveBeenCalled();
  db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON source_items BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
  await expect(run()).rejects.toMatchObject({ message: 'disk failure', code: 'SQLITE_CONSTRAINT_TRIGGER' });
});

test('CLI connection rejects relative paths', () => {
  expect(() => openIngestionStore('data.db')).toThrow('absolute');
});

test('scheduler stops ticks and drains active ingestion on shutdown', async () => {
  let release;
  const scrape = jest.fn(() => new Promise(resolve => { release = resolve; }));
  const stop = startScheduler({ db, scrape, logger });
  const tick = cron.schedule.mock.calls.at(-1)[1];
  tick();
  expect(scrape).toHaveBeenCalledTimes(1);
  let stopped = false;
  const shutdown = stop().then(() => { stopped = true; });
  await Promise.resolve();
  expect(stopped).toBe(false);
  release({ accepted: 1 });
  await shutdown;
  tick();
  expect(scrape).toHaveBeenCalledTimes(1);
  expect(cron.schedule.mock.results.at(-1).value.stop).toHaveBeenCalledTimes(1);
});

test('scheduler skips overlap and releases its lock after errors', async () => {
  let release;
  const scrape = jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockRejectedValueOnce(new Error('failure')).mockResolvedValue({ accepted: 1 });
  const cycle = createCycle({ db, scrape, logger });
  const pending = cycle();
  expect(await cycle()).toEqual({ skipped: true });
  release({ accepted: 1 }); await pending;
  await expect(cycle()).rejects.toThrow('failure');
  expect(await cycle()).toEqual({ accepted: 1 });
  expect(scrape).toHaveBeenCalledTimes(3);
});

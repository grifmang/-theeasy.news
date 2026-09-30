const fs = require('fs');
const os = require('os');
const path = require('path');
const { SCHEMA_VERSION, openStore, migrate, saveSource, enqueue, ingest, claim, finish } = require('../storage');

let directory, db, second;
const item = { source: 'example', url: 'https://example.com/story', title: 'Story', evidence: 'Original evidence' };
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-news-storage-'));
  db = openStore(path.join(directory, 'test.db'));
  migrate(db);
});
afterEach(() => {
  if (second?.open) second.close();
  if (db.open) db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('repeat migration preserves legacy rows and creates no fabricated evidence', () => {
  db.exec("CREATE TABLE articles(id INTEGER PRIMARY KEY, content TEXT); INSERT INTO articles VALUES(1,'legacy');");
  migrate(db);
  expect(db.prepare('SELECT content FROM articles').get().content).toBe('legacy');
  expect(db.prepare('SELECT COUNT(*) n FROM source_items').get().n).toBe(0);
  expect(db.prepare('SELECT version FROM rebuild_migrations ORDER BY version').all()).toEqual(
    Array.from({length:SCHEMA_VERSION},(_,index)=>({version:index+1})));
});

test('migration CLI backs up a legacy database before adding schema', async () => {
  const { backupAndMigrate } = require('../migrate');
  const legacyPath = path.join(directory, 'legacy.db');
  second = openStore(legacyPath);
  second.exec("CREATE TABLE articles(id INTEGER PRIMARY KEY, content TEXT); INSERT INTO articles VALUES(1,'legacy');");
  second.close();
  const backupPath = await backupAndMigrate(legacyPath, directory);
  second = openStore(backupPath);
  expect(second.prepare('SELECT content FROM articles').get().content).toBe('legacy');
  expect(second.prepare("SELECT name FROM sqlite_master WHERE name='source_items'").get()).toBeUndefined();
  second.close();
  second = openStore(legacyPath);
  expect(second.prepare('SELECT COUNT(*) n FROM source_items').get().n).toBe(0);
  expect(second.prepare('SELECT content FROM articles').get().content).toBe('legacy');
});

test('migration transaction rolls back if a schema name already conflicts', () => {
  second = openStore(':memory:');
  second.exec('CREATE TABLE source_items(existing TEXT)');
  expect(() => migrate(second)).toThrow();
  expect(second.prepare("SELECT name FROM sqlite_master WHERE name='rebuild_migrations'").get()).toBeUndefined();
});

test('evidence dedup preserves updates and different sources, forbids mutation', () => {
  const first = saveSource(db, item);
  expect(saveSource(db, item).id).toBe(first.id);
  expect(saveSource(db, { ...item, evidence: 'Updated evidence' }).id).not.toBe(first.id);
  expect(saveSource(db, { ...item, source: 'second source' }).id).not.toBe(first.id);
  expect(() => db.prepare('UPDATE source_items SET evidence=? WHERE id=?').run('tampered', first.id)).toThrow('immutable');
  expect(() => db.prepare('DELETE FROM source_items WHERE id=?').run(first.id)).toThrow('immutable');
});

test('invalid evidence and credential URLs are rejected', () => {
  expect(() => saveSource(db, { ...item, evidence: '' })).toThrow();
  expect(() => saveSource(db, { ...item, url: 'file:///private' })).toThrow();
  expect(() => saveSource(db, { ...item, url: 'https://user:password@example.com' })).toThrow();
});

test('ingestion atomically creates one job; invalid policy rolls back evidence', () => {
  expect(() => ingest(db, item, '')).toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM source_items').get().n).toBe(0);
  const first = ingest(db, item, 'v1');
  expect(ingest(db, item, 'v1').job.id).toBe(first.job.id);
  expect(() => enqueue(db, 999, 'classify', 'v1')).toThrow();
});

test('two connections cannot claim one live lease; stale worker cannot finish', () => {
  ingest(db, item, 'v1');
  second = openStore(path.join(directory, 'test.db'));
  const old = claim(db, { stage: 'classify', now: 100, leaseMs: 10 });
  expect(claim(second, { stage: 'classify', now: 101 })).toBeNull();
  const replacement = claim(second, { stage: 'classify', now: 110, leaseMs: 10 });
  expect(replacement.attempts).toBe(2);
  expect(finish(db, old, { now: 111 })).toBe(false);
  expect(finish(second, replacement, { now: 111 })).toBe(true);
  expect(claim(db, { stage: 'classify', now: 200 })).toBeNull();
});

test('retry schedule and crash recovery respect attempt cap across reopen', () => {
  const source = saveSource(db, item);
  enqueue(db, source.id, 'classify', 'v1', 2);
  const first = claim(db, { stage: 'classify', now: 100 });
  expect(finish(db, first, { now: 101, error: 'timeout', retryAt: 200 })).toBe(true);
  expect(claim(db, { stage: 'classify', now: 199 })).toBeNull();
  db.close();
  db = openStore(path.join(directory, 'test.db'));
  const final = claim(db, { stage: 'classify', now: 200, leaseMs: 10 });
  expect(final.attempts).toBe(2);
  expect(claim(db, { stage: 'classify', now: 210 })).toBeNull();
  expect(db.prepare('SELECT state FROM rebuild_jobs').get().state).toBe('exhausted');
});

test('SQLite backup restores evidence and pending jobs', async () => {
  ingest(db, item, 'v1');
  const backupPath = path.join(directory, 'backup.db');
  await db.backup(backupPath);
  second = openStore(backupPath);
  migrate(second);
  expect(second.prepare('SELECT evidence FROM source_items').get().evidence).toBe(item.evidence);
  expect(claim(second, { stage: 'classify' }).attempts).toBe(1);
});

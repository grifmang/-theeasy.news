const Parser = require('rss-parser');
const path = require('path');
const fs = require('fs');
const { openStore, ingest } = require('./storage');

// Existing feed configuration; availability must be verified before deployment.
const feeds = [
  { url: 'https://rss.cnn.com/rss/cnn_topstories.rss', source: 'cnn.com' },
  { url: 'https://apnews.com/apf-topnews?output=rss', source: 'apnews.com' },
  { url: 'https://feeds.foxnews.com/foxnews/latest', source: 'foxnews.com' },
  { url: 'https://feeds.npr.org/1001/rss.xml', source: 'npr.org' }
];

function normalizeItem(item, feed) {
  if (!item || typeof item !== 'object') throw new Error('invalid_item');
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const evidence = [item.contentSnippet, item.content]
    .find(value => typeof value === 'string' && value.trim());
  if (!title || title.length > 2000 || !evidence || evidence.length > 32000) {
    throw new Error('invalid_evidence');
  }
  if (typeof item.link !== 'string' || !item.link.trim()) throw new Error('missing_source_url');
  const url = new URL(item.link, feed.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('invalid_source_url');
  }
  // Article links are stored as provenance, never fetched by this module.
  const date = item.isoDate || item.pubDate;
  const publishedAt = date ? new Date(date).toISOString() : null;
  return { source: feed.source, url: url.href, title, evidence, publishedAt };
}

function assertSchema(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='rebuild_migrations'").get()
      || !db.prepare('SELECT version FROM rebuild_migrations WHERE version=1').get()) {
    throw new Error('Rebuild schema missing; run the backup-first migration command');
  }
  db.prepare('SELECT id FROM source_items LIMIT 0').all();
  db.prepare('SELECT id FROM rebuild_jobs LIMIT 0').all();
}

async function scrapeFeeds({ db, parser = new Parser({ timeout: 10000 }),
  feedList = feeds, policyVersion = 'rss-classification-v1',
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), logger = console } = {}) {
  if (!db) throw new Error('Explicit database connection is required');
  if (typeof policyVersion !== 'string' || !policyVersion.trim()) throw new Error('policyVersion is required');
  assertSchema(db);
  const summary = { accepted: 0, rejected: 0, failedFeeds: 0 };
  for (const feed of feedList) {
    let parsed;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        parsed = await parser.parseURL(feed.url);
        if (!Array.isArray(parsed?.items)) throw new Error('invalid_feed');
        break;
      } catch {
        parsed = null;
        if (attempt === 0) await sleep(2000);
        else { summary.failedFeeds++; logger.warn('RSS feed failed', feed.source); }
      }
    }
    if (!parsed) continue;
    for (const item of parsed.items.slice(0, 10)) {
      let normalized;
      try { normalized = normalizeItem(item, feed); }
      catch { summary.rejected++; continue; }
      // Storage failures are fatal, not mislabeled as bad feed items.
      ingest(db, normalized, policyVersion);
      summary.accepted++;
    }
  }
  // Accepted counts validated deliveries, including idempotent repeats.
  logger.log('RSS ingestion complete', summary);
  return summary;
}

function openIngestionStore(filename = process.env.DB_PATH) {
  if (!filename || !path.isAbsolute(filename) || !fs.existsSync(filename)) {
    throw new Error('DB_PATH must name an existing absolute database path');
  }
  const db = openStore(filename);
  try { assertSchema(db); return db; }
  catch (error) { db.close(); throw error; }
}

async function main() {
  const db = openIngestionStore();
  try {
    const summary = await scrapeFeeds({ db });
    if (summary.failedFeeds) process.exitCode = 1;
  } finally { db.close(); }
}

module.exports = { scrapeFeeds, normalizeItem, openIngestionStore };
if (require.main === module) main().catch(() => {
  console.error('RSS ingestion failed; check DB_PATH, migration, and storage availability');
  process.exitCode = 1;
});

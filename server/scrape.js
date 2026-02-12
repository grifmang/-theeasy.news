const Parser = require('rss-parser');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const parser = new Parser();
const dbPath = process.env.DB_PATH || 'data.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

const feeds = [
  { url: 'https://rss.cnn.com/rss/cnn_topstories.rss', source: 'cnn.com', category: 'top' },
  { url: 'https://apnews.com/apf-topnews?output=rss', source: 'apnews.com', category: 'top' },
  { url: 'https://feeds.foxnews.com/foxnews/latest', source: 'foxnews.com', category: 'top' },
  { url: 'https://feeds.npr.org/1001/rss.xml', source: 'npr.org', category: 'top' }
];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function parseFeedWithRetry(url) {
  try {
    return await parser.parseURL(url);
  } catch (err) {
    console.warn(`Feed ${url} failed, retrying in 2s...`, err.message);
    await delay(2000);
    return await parser.parseURL(url);
  }
}

async function scrapeFeeds() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO articles (title, content, author, source, category) VALUES (?, ?, ?, ?, ?)'
  );

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const feedInfo of feeds) {
    try {
      const feed = await parseFeedWithRetry(feedInfo.url);
      const items = feed.items.slice(0, 10);
      let feedInserted = 0;
      let feedSkipped = 0;

      items.forEach(item => {
        const snippet = item.contentSnippet || item.content || '';
        const category = (item.categories && item.categories[0]) || feedInfo.category;
        const result = insert.run(item.title, snippet, 'RSS', feedInfo.source, category);
        if (result.changes > 0) {
          feedInserted++;
        } else {
          feedSkipped++;
        }
      });

      totalInserted += feedInserted;
      totalSkipped += feedSkipped;
      console.log(`Scraped ${feedInfo.source}: ${feedInserted} inserted, ${feedSkipped} skipped (${items.length} items)`);
    } catch (err) {
      console.error('Failed to scrape', feedInfo.url, err.message);
    }
  }

  console.log(`Scrape complete: ${totalInserted} total inserted, ${totalSkipped} total skipped`);
}

module.exports = { scrapeFeeds };

if (require.main === module) {
  scrapeFeeds().catch(err => {
    console.error('Scrape failed', err);
  });
}

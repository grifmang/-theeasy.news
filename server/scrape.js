const Parser = require('rss-parser');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const parser = new Parser();
const dbPath = process.env.DB_PATH || 'data.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

const feeds = [
  { url: 'http://rss.cnn.com/rss/cnn_topstories.rss', source: 'cnn.com', category: 'top' },
  { url: 'https://apnews.com/apf-topnews?output=rss', source: 'apnews.com', category: 'top' },
  { url: 'http://feeds.foxnews.com/foxnews/latest', source: 'foxnews.com', category: 'top' },
  { url: 'https://feeds.npr.org/1001/rss.xml', source: 'npr.org', category: 'top' }
];

async function scrapeFeeds() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO articles (title, content, author, source, category) VALUES (?, ?, ?, ?, ?)'
  );

  for (const feedInfo of feeds) {
    try {
      const feed = await parser.parseURL(feedInfo.url);
      feed.items.slice(0, 10).forEach(item => {
        const snippet = item.contentSnippet || item.content || '';
        const category = (item.categories && item.categories[0]) || feedInfo.category;
        insert.run(item.title, snippet, 'RSS', feedInfo.source, category);
      });
      console.log('Scraped', feedInfo.source, feed.items.length, 'items');
    } catch (err) {
      console.error('Failed to scrape', feedInfo.url, err.message);
    }
  }
}

module.exports = { scrapeFeeds };

if (require.main === module) {
  scrapeFeeds().catch(err => {
    console.error('Scrape failed', err);
  });
}

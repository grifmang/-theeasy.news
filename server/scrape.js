const Parser = require('rss-parser');
const Database = require('better-sqlite3');

const parser = new Parser();
const dbPath = process.env.DB_PATH || 'data.db';
const db = new Database(dbPath);

async function scrape() {
  const feed = await parser.parseURL('https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml');
  const insert = db.prepare('INSERT OR IGNORE INTO articles (title, content, author) VALUES (?, ?, ?)');
  feed.items.slice(0, 10).forEach(item => {
    insert.run(item.title, item.contentSnippet || item.content || '', 'RSS');
  });
  console.log('Scraped', feed.items.length, 'items');
}

scrape().catch(err => {
  console.error('Scrape failed', err);
});

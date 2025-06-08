const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

// Mock rss-parser so no network calls are made
jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({
    parseURL: jest.fn(() =>
      Promise.resolve({
        items: [
          {
            title: 'Example headline',
            contentSnippet: 'snippet',
            categories: ['test']
          }
        ]
      })
    )
  }));
});


function initDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    source TEXT,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  return db;
}

describe('scrapeFeeds', () => {
  test('inserts articles into the database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-'));
    const dbPath = path.join(dir, 'data.db');
    process.env.DB_PATH = dbPath;
    const db = initDb(dbPath);

    jest.resetModules();
    const { scrapeFeeds } = require('../scrape');

    await scrapeFeeds();

    const rows = db.prepare('SELECT * FROM articles').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].title).toBe('Example headline');
    expect(rows[0].author).toBe('RSS');
  });
});

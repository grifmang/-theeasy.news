const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const API_KEY = process.env.NEWS_API_KEY;
if (!API_KEY) {
  console.error('NEWS_API_KEY env var not set');
  process.exit(1);
}

const DB_PATH = path.join(__dirname, '../server/data.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new sqlite3.Database(DB_PATH);

async function fetchArticles() {
  const url = `https://newsapi.org/v2/top-headlines?country=us&pageSize=5&apiKey=${API_KEY}`;
  const { data } = await axios.get(url);
  return data.articles || [];
}

function storeArticle(a) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO source_articles (url, title, content, published_at, genre) VALUES (?,?,?,?,?)'
  );
  stmt.run(
    a.url,
    a.title,
    a.content || a.description || '',
    a.publishedAt,
    a.source && a.source.name ? a.source.name : 'general'
  );
  stmt.finalize();
}

async function run() {
  try {
    const articles = await fetchArticles();
    articles.forEach(storeArticle);
    console.log(`Fetched ${articles.length} articles`);
  } catch (err) {
    console.error('Failed to fetch articles', err.message);
  } finally {
    db.close();
  }
}

run();

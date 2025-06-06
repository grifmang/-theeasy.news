const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');

const db = new Database('data.db');

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS saved_articles (
  user_id INTEGER,
  article_id INTEGER,
  PRIMARY KEY(user_id, article_id)
);
CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  persona TEXT NOT NULL,
  prompt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_title ON articles(title);`);

// Ensure older databases have the persona column
const authorCols = db.prepare('PRAGMA table_info(authors)').all();
if (!authorCols.some(c => c.name === 'persona')) {
  db.exec('ALTER TABLE authors ADD COLUMN persona TEXT DEFAULT ""');
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const stmt = db.prepare('SELECT * FROM users WHERE username=? AND password=?');
  const user = stmt.get(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ message: 'Logged in', userId: user.id });
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const info = stmt.run(username, password);
    res.json({ userId: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'User exists' });
  }
});

app.get('/api/articles', (req, res) => {
  const stmt = db.prepare('SELECT * FROM articles ORDER BY created_at DESC');
  const articles = stmt.all();
  res.json({ articles });
});

app.post('/api/articles', (req, res) => {
  const { title, content, author } = req.body;
  if (!title || !content || !author) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const stmt = db.prepare('INSERT INTO articles (title, content, author) VALUES (?, ?, ?)');
  const info = stmt.run(title, content, author);
  res.json({ articleId: info.lastInsertRowid });
});

app.post('/api/save', (req, res) => {
  const { userId, articleId } = req.body;
  if (!userId || !articleId) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const stmt = db.prepare('INSERT OR IGNORE INTO saved_articles (user_id, article_id) VALUES (?, ?)');
  stmt.run(userId, articleId);
  res.json({ message: 'Saved' });
});

app.get('/api/user/:userId/saved', (req, res) => {
  const { userId } = req.params;
  const stmt = db.prepare(
    `SELECT articles.* FROM articles JOIN saved_articles ON articles.id = saved_articles.article_id WHERE saved_articles.user_id = ?`
  );
  const saved = stmt.all(userId);
  res.json({ articles: saved });
});

app.post('/api/authors', (req, res) => {
  const { name, persona, prompt } = req.body;
  if (!name || !persona || !prompt) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const stmt = db.prepare('INSERT INTO authors (name, persona, prompt) VALUES (?, ?, ?)');
    const info = stmt.run(name, persona, prompt);
    res.json({ authorId: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'Author exists' });
  }
});

app.get('/api/authors', (req, res) => {
  const authors = db.prepare('SELECT * FROM authors').all();
  res.json({ authors });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('Server running on', PORT));

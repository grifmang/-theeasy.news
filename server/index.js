const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || 'data.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const oauthClient = googleClientId ? new OAuth2Client(googleClientId) : null;

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
  source TEXT,
  category TEXT,
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

// Ensure newer columns exist on articles table
const articleCols = db.prepare('PRAGMA table_info(articles)').all();
if (!articleCols.some(c => c.name === 'source')) {
  db.exec('ALTER TABLE articles ADD COLUMN source TEXT');
}
if (!articleCols.some(c => c.name === 'category')) {
  db.exec('ALTER TABLE articles ADD COLUMN category TEXT');
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const stmt = db.prepare('SELECT * FROM users WHERE username=?');
  const user = stmt.get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
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
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const info = stmt.run(username, hash);
    res.json({ userId: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'User exists' });
  }
});

app.post('/api/google-login', async (req, res) => {
  if (!oauthClient) {
    return res.status(500).json({ error: 'Google login not configured' });
  }
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: googleClientId });
    const payload = ticket.getPayload();
    const email = payload && payload.email;
    if (!email) {
      return res.status(400).json({ error: 'Invalid token' });
    }
    let user = db.prepare('SELECT * FROM users WHERE username=?').get(email);
    if (!user) {
      const info = db.prepare('INSERT INTO users (username, password) VALUES (?, "")').run(email);
      user = { id: info.lastInsertRowid };
    }
    res.json({ userId: user.id });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/articles', (req, res) => {
  const { category } = req.query;
  let articles;
  if (category) {
    const stmt = db.prepare(
      'SELECT * FROM articles WHERE category = ? ORDER BY created_at DESC'
    );
    articles = stmt.all(category);
  } else {
    const stmt = db.prepare('SELECT * FROM articles ORDER BY created_at DESC');
    articles = stmt.all();
  }
  res.json({ articles });
});

app.get('/api/articles/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('SELECT * FROM articles WHERE id = ?');
  const article = stmt.get(id);
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }
  res.json({ article });
});

app.get('/api/categories', (req, res) => {
  const rows = db
    .prepare('SELECT DISTINCT category FROM articles WHERE category IS NOT NULL')
    .all();
  const categories = rows.map(r => r.category).filter(Boolean);
  res.json({ categories });
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

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');

const db = new sqlite3.Database(DB_PATH);

// initialize database tables if they don't exist
const initSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  persona_prompt TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS source_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  content TEXT,
  published_at TEXT,
  genre TEXT
);
CREATE TABLE IF NOT EXISTS generated_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ai_author_id INTEGER,
  source_article_id INTEGER,
  title TEXT,
  body TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS saved_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  article_id INTEGER,
  saved_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

// execute initialization SQL statements
initSql.split(';').forEach(stmt => {
  const s = stmt.trim();
  if (s) db.run(s);
});

// seed demo data if database empty
db.get('SELECT COUNT(*) as c FROM ai_authors', (err, row) => {
  if (row && row.c === 0) {
    db.run("INSERT INTO ai_authors (name, persona_prompt) VALUES ('DailyBot','Write concise news summaries');");
    db.run("INSERT INTO generated_articles (ai_author_id, title, body) VALUES (1,'Demo Article','This is a demo article body.');");
  }
});

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/register', (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const stmt = db.prepare('INSERT INTO users (email, password, display_name) VALUES (?, ?, ?)');
  stmt.run(email, password, displayName || null, function(err) {
    if (err) return res.status(400).json({ error: 'user exists' });
    res.json({ id: this.lastID });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT id FROM users WHERE email = ? AND password = ?', [email, password], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'invalid credentials' });
    res.json({ id: row.id });
  });
});

app.get('/api/articles', (req, res) => {
  db.all('SELECT * FROM generated_articles ORDER BY created_at DESC LIMIT 20', (err, rows) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json(rows);
  });
});

app.post('/api/save', (req, res) => {
  const { userId, articleId } = req.body;
  if (!userId || !articleId) return res.status(400).json({ error: 'missing params' });
  const stmt = db.prepare('INSERT INTO saved_articles (user_id, article_id) VALUES (?, ?)');
  stmt.run(userId, articleId, function(err) {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json({ id: this.lastID });
  });
});

app.get('/api/user/:id/saved', (req, res) => {
  db.all(
    'SELECT ga.* FROM generated_articles ga JOIN saved_articles sa ON ga.id = sa.article_id WHERE sa.user_id = ? ORDER BY sa.saved_at DESC',
    [req.params.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'db error' });
      res.json(rows);
    }
  );
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

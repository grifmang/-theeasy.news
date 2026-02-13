const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || 'data.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

const googleClientId = process.env.GOOGLE_CLIENT_ID;
if (!googleClientId) {
  console.warn('WARNING: GOOGLE_CLIENT_ID is not set. Google login will be disabled.');
}
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

// --- Session token store ---
const sessions = new Map();

function createSession(userId, username) {
  const token = crypto.randomUUID();
  sessions.set(token, { userId, username });
  return token;
}

// --- Auth middleware ---
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  const session = sessions.get(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.userId = session.userId;
  next();
}

const app = express();

// --- CORS ---
const allowedOrigins = [
  'https://theeasy.news',
  'http://localhost:3000',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(bodyParser.json());

// --- Rate limiting ---
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts, try again later' } });
app.use('/api/', limiter);

app.post('/api/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const stmt = db.prepare('SELECT * FROM users WHERE username=?');
  const user = stmt.get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = createSession(user.id, user.username);
  res.json({ message: 'Logged in', userId: user.id, username: user.username, token });
});

app.post('/api/register', authLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const info = stmt.run(username, hash);
    const token = createSession(Number(info.lastInsertRowid), username);
    res.json({ userId: info.lastInsertRowid, username, token });
  } catch (err) {
    res.status(400).json({ error: 'User exists' });
  }
});

app.post('/api/google-login', authLimiter, async (req, res) => {
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
      user = { id: Number(info.lastInsertRowid), username: email };
    }
    const sessionToken = createSession(user.id, user.username || email);
    res.json({ userId: user.id, username: user.username || email, token: sessionToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/articles', (req, res) => {
  const { category, search, page: pageParam, limit: limitParam } = req.query;
  const page = Math.max(1, parseInt(pageParam, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitParam, 10) || 12));
  const offset = (page - 1) * limit;

  let articles;
  let total;

  if (search) {
    const pattern = `%${search}%`;
    total = db.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE (title LIKE ? OR content LIKE ?) AND author != "RSS"'
    ).get(pattern, pattern).count;
    articles = db.prepare(
      'SELECT * FROM articles WHERE (title LIKE ? OR content LIKE ?) AND author != "RSS" ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(pattern, pattern, limit, offset);
  } else if (category) {
    total = db.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE category = ? AND author != "RSS"'
    ).get(category).count;
    articles = db.prepare(
      'SELECT * FROM articles WHERE category = ? AND author != "RSS" ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(category, limit, offset);
  } else {
    total = db.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE author != "RSS"'
    ).get().count;
    articles = db.prepare(
      'SELECT * FROM articles WHERE author != "RSS" ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);
  }

  const totalPages = Math.ceil(total / limit);
  res.json({ articles, total, page, totalPages });
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

app.post('/api/articles', authMiddleware, (req, res) => {
  const { title, content, author } = req.body;
  if (!title || !content || !author) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const stmt = db.prepare('INSERT INTO articles (title, content, author) VALUES (?, ?, ?)');
  const info = stmt.run(title, content, author);
  res.json({ articleId: info.lastInsertRowid });
});

app.post('/api/save', authMiddleware, (req, res) => {
  const { articleId } = req.body;
  const userId = req.userId;
  if (!articleId) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  const stmt = db.prepare('INSERT OR IGNORE INTO saved_articles (user_id, article_id) VALUES (?, ?)');
  stmt.run(userId, articleId);
  res.json({ message: 'Saved' });
});

app.get('/api/user/:userId/saved', authMiddleware, (req, res) => {
  const { userId } = req.params;
  const stmt = db.prepare(
    `SELECT articles.* FROM articles JOIN saved_articles ON articles.id = saved_articles.article_id WHERE saved_articles.user_id = ?`
  );
  const saved = stmt.all(userId);
  res.json({ articles: saved });
});

app.post('/api/authors', authMiddleware, (req, res) => {
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

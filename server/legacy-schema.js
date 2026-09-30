function migrateLegacy(db) {
return db.transaction(() => {
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
`);

// Ensure older databases have the persona column
const authorCols = db.prepare('PRAGMA table_info(authors)').all();
if (!authorCols.some(c => c.name === 'persona')) {
  db.exec('ALTER TABLE authors ADD COLUMN persona TEXT');
}

// Ensure newer columns exist on articles table
const articleCols = db.prepare('PRAGMA table_info(articles)').all();
for (const column of ['title','content','author','source','category','created_at']) {
  if (!articleCols.some(c => c.name === column)) db.exec(`ALTER TABLE articles ADD COLUMN ${column} TEXT`);
}
// Missing historic metadata stays NULL; do not invent titles, authors or dates.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_title ON articles(title)');


}).immediate();
}
module.exports = {migrateLegacy};

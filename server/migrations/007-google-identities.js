function migrateGoogleIdentities(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=7').get()) return;
  db.exec(`CREATE TABLE google_identities (
    subject TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); INSERT INTO rebuild_migrations(version) VALUES(7);`);
}
module.exports={migrateGoogleIdentities};

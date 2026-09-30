function migrateAuth(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=6').get()) return;
  db.exec(`
    CREATE TABLE user_roles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      role TEXT NOT NULL CHECK(role IN ('reader','editor'))
    );
    CREATE TABLE auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, idle_expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
    );
    CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
    INSERT INTO rebuild_migrations(version) VALUES(6);
  `);
}
module.exports={migrateAuth};

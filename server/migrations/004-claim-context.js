function migrateClaimContext(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=4').get()) return;
  db.exec(`
    CREATE TABLE claim_context_versions (
      id INTEGER PRIMARY KEY, claim_id INTEGER NOT NULL REFERENCES research_claims(id),
      actor_id INTEGER NOT NULL REFERENCES users(id), normalized_wording TEXT NOT NULL,
      observed_at TEXT, entities_json TEXT NOT NULL, timeframe TEXT NOT NULL,
      location TEXT NOT NULL, reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX claim_context_history ON claim_context_versions(claim_id,id);
    CREATE TRIGGER claim_context_no_update BEFORE UPDATE ON claim_context_versions
      BEGIN SELECT RAISE(ABORT, 'claim context is append-only'); END;
    CREATE TRIGGER claim_context_no_delete BEFORE DELETE ON claim_context_versions
      BEGIN SELECT RAISE(ABORT, 'claim context is append-only'); END;
    INSERT INTO rebuild_migrations(version) VALUES(4);
  `);
}
module.exports = { migrateClaimContext };

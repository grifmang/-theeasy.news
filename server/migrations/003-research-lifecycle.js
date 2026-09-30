function migrateLifecycle(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=3').get()) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL, password TEXT NOT NULL
    );
    CREATE TABLE claim_events (
      id INTEGER PRIMARY KEY,
      claim_id INTEGER NOT NULL REFERENCES research_claims(id),
      actor_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('reviewed','unreviewed','restricted','restored','superseded')),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 8000),
      replacement_id INTEGER REFERENCES research_claims(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK((type='superseded' AND replacement_id IS NOT NULL AND replacement_id!=claim_id)
        OR (type!='superseded' AND replacement_id IS NULL))
    );
    CREATE INDEX claim_events_history ON claim_events(claim_id,id);
    CREATE TRIGGER claim_events_no_update BEFORE UPDATE ON claim_events
      BEGIN SELECT RAISE(ABORT, 'claim events are append-only'); END;
    CREATE TRIGGER claim_events_no_delete BEFORE DELETE ON claim_events
      BEGIN SELECT RAISE(ABORT, 'claim events are append-only'); END;
    INSERT INTO rebuild_migrations(version) VALUES(3);
  `);
}
module.exports = { migrateLifecycle };

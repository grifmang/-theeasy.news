function migrateProviderPermission(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=16').get()) return;
  db.exec(`CREATE TABLE provider_permission_events (
    id INTEGER PRIMARY KEY,job_id INTEGER NOT NULL REFERENCES claim_jobs(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),provider TEXT NOT NULL CHECK(provider='typesafe'),
    input_hash TEXT NOT NULL,allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
    reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX provider_permission_latest ON provider_permission_events(job_id,id);
  CREATE TRIGGER provider_permission_no_update BEFORE UPDATE ON provider_permission_events
    BEGIN SELECT RAISE(ABORT,'provider permission is immutable'); END;
  CREATE TRIGGER provider_permission_no_delete BEFORE DELETE ON provider_permission_events
    BEGIN SELECT RAISE(ABORT,'provider permission is immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(16);`);
}
module.exports={migrateProviderPermission};

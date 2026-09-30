function migrateProviderFailures(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=27').get()) return;
  db.exec('ALTER TABLE claim_jobs ADD COLUMN task_deadline_at INTEGER CHECK(task_deadline_at IS NULL OR task_deadline_at>=0)');
  db.exec(`CREATE TABLE model_call_failure_metadata (
    reservation_id INTEGER PRIMARY KEY REFERENCES model_reservations(id),
    observed_at_ms INTEGER NOT NULL CHECK(observed_at_ms>=0),
    provider_status INTEGER CHECK(provider_status BETWEEN 100 AND 599),
    retry_after_ms INTEGER CHECK(retry_after_ms BETWEEN 0 AND 300000),
    provider_request_id TEXT CHECK(length(provider_request_id) BETWEEN 1 AND 200),
    CHECK(provider_request_id IS NULL OR provider_request_id NOT GLOB '*[^A-Za-z0-9_.:-]*')
  );
  CREATE TRIGGER model_call_failure_metadata_no_update BEFORE UPDATE ON model_call_failure_metadata
    BEGIN SELECT RAISE(ABORT, 'provider failure metadata is immutable'); END;
  CREATE TRIGGER model_call_failure_metadata_no_delete BEFORE DELETE ON model_call_failure_metadata
    BEGIN SELECT RAISE(ABORT, 'provider failure metadata is immutable'); END;
  CREATE TABLE provider_queue_state (
    id INTEGER PRIMARY KEY CHECK(id=1),
    paused_at TEXT, reason TEXT CHECK(reason IN ('provider_auth','provider_configuration')),
    CHECK((paused_at IS NULL)=(reason IS NULL))
  );
  INSERT INTO provider_queue_state(id) VALUES(1);
  INSERT INTO rebuild_migrations(version) VALUES(27);`);
}
module.exports={migrateProviderFailures};

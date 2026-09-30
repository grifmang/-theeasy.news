function migrateClaimDecisions(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=15').get()) return;
  db.exec(`CREATE TABLE claim_decisions (
    id INTEGER PRIMARY KEY,job_id INTEGER NOT NULL UNIQUE REFERENCES claim_jobs(id),
    reservation_id INTEGER NOT NULL REFERENCES model_call_results(reservation_id),
    input_hash TEXT NOT NULL,policy_version TEXT NOT NULL,routing_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TRIGGER claim_decisions_no_update BEFORE UPDATE ON claim_decisions
    BEGIN SELECT RAISE(ABORT,'claim decision is immutable'); END;
  CREATE TRIGGER claim_decisions_no_delete BEFORE DELETE ON claim_decisions
    BEGIN SELECT RAISE(ABORT,'claim decision is immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(15);`);
}
module.exports={migrateClaimDecisions};

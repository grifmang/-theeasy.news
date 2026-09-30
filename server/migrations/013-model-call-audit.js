function migrateModelCallAudit(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=13').get()) return;
  db.exec(`CREATE TABLE model_call_attempts (
    reservation_id INTEGER PRIMARY KEY REFERENCES model_reservations(id),
    input_hash TEXT NOT NULL,model TEXT NOT NULL,question_version TEXT NOT NULL
  );
  CREATE TABLE model_call_results (
    reservation_id INTEGER PRIMARY KEY REFERENCES model_call_attempts(reservation_id),
    status TEXT NOT NULL CHECK(status IN ('succeeded','failed')),
    result_json TEXT,error_code TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK((status='succeeded' AND result_json IS NOT NULL AND error_code IS NULL) OR
      (status='failed' AND result_json IS NULL AND error_code IS NOT NULL))
  );
  INSERT INTO rebuild_migrations(version) VALUES(13);`);
  for(const table of ['model_call_attempts','model_call_results']) for(const operation of ['UPDATE','DELETE']) {
    db.exec(`CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
      BEGIN SELECT RAISE(ABORT,'model call audit is immutable'); END;`);
  }
}
module.exports={migrateModelCallAudit};

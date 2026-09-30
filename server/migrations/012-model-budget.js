function migrateModelBudget(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=12').get()) return;
  db.exec(`CREATE TABLE model_reservations (
    id INTEGER PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,category TEXT NOT NULL,
    max_micros INTEGER NOT NULL CHECK(max_micros>=0),price_version TEXT NOT NULL,
    reserved_at TEXT NOT NULL
  );
  CREATE TABLE model_settlements (
    id INTEGER PRIMARY KEY,reservation_id INTEGER NOT NULL REFERENCES model_reservations(id),
    status TEXT NOT NULL CHECK(status IN ('billed','not_billed','unknown')),
    actual_micros INTEGER CHECK(actual_micros>=0),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK((status='unknown' AND actual_micros IS NULL) OR
      (status='billed' AND actual_micros IS NOT NULL) OR (status='not_billed' AND actual_micros=0))
  );
  CREATE INDEX model_settlement_latest ON model_settlements(reservation_id,id);
  INSERT INTO rebuild_migrations(version) VALUES(12);`);
  for(const table of ['model_reservations','model_settlements']) for(const operation of ['UPDATE','DELETE']) {
    db.exec(`CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
      BEGIN SELECT RAISE(ABORT,'cost ledger is immutable'); END;`);
  }
}
module.exports={migrateModelBudget};

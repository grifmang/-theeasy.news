function migrateRoleAudit(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=8').get()) return;
  db.exec(`CREATE TABLE role_change_events (
    id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),
    previous_role TEXT NOT NULL CHECK(previous_role IN ('reader','editor')),
    new_role TEXT NOT NULL CHECK(new_role IN ('reader','editor')),
    operator TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TRIGGER role_change_no_update BEFORE UPDATE ON role_change_events
    BEGIN SELECT RAISE(ABORT,'role audit is append-only'); END;
  CREATE TRIGGER role_change_no_delete BEFORE DELETE ON role_change_events
    BEGIN SELECT RAISE(ABORT,'role audit is append-only'); END;
  INSERT INTO rebuild_migrations(version) VALUES(8);`);
}
module.exports={migrateRoleAudit};

function migrateFetchAdmission(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=17').get()) return;
  db.exec(`CREATE TABLE source_fetch_limits (
    host TEXT PRIMARY KEY NOT NULL,
    next_allowed_ms INTEGER NOT NULL CHECK(next_allowed_ms>=0)
  );
  INSERT INTO rebuild_migrations(version) VALUES(17);`);
}
module.exports={migrateFetchAdmission};

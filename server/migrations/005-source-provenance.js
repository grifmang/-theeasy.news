function migrateSourceProvenance(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=5').get()) return;
  db.exec(`
    CREATE TABLE source_access_events (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES source_items(id),
      actor_id INTEGER NOT NULL REFERENCES users(id),
      policy TEXT NOT NULL CHECK(policy IN ('private','excerpt_only','public_original','restricted')),
      reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX source_access_history ON source_access_events(source_id,id);
    CREATE TABLE source_retrievals (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES source_items(id),
      url TEXT NOT NULL, final_url TEXT NOT NULL, status INTEGER NOT NULL CHECK(status BETWEEN 100 AND 599),
      retrieved_at TEXT NOT NULL, sha256 TEXT, mime TEXT NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('manual_import','http','wayback','archive_link'))
    );
    CREATE INDEX source_retrieval_history ON source_retrievals(source_id,id);
    INSERT INTO rebuild_migrations(version) VALUES(5);
  `);
  for (const table of ['source_access_events','source_retrievals']) {
    for (const operation of ['UPDATE','DELETE']) {
      db.exec(`CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
        BEGIN SELECT RAISE(ABORT, 'source provenance is append-only'); END;`);
    }
  }
}
module.exports = {migrateSourceProvenance};

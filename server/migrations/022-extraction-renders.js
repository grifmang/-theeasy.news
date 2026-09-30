function migrateExtractionRenders(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=22').get())return;
  db.exec(`CREATE TABLE extraction_renders (
    id INTEGER PRIMARY KEY,
    extraction_id INTEGER NOT NULL REFERENCES extraction_manifests(id),
    page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 200),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
    key TEXT NOT NULL CHECK(key=sha256||'.bin'),
    size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 8388608),
    mime TEXT NOT NULL CHECK(mime='image/png'),
    width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
    height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
    renderer_version TEXT NOT NULL CHECK(length(renderer_version) BETWEEN 1 AND 200),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(extraction_id,page)
  );
  CREATE TRIGGER extraction_renders_no_update BEFORE UPDATE ON extraction_renders
    BEGIN SELECT RAISE(ABORT,'extraction renders are immutable'); END;
  CREATE TRIGGER extraction_renders_no_delete BEFORE DELETE ON extraction_renders
    BEGIN SELECT RAISE(ABORT,'extraction renders are immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(22);`);
}
module.exports={migrateExtractionRenders};

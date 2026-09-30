function migrateOriginalObjects(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=9').get()) return;
  db.exec(`CREATE TABLE original_objects (
    sha256 TEXT PRIMARY KEY CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
    key TEXT NOT NULL UNIQUE CHECK(key=sha256||'.bin'),
    size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 26214400),
    mime TEXT NOT NULL
  );
  CREATE TABLE document_originals (
    document_id INTEGER NOT NULL REFERENCES research_documents(id),
    sha256 TEXT NOT NULL REFERENCES original_objects(sha256),
    PRIMARY KEY(document_id,sha256)
  );
  CREATE TRIGGER original_objects_no_update BEFORE UPDATE ON original_objects
    BEGIN SELECT RAISE(ABORT,'original manifest is immutable'); END;
  CREATE TRIGGER original_objects_no_delete BEFORE DELETE ON original_objects
    BEGIN SELECT RAISE(ABORT,'original manifest is immutable'); END;
  CREATE TRIGGER document_originals_no_update BEFORE UPDATE ON document_originals
    BEGIN SELECT RAISE(ABORT,'original binding is immutable'); END;
  CREATE TRIGGER document_originals_no_delete BEFORE DELETE ON document_originals
    BEGIN SELECT RAISE(ABORT,'original binding is immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(9);`);
}
module.exports={migrateOriginalObjects};

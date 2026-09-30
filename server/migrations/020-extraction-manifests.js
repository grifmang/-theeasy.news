function migrateExtractionManifests(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=20').get()) return;
  db.exec(`CREATE TABLE extraction_manifests (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES research_documents(id),
    receipt_id INTEGER NOT NULL REFERENCES fetch_receipts(id),
    original_sha256 TEXT NOT NULL REFERENCES original_objects(sha256),
    text_sha256 TEXT NOT NULL CHECK(length(text_sha256)=64 AND text_sha256 NOT GLOB '*[^a-f0-9]*'),
    extractor_version TEXT NOT NULL,
    manifest_json TEXT NOT NULL CHECK(length(manifest_json)<=8388608),
    manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^a-f0-9]*'),
    requires_review INTEGER NOT NULL CHECK(requires_review=1),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(receipt_id,extractor_version),
    FOREIGN KEY(document_id,original_sha256) REFERENCES document_originals(document_id,sha256)
  );
  CREATE INDEX extraction_manifests_document ON extraction_manifests(document_id);
  CREATE TRIGGER extraction_manifests_no_update BEFORE UPDATE ON extraction_manifests
    BEGIN SELECT RAISE(ABORT,'extraction manifest is immutable'); END;
  CREATE TRIGGER extraction_manifests_no_delete BEFORE DELETE ON extraction_manifests
    BEGIN SELECT RAISE(ABORT,'extraction manifest is immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(20);`);
}
module.exports={migrateExtractionManifests};

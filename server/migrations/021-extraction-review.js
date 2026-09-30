function migrateExtractionReview(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=21').get()) return;
  db.exec(`CREATE TABLE extraction_review_events (
    id INTEGER PRIMARY KEY,
    extraction_id INTEGER NOT NULL REFERENCES extraction_manifests(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64),
    decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
    original_compared INTEGER NOT NULL CHECK(original_compared IN (0,1)),
    reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 8000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(decision!='accepted' OR original_compared=1)
  );
  CREATE INDEX extraction_review_latest ON extraction_review_events(extraction_id,id);
  CREATE TRIGGER extraction_review_no_update BEFORE UPDATE ON extraction_review_events
    BEGIN SELECT RAISE(ABORT,'extraction reviews are immutable'); END;
  CREATE TRIGGER extraction_review_no_delete BEFORE DELETE ON extraction_review_events
    BEGIN SELECT RAISE(ABORT,'extraction reviews are immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(21);`);
}
module.exports={migrateExtractionReview};

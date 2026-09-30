function migratePublicBookmarks(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=34').get()) return;
  db.exec(`CREATE TABLE public_analysis_bookmarks (
    user_id INTEGER NOT NULL REFERENCES users(id),
    claim_id INTEGER NOT NULL REFERENCES research_claims(id),
    saved_at_ms INTEGER NOT NULL CHECK(saved_at_ms BETWEEN 0 AND 8640000000000000),
    PRIMARY KEY(user_id,claim_id)
  );
  CREATE INDEX public_analysis_bookmarks_recent ON public_analysis_bookmarks(user_id,saved_at_ms DESC,claim_id DESC);
  INSERT INTO rebuild_migrations(version) VALUES(34);`);
}
module.exports={migratePublicBookmarks};

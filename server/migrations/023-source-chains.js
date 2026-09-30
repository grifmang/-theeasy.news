function migrateSourceChains(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=23').get())return;
  db.exec(`CREATE TABLE source_chain_links (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES research_documents(id),
    parent_document_id INTEGER NOT NULL REFERENCES research_documents(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 8000 AND length(CAST(reason AS BLOB))<=8000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK(document_id<>parent_document_id),
    UNIQUE(document_id,parent_document_id)
  );
  CREATE INDEX source_chain_links_parent ON source_chain_links(parent_document_id,document_id);
  CREATE TRIGGER source_chain_links_no_cycle BEFORE INSERT ON source_chain_links
  BEGIN
    SELECT RAISE(ABORT,'source chain cycle') WHERE EXISTS (
      WITH RECURSIVE ancestors(id) AS (
        VALUES(NEW.parent_document_id)
        UNION
        SELECT links.parent_document_id FROM source_chain_links links
        JOIN ancestors ON links.document_id=ancestors.id
      )
      SELECT 1 FROM ancestors WHERE id=NEW.document_id
    );
  END;
  CREATE TRIGGER source_chain_links_no_update BEFORE UPDATE ON source_chain_links
    BEGIN SELECT RAISE(ABORT,'source chain links are immutable'); END;
  CREATE TRIGGER source_chain_links_no_delete BEFORE DELETE ON source_chain_links
    BEGIN SELECT RAISE(ABORT,'source chain links are immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(23);`);
}
module.exports={migrateSourceChains};

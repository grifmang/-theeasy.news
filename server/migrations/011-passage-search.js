function migratePassageSearch(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=11').get()) return;
  db.exec(`CREATE VIRTUAL TABLE passage_search USING fts5(quote,title,source,tokenize='unicode61');
    INSERT INTO passage_search(rowid,quote,title,source)
      SELECT p.id,p.quote,s.title,s.source FROM research_passages p
      JOIN research_documents d ON d.id=p.document_id JOIN source_items s ON s.id=d.source_id;
    CREATE TRIGGER passage_search_insert AFTER INSERT ON research_passages BEGIN
      INSERT INTO passage_search(rowid,quote,title,source)
      SELECT new.id,new.quote,s.title,s.source FROM research_documents d
      JOIN source_items s ON s.id=d.source_id WHERE d.id=new.document_id;
    END;
    INSERT INTO rebuild_migrations(version) VALUES(11);`);
}
module.exports={migratePassageSearch};

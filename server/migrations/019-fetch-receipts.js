function migrateFetchReceipts(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=19').get()) return;
  db.exec(`CREATE TABLE fetch_receipts (
    id INTEGER PRIMARY KEY,job_id INTEGER NOT NULL UNIQUE REFERENCES fetch_jobs(id),
    url TEXT NOT NULL,final_url TEXT NOT NULL,status INTEGER NOT NULL CHECK(status=200),
    retrieved_at TEXT NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,
    size INTEGER NOT NULL CHECK(size>0 AND size<=26214400),
    retention TEXT NOT NULL CHECK(retention IN ('private','metadata-only')),
    redirects_json TEXT NOT NULL,headers_json TEXT NOT NULL
  );
  CREATE TRIGGER fetch_receipts_no_update BEFORE UPDATE ON fetch_receipts
    BEGIN SELECT RAISE(ABORT,'fetch receipts are immutable'); END;
  CREATE TRIGGER fetch_receipts_no_delete BEFORE DELETE ON fetch_receipts
    BEGIN SELECT RAISE(ABORT,'fetch receipts are immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(19);`);
}
module.exports={migrateFetchReceipts};

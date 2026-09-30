function migrateFetchJobs(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=18').get()) return;
  db.exec(`CREATE TABLE fetch_jobs (
    id INTEGER PRIMARY KEY,topic_id INTEGER NOT NULL REFERENCES research_topics(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),source_policy_id TEXT NOT NULL,
    policy_hash TEXT NOT NULL,policy_json TEXT NOT NULL,url TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','retry_wait','fetched','exhausted','blocked')),
    failures INTEGER NOT NULL DEFAULT 0 CHECK(failures>=0),
    max_failures INTEGER NOT NULL DEFAULT 3 CHECK(max_failures BETWEEN 1 AND 10),
    next_attempt INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER,
    continuation_json TEXT,last_error TEXT,original_sha256 TEXT REFERENCES original_objects(sha256),
    UNIQUE(topic_id,source_policy_id,policy_hash,url)
  );
  CREATE INDEX fetch_jobs_pending ON fetch_jobs(state,next_attempt,id);
  INSERT INTO rebuild_migrations(version) VALUES(18);`);
}
module.exports={migrateFetchJobs};

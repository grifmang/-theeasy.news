function migrateClaimJobs(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=14').get()) return;
  db.exec(`CREATE TABLE claim_jobs (
    id INTEGER PRIMARY KEY,claim_id INTEGER NOT NULL REFERENCES research_claims(id),
    context_version_id INTEGER REFERENCES claim_context_versions(id),
    passage_id INTEGER NOT NULL REFERENCES research_passages(id),
    model TEXT NOT NULL,question_version TEXT NOT NULL,policy_version TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','retry_wait','done','exhausted','blocked')),
    attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
    next_attempt INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER,last_error TEXT
  );
  CREATE UNIQUE INDEX claim_job_identity ON claim_jobs(claim_id,COALESCE(context_version_id,0),passage_id,model,question_version,policy_version);
  CREATE INDEX claim_jobs_ready ON claim_jobs(state,next_attempt,lease_until);
  INSERT INTO rebuild_migrations(version) VALUES(14);`);
}
module.exports={migrateClaimJobs};

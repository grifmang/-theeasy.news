function migrateClaimJobRecovery(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=28').get()) return;
  db.exec(`ALTER TABLE claim_jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'passage-evaluation-v1'
    CHECK(stage='passage-evaluation-v1');
  DROP INDEX claim_job_identity;
  CREATE UNIQUE INDEX claim_job_identity ON claim_jobs
    (claim_id,COALESCE(context_version_id,0),passage_id,stage,model,question_version,policy_version);
  CREATE INDEX claim_jobs_provider_recovery ON claim_jobs(id)
    WHERE state='blocked' AND last_error IN ('provider_auth','provider_configuration');
  CREATE TRIGGER claim_jobs_identity_immutable BEFORE UPDATE OF
    claim_id,context_version_id,passage_id,stage,model,question_version,policy_version ON claim_jobs
    BEGIN SELECT RAISE(ABORT,'claim job identity is immutable'); END;
  ALTER TABLE provider_queue_state ADD COLUMN pause_version INTEGER NOT NULL DEFAULT 0
    CHECK(pause_version>=0);
  UPDATE provider_queue_state SET pause_version=1 WHERE paused_at IS NOT NULL;
  CREATE TABLE claim_job_review_events (
    id INTEGER PRIMARY KEY,job_id INTEGER REFERENCES claim_jobs(id),
    kind TEXT NOT NULL CHECK(kind IN ('deadline_expired','attempts_exhausted','provider_paused',
      'budget_exhausted','provider_recovered','provider_recovery_batch',
      'job_requeued','job_skipped','decision_recorded')),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    actor_id INTEGER REFERENCES users(id),dedup_key TEXT NOT NULL UNIQUE,
    occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms>=0)
  );
  CREATE INDEX claim_job_review_by_job ON claim_job_review_events(job_id,id);
  CREATE TRIGGER claim_job_review_no_update BEFORE UPDATE ON claim_job_review_events
    BEGIN SELECT RAISE(ABORT,'claim job review is immutable'); END;
  CREATE TRIGGER claim_job_review_no_delete BEFORE DELETE ON claim_job_review_events
    BEGIN SELECT RAISE(ABORT,'claim job review is immutable'); END;
  CREATE TABLE provider_queue_recovery_events (
    id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=64),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),actor_id INTEGER NOT NULL REFERENCES users(id),
    expected_pause_version INTEGER NOT NULL,reason TEXT NOT NULL,
    recovered_at_ms INTEGER NOT NULL,requeued_jobs INTEGER NOT NULL,
    skipped_jobs INTEGER NOT NULL CHECK(skipped_jobs BETWEEN 0 AND 100),
    after_job_id INTEGER NOT NULL CHECK(after_job_id>=0),
    next_after_job_id INTEGER CHECK(next_after_job_id>after_job_id),
    completed INTEGER NOT NULL CHECK(completed IN (0,1)),
    CHECK((completed=1)=(next_after_job_id IS NULL))
  );
  CREATE INDEX provider_recovery_continuation ON provider_queue_recovery_events
    (expected_pause_version,next_after_job_id);
  CREATE TRIGGER provider_queue_recovery_no_update BEFORE UPDATE ON provider_queue_recovery_events
    BEGIN SELECT RAISE(ABORT,'provider recovery is immutable'); END;
  CREATE TRIGGER provider_queue_recovery_no_delete BEFORE DELETE ON provider_queue_recovery_events
    BEGIN SELECT RAISE(ABORT,'provider recovery is immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(28);`);
}
module.exports={migrateClaimJobRecovery};

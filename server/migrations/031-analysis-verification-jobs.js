function migrateAnalysisVerificationJobs(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=31').get()) return;
  db.exec(`CREATE TABLE analysis_verification_jobs (
    id INTEGER PRIMARY KEY,
    analysis_version_id INTEGER NOT NULL REFERENCES analysis_versions(id),
    policy_version TEXT NOT NULL CHECK(policy_version='assertion-review-v1'),
    decision_model TEXT NOT NULL CHECK(decision_model='jev-1.13.0'),
    admission_hash TEXT NOT NULL CHECK(length(admission_hash)=64 AND admission_hash NOT GLOB '*[^a-f0-9]*'),
    state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','retry_wait','done','exhausted','blocked')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
    max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 3),
    enqueued_by INTEGER NOT NULL REFERENCES users(id),
    enqueued_at_ms INTEGER NOT NULL CHECK(enqueued_at_ms BETWEEN 0 AND 8640000000000000),
    task_deadline_at_ms INTEGER NOT NULL CHECK(task_deadline_at_ms>enqueued_at_ms AND task_deadline_at_ms<=enqueued_at_ms+300000),
    retry_ready_at_ms INTEGER NOT NULL CHECK(retry_ready_at_ms BETWEEN 0 AND 8640000000000000),
    lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token)=36),
    lease_until_ms INTEGER CHECK(lease_until_ms IS NULL OR lease_until_ms>0),
    dispatch_started_at_ms INTEGER CHECK(dispatch_started_at_ms IS NULL OR dispatch_started_at_ms>=0),
    report_id INTEGER REFERENCES analysis_verification_reports(id),
    last_error TEXT CHECK(last_error IS NULL OR (length(last_error) BETWEEN 1 AND 64 AND last_error NOT GLOB '*[^a-z_]*')),
    UNIQUE(analysis_version_id,policy_version,decision_model,admission_hash),
    CHECK((state='leased')=(lease_token IS NOT NULL AND lease_until_ms IS NOT NULL)),
    CHECK((state='done')=(report_id IS NOT NULL))
  );
  CREATE INDEX analysis_verification_jobs_ready ON analysis_verification_jobs(state,retry_ready_at_ms,task_deadline_at_ms,id);
  CREATE INDEX analysis_verification_jobs_lease ON analysis_verification_jobs(state,lease_until_ms);
  CREATE TABLE analysis_verification_permission_events (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES analysis_verification_jobs(id),
    admission_hash TEXT NOT NULL CHECK(length(admission_hash)=64 AND admission_hash NOT GLOB '*[^a-f0-9]*'),
    allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms BETWEEN 0 AND 8640000000000000)
  );
  CREATE INDEX analysis_verification_permission_latest ON analysis_verification_permission_events(job_id,id DESC);
  CREATE TRIGGER analysis_verification_permission_binding BEFORE INSERT ON analysis_verification_permission_events
    WHEN NOT EXISTS(SELECT 1 FROM analysis_verification_jobs j WHERE j.id=NEW.job_id AND j.admission_hash=NEW.admission_hash)
    BEGIN SELECT RAISE(ABORT,'permission admission binding mismatch'); END;
  CREATE TRIGGER analysis_verification_permission_editor BEFORE INSERT ON analysis_verification_permission_events
    WHEN NOT EXISTS(SELECT 1 FROM user_roles WHERE user_id=NEW.actor_id AND role='editor')
    BEGIN SELECT RAISE(ABORT,'editor required'); END;
  CREATE TRIGGER analysis_verification_permission_no_update BEFORE UPDATE ON analysis_verification_permission_events
    BEGIN SELECT RAISE(ABORT,'permission event is immutable'); END;
  CREATE TRIGGER analysis_verification_permission_no_delete BEFORE DELETE ON analysis_verification_permission_events
    BEGIN SELECT RAISE(ABORT,'permission event is immutable'); END;
  CREATE TRIGGER analysis_verification_job_identity_immutable BEFORE UPDATE OF
    analysis_version_id,policy_version,decision_model,admission_hash,enqueued_by,enqueued_at_ms,task_deadline_at_ms,max_attempts
    ON analysis_verification_jobs BEGIN SELECT RAISE(ABORT,'verification job identity is immutable'); END;
  CREATE TRIGGER analysis_verification_job_report_binding BEFORE UPDATE OF report_id ON analysis_verification_jobs
    WHEN NEW.report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM analysis_verification_reports r
      WHERE r.id=NEW.report_id AND r.analysis_version_id=NEW.analysis_version_id
        AND r.policy_version=NEW.policy_version AND r.decision_model=NEW.decision_model)
    BEGIN SELECT RAISE(ABORT,'verification report does not belong to job'); END;
  CREATE TRIGGER analysis_verification_job_report_binding_insert BEFORE INSERT ON analysis_verification_jobs
    WHEN NEW.report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM analysis_verification_reports r
      WHERE r.id=NEW.report_id AND r.analysis_version_id=NEW.analysis_version_id
        AND r.policy_version=NEW.policy_version AND r.decision_model=NEW.decision_model)
    BEGIN SELECT RAISE(ABORT,'verification report does not belong to job'); END;
  CREATE TRIGGER analysis_verification_job_terminal BEFORE UPDATE ON analysis_verification_jobs
    WHEN OLD.state IN ('done','exhausted','blocked')
    BEGIN SELECT RAISE(ABORT,'verification job is terminal'); END;
  CREATE TRIGGER analysis_verification_job_no_delete BEFORE DELETE ON analysis_verification_jobs
    BEGIN SELECT RAISE(ABORT,'verification job cannot be deleted'); END;
  INSERT INTO rebuild_migrations(version) VALUES(31);`);
}
module.exports={migrateAnalysisVerificationJobs};

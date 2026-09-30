function migrateWorkAdmission(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=29').get()) return;
  db.exec(`ALTER TABLE claim_jobs ADD COLUMN created_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(created_at_ms>=0);
    ALTER TABLE claim_jobs ADD COLUMN pause_credit_version INTEGER NOT NULL DEFAULT 0 CHECK(pause_credit_version>=0);
    ALTER TABLE claim_jobs ADD COLUMN dispatch_started_at_ms INTEGER CHECK(dispatch_started_at_ms IS NULL OR dispatch_started_at_ms>=0);
    ALTER TABLE claim_jobs ADD COLUMN eligible_at_ms INTEGER CHECK(eligible_at_ms IS NULL OR eligible_at_ms BETWEEN 0 AND 8640000000000000);
    ALTER TABLE claim_jobs ADD COLUMN retry_ready_at_ms INTEGER NOT NULL DEFAULT 0 CHECK(retry_ready_at_ms BETWEEN 0 AND 8640000000000000);
    ALTER TABLE claim_jobs ADD COLUMN pause_blocked_at_ms INTEGER CHECK(pause_blocked_at_ms IS NULL OR pause_blocked_at_ms BETWEEN 0 AND 8640000000000000);
    ALTER TABLE claim_jobs ADD COLUMN pause_blocked_version INTEGER CHECK(pause_blocked_version IS NULL OR pause_blocked_version>=1);
    UPDATE claim_jobs SET retry_ready_at_ms=MAX(0,next_attempt),eligible_at_ms=0
      WHERE (SELECT allowed FROM provider_permission_events WHERE job_id=claim_jobs.id ORDER BY id DESC LIMIT 1)=1;
    UPDATE claim_jobs SET retry_ready_at_ms=MAX(0,next_attempt) WHERE retry_ready_at_ms=0;`);
  // Schema 28 has no dispatch marker. Conservatively mark an active lease with
  // reservation evidence as already dispatched; settled retries can clear it.
  db.exec(`UPDATE claim_jobs SET dispatch_started_at_ms=0 WHERE state='leased' AND EXISTS(
    SELECT 1 FROM model_reservations r WHERE r.request_key LIKE
      'claim-job:'||claim_jobs.id||':attempt:%');`);
  db.exec(`CREATE TABLE work_admission_state (
    id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL CHECK(state IN ('running','paused')),
    version INTEGER NOT NULL CHECK(version>=0), changed_at_ms INTEGER NOT NULL CHECK(changed_at_ms>=0)
  );
  INSERT INTO work_admission_state(id,state,version,changed_at_ms) VALUES(1,'running',0,0);
  CREATE TABLE work_admission_events (
    id INTEGER PRIMARY KEY, request_id_hash TEXT NOT NULL UNIQUE CHECK(length(request_id_hash)=64),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    actor_id INTEGER NOT NULL REFERENCES users(id), action TEXT NOT NULL CHECK(action IN ('pause','resume')),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    before_state TEXT NOT NULL CHECK(before_state IN ('running','paused')),
    after_state TEXT NOT NULL CHECK(after_state IN ('running','paused')),
    before_version INTEGER NOT NULL CHECK(before_version>=0),
    after_version INTEGER NOT NULL UNIQUE CHECK(after_version=before_version+1),
    occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms>=0),
    CHECK((action='pause' AND before_state='running' AND after_state='paused') OR
      (action='resume' AND before_state='paused' AND after_state='running'))
  );
  CREATE TRIGGER work_admission_events_no_update BEFORE UPDATE ON work_admission_events
    BEGIN SELECT RAISE(ABORT,'work admission event is immutable'); END;
  CREATE TRIGGER work_admission_events_no_delete BEFORE DELETE ON work_admission_events
    BEGIN SELECT RAISE(ABORT,'work admission event is immutable'); END;
  CREATE TRIGGER work_admission_state_audited BEFORE UPDATE ON work_admission_state
    WHEN NOT EXISTS(SELECT 1 FROM work_admission_events e WHERE e.before_state=OLD.state
      AND e.after_state=NEW.state AND e.before_version=OLD.version
      AND e.after_version=NEW.version AND e.occurred_at_ms=NEW.changed_at_ms)
    BEGIN SELECT RAISE(ABORT,'work admission transition requires audit event'); END;
  CREATE TRIGGER work_admission_state_no_delete BEFORE DELETE ON work_admission_state
    BEGIN SELECT RAISE(ABORT,'work admission state cannot be deleted'); END;
  CREATE INDEX fetch_jobs_active_leases ON fetch_jobs(state,lease_until) WHERE state='leased';
  CREATE INDEX claim_jobs_active_leases ON claim_jobs(state,lease_until) WHERE state='leased';
  CREATE INDEX claim_jobs_backlog ON claim_jobs(state,task_deadline_at,id)
    WHERE state IN ('queued','retry_wait');
  CREATE INDEX rebuild_jobs_active_leases ON rebuild_jobs(state,lease_until) WHERE state='leased';
  INSERT INTO rebuild_migrations(version) VALUES(29);`);
}
module.exports={migrateWorkAdmission};

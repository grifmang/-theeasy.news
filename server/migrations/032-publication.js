'use strict';

function migratePublication(db){
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=32').get())return;
  db.exec(`CREATE TABLE publication_owner_events (
    id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),
    allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    operator TEXT NOT NULL CHECK(length(operator) BETWEEN 1 AND 120),
    occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms BETWEEN 0 AND 8640000000000000),
    request_key TEXT NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 16 AND 120),
    request_hash TEXT NOT NULL CHECK(length(request_hash)=64)
  );
  CREATE INDEX publication_owner_latest ON publication_owner_events(user_id,id DESC);
  CREATE TRIGGER publication_owner_editor BEFORE INSERT ON publication_owner_events
    WHEN NEW.allowed=1 AND NOT EXISTS(SELECT 1 FROM user_roles WHERE user_id=NEW.user_id AND role='editor')
    BEGIN SELECT RAISE(ABORT,'publication owner must be editor'); END;
  CREATE TRIGGER publication_owner_no_update BEFORE UPDATE ON publication_owner_events
    BEGIN SELECT RAISE(ABORT,'publication owner event is immutable'); END;
  CREATE TRIGGER publication_owner_no_delete BEFORE DELETE ON publication_owner_events
    BEGIN SELECT RAISE(ABORT,'publication owner event is immutable'); END;
  CREATE TRIGGER claim_restriction_owner BEFORE INSERT ON claim_events
    WHEN NEW.type IN ('restricted','restored') AND NOT EXISTS(
      SELECT 1 FROM publication_owner_events e JOIN user_roles r ON r.user_id=e.user_id AND r.role='editor'
      WHERE e.user_id=NEW.actor_id AND e.allowed=1 AND e.id=(SELECT MAX(id) FROM publication_owner_events WHERE user_id=e.user_id))
    BEGIN SELECT RAISE(ABORT,'publication owner required'); END;
  CREATE TRIGGER source_restriction_owner BEFORE INSERT ON source_access_events
    WHEN (NEW.policy='restricted' OR COALESCE((SELECT policy FROM source_access_events
      WHERE source_id=NEW.source_id ORDER BY id DESC LIMIT 1),'private')='restricted')
      AND NOT EXISTS(SELECT 1 FROM publication_owner_events e
        JOIN user_roles r ON r.user_id=e.user_id AND r.role='editor'
        WHERE e.user_id=NEW.actor_id AND e.allowed=1 AND
          e.id=(SELECT MAX(id) FROM publication_owner_events WHERE user_id=e.user_id))
    BEGIN SELECT RAISE(ABORT,'publication owner required'); END;
  CREATE TABLE publication_review_events (
    id INTEGER PRIMARY KEY,analysis_version_id INTEGER NOT NULL REFERENCES analysis_versions(id),
    draft_sha256 TEXT NOT NULL CHECK(length(draft_sha256)=64),
    report_id INTEGER NOT NULL REFERENCES analysis_verification_reports(id),
    report_sha256 TEXT NOT NULL CHECK(length(report_sha256)=64),
    checked_version_hash TEXT NOT NULL CHECK(length(checked_version_hash)=64),
    policy_version TEXT NOT NULL,decision_model TEXT NOT NULL,
    claim_context_version_id INTEGER NOT NULL REFERENCES claim_context_versions(id),
    packet_version TEXT NOT NULL CHECK(length(packet_version)=64),
    dto_sha256 TEXT NOT NULL CHECK(length(dto_sha256)=64),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    previous_review_event_id INTEGER REFERENCES publication_review_events(id),
    request_key TEXT NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 16 AND 120),
    request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
    occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms BETWEEN 0 AND 8640000000000000)
  );
  CREATE INDEX publication_review_latest ON publication_review_events(analysis_version_id,id DESC);
  CREATE TRIGGER publication_review_binding BEFORE INSERT ON publication_review_events
    WHEN NOT EXISTS(SELECT 1 FROM analysis_versions v JOIN analysis_verification_reports r
      ON r.analysis_version_id=v.id WHERE v.id=NEW.analysis_version_id AND
      v.draft_sha256=NEW.draft_sha256 AND v.claim_context_version_id=NEW.claim_context_version_id AND
      v.packet_version=NEW.packet_version AND r.id=NEW.report_id AND
      r.report_sha256=NEW.report_sha256 AND r.checked_version_hash=NEW.checked_version_hash AND
      r.policy_version=NEW.policy_version AND r.decision_model=NEW.decision_model)
    BEGIN SELECT RAISE(ABORT,'publication review identity mismatch'); END;
  CREATE TRIGGER publication_review_no_update BEFORE UPDATE ON publication_review_events
    BEGIN SELECT RAISE(ABORT,'publication review is immutable'); END;
  CREATE TRIGGER publication_review_no_delete BEFORE DELETE ON publication_review_events
    BEGIN SELECT RAISE(ABORT,'publication review is immutable'); END;
  CREATE TABLE publication_snapshots (
    id INTEGER PRIMARY KEY,claim_id INTEGER NOT NULL REFERENCES research_claims(id),
    analysis_version_id INTEGER NOT NULL REFERENCES analysis_versions(id),
    review_event_id INTEGER NOT NULL REFERENCES publication_review_events(id),
    dto_json TEXT NOT NULL CHECK(length(dto_json) BETWEEN 2 AND 262144),
    dto_sha256 TEXT NOT NULL CHECK(length(dto_sha256)=64),
    dependency_sha256 TEXT NOT NULL CHECK(length(dependency_sha256)=64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 8640000000000000),
    UNIQUE(review_event_id,dto_sha256)
  );
  CREATE TRIGGER publication_snapshot_binding BEFORE INSERT ON publication_snapshots
    WHEN NOT EXISTS(SELECT 1 FROM analysis_versions v JOIN publication_review_events r
      ON r.analysis_version_id=v.id WHERE v.id=NEW.analysis_version_id AND
      v.claim_id=NEW.claim_id AND r.id=NEW.review_event_id AND r.decision='approved' AND
      r.dto_sha256=NEW.dto_sha256)
    BEGIN SELECT RAISE(ABORT,'publication snapshot identity mismatch'); END;
  CREATE TRIGGER publication_snapshot_no_update BEFORE UPDATE ON publication_snapshots
    BEGIN SELECT RAISE(ABORT,'publication snapshot is immutable'); END;
  CREATE TRIGGER publication_snapshot_no_delete BEFORE DELETE ON publication_snapshots
    BEGIN SELECT RAISE(ABORT,'publication snapshot is immutable'); END;
  CREATE TABLE publication_dependencies (
    snapshot_id INTEGER NOT NULL REFERENCES publication_snapshots(id),
    source_id INTEGER NOT NULL REFERENCES source_items(id),
    source_access_event_id INTEGER NOT NULL REFERENCES source_access_events(id),
    claim_event_id INTEGER REFERENCES claim_events(id),
    PRIMARY KEY(snapshot_id,source_id)
  );
  CREATE INDEX publication_dependencies_source ON publication_dependencies(source_id,snapshot_id);
  CREATE TRIGGER publication_dependency_binding BEFORE INSERT ON publication_dependencies
    WHEN NOT EXISTS(SELECT 1 FROM source_access_events a WHERE a.id=NEW.source_access_event_id
      AND a.source_id=NEW.source_id AND a.policy IN ('excerpt_only','public_original')) OR
      (NEW.claim_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM claim_events c
        JOIN publication_snapshots s ON s.claim_id=c.claim_id
        WHERE s.id=NEW.snapshot_id AND c.id=NEW.claim_event_id))
    BEGIN SELECT RAISE(ABORT,'publication dependency identity mismatch'); END;
  CREATE TRIGGER publication_dependency_no_update BEFORE UPDATE ON publication_dependencies
    BEGIN SELECT RAISE(ABORT,'publication dependency is immutable'); END;
  CREATE TRIGGER publication_dependency_no_delete BEFORE DELETE ON publication_dependencies
    BEGIN SELECT RAISE(ABORT,'publication dependency is immutable'); END;
  CREATE TABLE publication_events (
    id INTEGER PRIMARY KEY,claim_id INTEGER NOT NULL REFERENCES research_claims(id),
    snapshot_id INTEGER REFERENCES publication_snapshots(id),
    action TEXT NOT NULL CHECK(action IN ('publish','correct','retract','restrict','invalidate')),
    generation INTEGER NOT NULL CHECK(generation>0),
    previous_event_id INTEGER REFERENCES publication_events(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
    request_key TEXT NOT NULL UNIQUE CHECK(length(request_key) BETWEEN 16 AND 120),
    request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
    occurred_at_ms INTEGER NOT NULL CHECK(occurred_at_ms BETWEEN 0 AND 8640000000000000),
    UNIQUE(claim_id,generation),
    CHECK((action IN ('publish','correct'))=(snapshot_id IS NOT NULL))
  );
  CREATE TRIGGER publication_event_no_update BEFORE UPDATE ON publication_events
    BEGIN SELECT RAISE(ABORT,'publication event is immutable'); END;
  CREATE TRIGGER publication_event_no_delete BEFORE DELETE ON publication_events
    BEGIN SELECT RAISE(ABORT,'publication event is immutable'); END;
  CREATE TRIGGER publication_event_binding BEFORE INSERT ON publication_events
    WHEN (NEW.generation=1 AND NEW.previous_event_id IS NOT NULL) OR
      (NEW.generation>1 AND NEW.previous_event_id IS NULL) OR
      (NEW.snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM publication_snapshots s
      WHERE s.id=NEW.snapshot_id AND s.claim_id=NEW.claim_id)) OR
      (NEW.previous_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM publication_events e
        WHERE e.id=NEW.previous_event_id AND e.claim_id=NEW.claim_id AND e.generation=NEW.generation-1))
    BEGIN SELECT RAISE(ABORT,'publication event identity mismatch'); END;
  CREATE TABLE publication_manifest_heads (
    claim_id INTEGER PRIMARY KEY REFERENCES research_claims(id),
    generation INTEGER NOT NULL CHECK(generation>0),
    event_id INTEGER NOT NULL REFERENCES publication_events(id),
    snapshot_id INTEGER REFERENCES publication_snapshots(id),
    dto_sha256 TEXT CHECK(dto_sha256 IS NULL OR length(dto_sha256)=64),
    state TEXT NOT NULL CHECK(state IN ('active','tombstone')),
    CHECK((state='active')=(snapshot_id IS NOT NULL AND dto_sha256 IS NOT NULL))
  );
  CREATE TRIGGER publication_head_monotonic BEFORE UPDATE ON publication_manifest_heads
    WHEN NEW.claim_id!=OLD.claim_id OR NEW.generation!=OLD.generation+1 OR NEW.event_id=OLD.event_id
    BEGIN SELECT RAISE(ABORT,'publication head generation must advance'); END;
  CREATE TRIGGER publication_head_binding_insert BEFORE INSERT ON publication_manifest_heads
    WHEN NOT EXISTS(SELECT 1 FROM publication_events e LEFT JOIN publication_snapshots s ON s.id=e.snapshot_id
      WHERE e.id=NEW.event_id AND e.claim_id=NEW.claim_id AND e.generation=NEW.generation AND
        e.snapshot_id IS NEW.snapshot_id AND
        ((NEW.state='tombstone' AND e.action IN ('retract','restrict','invalidate')) OR
         (NEW.state='active' AND e.action IN ('publish','correct') AND s.dto_sha256=NEW.dto_sha256)))
    BEGIN SELECT RAISE(ABORT,'publication head identity mismatch'); END;
  CREATE TRIGGER publication_head_binding_update BEFORE UPDATE ON publication_manifest_heads
    WHEN NOT EXISTS(SELECT 1 FROM publication_events e LEFT JOIN publication_snapshots s ON s.id=e.snapshot_id
      WHERE e.id=NEW.event_id AND e.claim_id=NEW.claim_id AND e.generation=NEW.generation AND
        e.snapshot_id IS NEW.snapshot_id AND
        ((NEW.state='tombstone' AND e.action IN ('retract','restrict','invalidate')) OR
         (NEW.state='active' AND e.action IN ('publish','correct') AND s.dto_sha256=NEW.dto_sha256)))
    BEGIN SELECT RAISE(ABORT,'publication head identity mismatch'); END;
  CREATE TRIGGER publication_head_no_delete BEFORE DELETE ON publication_manifest_heads
    BEGIN SELECT RAISE(ABORT,'publication head cannot be deleted'); END;
  CREATE TABLE publication_outbox (
    id INTEGER PRIMARY KEY,claim_id INTEGER NOT NULL REFERENCES research_claims(id),
    generation INTEGER NOT NULL CHECK(generation>0),
    event_id INTEGER NOT NULL REFERENCES publication_events(id),
    action TEXT NOT NULL CHECK(action IN ('activate','invalidate')),
    dto_sha256 TEXT CHECK(dto_sha256 IS NULL OR length(dto_sha256)=64),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 8640000000000000),
    UNIQUE(claim_id,generation),
    CHECK((action='activate')=(dto_sha256 IS NOT NULL))
  );
  CREATE INDEX publication_outbox_pending ON publication_outbox(claim_id,generation);
  CREATE TRIGGER publication_outbox_binding BEFORE INSERT ON publication_outbox
    WHEN NOT EXISTS(SELECT 1 FROM publication_events e JOIN publication_manifest_heads h
      ON h.claim_id=e.claim_id AND h.event_id=e.id AND h.generation=e.generation
      WHERE e.id=NEW.event_id AND e.claim_id=NEW.claim_id AND e.generation=NEW.generation AND
        ((NEW.action='activate' AND h.state='active' AND h.dto_sha256=NEW.dto_sha256) OR
         (NEW.action='invalidate' AND h.state='tombstone' AND NEW.dto_sha256 IS NULL)))
    BEGIN SELECT RAISE(ABORT,'publication outbox identity mismatch'); END;
  CREATE TRIGGER publication_outbox_no_update BEFORE UPDATE ON publication_outbox
    BEGIN SELECT RAISE(ABORT,'publication outbox is immutable'); END;
  CREATE TRIGGER publication_outbox_no_delete BEFORE DELETE ON publication_outbox
    BEGIN SELECT RAISE(ABORT,'publication outbox is immutable'); END;
  CREATE TABLE publication_delivery_tasks (
    id INTEGER PRIMARY KEY,outbox_id INTEGER NOT NULL REFERENCES publication_outbox(id),
    target TEXT NOT NULL CHECK(target IN ('public_index','static_snapshot','cache','document_preview')),
    generation INTEGER NOT NULL CHECK(generation>0),
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','done','failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
    ready_at_ms INTEGER NOT NULL CHECK(ready_at_ms BETWEEN 0 AND 8640000000000000),
    lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token)=36),
    lease_until_ms INTEGER CHECK(lease_until_ms IS NULL OR lease_until_ms>0),
    last_error_code TEXT CHECK(last_error_code IS NULL OR
      (length(last_error_code) BETWEEN 1 AND 64 AND last_error_code NOT GLOB '*[^a-z_]*')),
    UNIQUE(outbox_id,target),
    CHECK((state='leased')=(lease_token IS NOT NULL AND lease_until_ms IS NOT NULL))
  );
  CREATE INDEX publication_delivery_ready ON publication_delivery_tasks(state,ready_at_ms,id);
  CREATE INDEX publication_delivery_lease ON publication_delivery_tasks(state,lease_until_ms);
  CREATE TRIGGER publication_delivery_binding BEFORE INSERT ON publication_delivery_tasks
    WHEN NOT EXISTS(SELECT 1 FROM publication_outbox o WHERE o.id=NEW.outbox_id
      AND o.generation=NEW.generation)
    BEGIN SELECT RAISE(ABORT,'publication task identity mismatch'); END;
  CREATE TRIGGER publication_delivery_identity_immutable BEFORE UPDATE OF outbox_id,target,generation
    ON publication_delivery_tasks BEGIN SELECT RAISE(ABORT,'publication task identity is immutable'); END;
  CREATE TRIGGER publication_delivery_no_delete BEFORE DELETE ON publication_delivery_tasks
    BEGIN SELECT RAISE(ABORT,'publication task cannot be deleted'); END;
  CREATE TABLE publication_invalidation_receipts (
    id INTEGER PRIMARY KEY,task_id INTEGER NOT NULL UNIQUE REFERENCES publication_delivery_tasks(id),
    outbox_id INTEGER NOT NULL REFERENCES publication_outbox(id),
    generation INTEGER NOT NULL CHECK(generation>0),
    target TEXT NOT NULL CHECK(target IN ('public_index','static_snapshot','cache','document_preview')),
    lease_token TEXT NOT NULL CHECK(length(lease_token)=36),
    completed_at_ms INTEGER NOT NULL CHECK(completed_at_ms BETWEEN 0 AND 8640000000000000),
    UNIQUE(outbox_id,target)
  );
  CREATE TRIGGER publication_receipt_binding BEFORE INSERT ON publication_invalidation_receipts
    WHEN NOT EXISTS(SELECT 1 FROM publication_delivery_tasks t WHERE t.id=NEW.task_id
      AND t.outbox_id=NEW.outbox_id AND t.generation=NEW.generation AND t.target=NEW.target
      AND t.state='leased' AND t.lease_token=NEW.lease_token AND t.lease_until_ms>NEW.completed_at_ms)
    BEGIN SELECT RAISE(ABORT,'publication receipt lease mismatch'); END;
  CREATE TRIGGER publication_receipt_no_update BEFORE UPDATE ON publication_invalidation_receipts
    BEGIN SELECT RAISE(ABORT,'publication receipt is immutable'); END;
  CREATE TRIGGER publication_receipt_no_delete BEFORE DELETE ON publication_invalidation_receipts
    BEGIN SELECT RAISE(ABORT,'publication receipt is immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(32);`);
}
module.exports={migratePublication};

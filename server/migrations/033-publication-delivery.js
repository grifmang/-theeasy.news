'use strict';
function migratePublicationDelivery(db){
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=33').get())return;
  db.exec(`CREATE TABLE publication_sinks (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    sink_id TEXT NOT NULL UNIQUE CHECK(length(sink_id)=36),
    kind TEXT NOT NULL CHECK(kind='private_filesystem'),
    format_version INTEGER NOT NULL CHECK(format_version=2),
    db_path_sha256 TEXT NOT NULL CHECK(length(db_path_sha256)=64),
    db_file_identity TEXT NOT NULL,
    root_path_sha256 TEXT NOT NULL CHECK(length(root_path_sha256)=64),
    bound_at_ms INTEGER NOT NULL CHECK(bound_at_ms BETWEEN 0 AND 8640000000000000)
  );
  CREATE TRIGGER publication_sink_no_update BEFORE UPDATE ON publication_sinks
    BEGIN SELECT RAISE(ABORT,'publication sink is immutable'); END;
  CREATE TRIGGER publication_sink_no_delete BEFORE DELETE ON publication_sinks
    BEGIN SELECT RAISE(ABORT,'publication sink is immutable'); END;
  CREATE TABLE publication_delivery_receipts (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL UNIQUE REFERENCES publication_delivery_tasks(id),
    outbox_id INTEGER NOT NULL REFERENCES publication_outbox(id),
    sink_id TEXT NOT NULL REFERENCES publication_sinks(sink_id),
    target TEXT NOT NULL CHECK(target IN ('public_index','static_snapshot','cache','document_preview')),
    claim_id INTEGER NOT NULL REFERENCES research_claims(id),
    generation INTEGER NOT NULL CHECK(generation>0),
    action TEXT NOT NULL CHECK(action IN ('activate','invalidate')),
    outcome TEXT NOT NULL CHECK(outcome IN ('applied','replayed','superseded')),
    applied_generation INTEGER CHECK(applied_generation IS NULL OR applied_generation>0),
    dto_sha256 TEXT CHECK(dto_sha256 IS NULL OR length(dto_sha256)=64),
    artifact_sha256 TEXT CHECK(artifact_sha256 IS NULL OR length(artifact_sha256)=64),
    artifact_size INTEGER CHECK(artifact_size IS NULL OR artifact_size BETWEEN 1 AND 262144),
    manifest_sha256 TEXT CHECK(manifest_sha256 IS NULL OR length(manifest_sha256)=64),
    lease_token TEXT NOT NULL CHECK(length(lease_token)=36),
    completed_at_ms INTEGER NOT NULL CHECK(completed_at_ms BETWEEN 0 AND 8640000000000000),
    CHECK((action='activate')=(dto_sha256 IS NOT NULL)),
    CHECK((outcome='superseded')=(manifest_sha256 IS NULL)),
    CHECK(outcome!='superseded' OR artifact_sha256 IS NULL AND artifact_size IS NULL),
    CHECK(outcome='superseded' OR applied_generation=generation),
    CHECK(outcome='superseded' OR action='invalidate' OR
      (artifact_sha256=dto_sha256 AND artifact_size IS NOT NULL)),
    CHECK(action='activate' OR artifact_sha256 IS NULL AND artifact_size IS NULL),
    UNIQUE(outbox_id,target)
  );
  CREATE TRIGGER publication_delivery_receipt_binding BEFORE INSERT ON publication_delivery_receipts
    WHEN NOT EXISTS(SELECT 1 FROM publication_delivery_tasks t
      JOIN publication_outbox o ON o.id=t.outbox_id
      JOIN publication_sinks s ON s.sink_id=NEW.sink_id
      WHERE t.id=NEW.task_id AND t.outbox_id=NEW.outbox_id AND t.target=NEW.target
        AND t.generation=NEW.generation AND t.state='leased' AND t.lease_token=NEW.lease_token
        AND t.lease_until_ms>NEW.completed_at_ms AND o.claim_id=NEW.claim_id
        AND o.action=NEW.action AND o.dto_sha256 IS NEW.dto_sha256)
    BEGIN SELECT RAISE(ABORT,'publication delivery receipt identity mismatch'); END;
  CREATE TRIGGER publication_delivery_receipt_no_update BEFORE UPDATE ON publication_delivery_receipts
    BEGIN SELECT RAISE(ABORT,'publication delivery receipt is immutable'); END;
  CREATE TRIGGER publication_delivery_receipt_no_delete BEFORE DELETE ON publication_delivery_receipts
    BEGIN SELECT RAISE(ABORT,'publication delivery receipt is immutable'); END;
  CREATE TRIGGER publication_delivery_done_receipt BEFORE UPDATE OF state ON publication_delivery_tasks
    WHEN NEW.state='done' AND NOT EXISTS(SELECT 1 FROM publication_delivery_receipts r
      WHERE r.task_id=OLD.id AND r.lease_token=OLD.lease_token)
    BEGIN SELECT RAISE(ABORT,'publication delivery requires receipt'); END;
  CREATE TRIGGER publication_delivery_no_done_insert BEFORE INSERT ON publication_delivery_tasks
    WHEN NEW.state='done'
    BEGIN SELECT RAISE(ABORT,'publication delivery requires receipt'); END;
  CREATE TRIGGER publication_delivery_terminal BEFORE UPDATE ON publication_delivery_tasks
    WHEN OLD.state IN ('done','failed')
    BEGIN SELECT RAISE(ABORT,'publication delivery task is terminal'); END;
  INSERT INTO rebuild_migrations(version) VALUES(33);`);
}
module.exports={migratePublicationDelivery};

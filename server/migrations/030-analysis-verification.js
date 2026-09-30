function migrateAnalysisVerification(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=30').get())return;
  db.exec(`CREATE TABLE analysis_versions (
    id INTEGER PRIMARY KEY,
    claim_id INTEGER NOT NULL REFERENCES research_claims(id),
    claim_context_version_id INTEGER NOT NULL REFERENCES claim_context_versions(id),
    packet_version TEXT NOT NULL CHECK(length(packet_version)=64 AND packet_version NOT GLOB '*[^a-f0-9]*'),
    draft_json TEXT NOT NULL CHECK(length(draft_json) BETWEEN 2 AND 262144),
    draft_sha256 TEXT NOT NULL CHECK(length(draft_sha256)=64 AND draft_sha256 NOT GLOB '*[^a-f0-9]*'),
    model_version TEXT NOT NULL CHECK(length(model_version) BETWEEN 1 AND 120),
    prompt_version TEXT NOT NULL CHECK(length(prompt_version) BETWEEN 1 AND 120),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 8640000000000000),
    UNIQUE(claim_id,draft_sha256)
  );
  CREATE INDEX analysis_versions_claim ON analysis_versions(claim_id,id);
  CREATE TRIGGER analysis_versions_context BEFORE INSERT ON analysis_versions
    WHEN NOT EXISTS(SELECT 1 FROM claim_context_versions c
      WHERE c.id=NEW.claim_context_version_id AND c.claim_id=NEW.claim_id)
    BEGIN SELECT RAISE(ABORT,'analysis context does not belong to claim'); END;
  CREATE TRIGGER analysis_versions_no_update BEFORE UPDATE ON analysis_versions
    BEGIN SELECT RAISE(ABORT,'analysis version is immutable'); END;
  CREATE TRIGGER analysis_versions_no_delete BEFORE DELETE ON analysis_versions
    BEGIN SELECT RAISE(ABORT,'analysis version is immutable'); END;
  CREATE TABLE analysis_verification_reports (
    id INTEGER PRIMARY KEY,
    analysis_version_id INTEGER NOT NULL REFERENCES analysis_versions(id),
    checked_version_hash TEXT NOT NULL CHECK(length(checked_version_hash)=64 AND checked_version_hash NOT GLOB '*[^a-f0-9]*'),
    policy_version TEXT NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 120),
    decision_model TEXT NOT NULL CHECK(length(decision_model) BETWEEN 1 AND 120),
    report_json TEXT NOT NULL CHECK(length(report_json) BETWEEN 2 AND 1048576),
    report_sha256 TEXT NOT NULL CHECK(length(report_sha256)=64 AND report_sha256 NOT GLOB '*[^a-f0-9]*'),
    stage TEXT NOT NULL CHECK(stage IN ('mechanical_blocked','semantic_candidate','semantic_incomplete')),
    blocking_count INTEGER NOT NULL CHECK(blocking_count BETWEEN 0 AND 1000),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 8640000000000000),
    UNIQUE(analysis_version_id,checked_version_hash,policy_version,decision_model)
  );
  CREATE INDEX analysis_verification_version ON analysis_verification_reports(analysis_version_id,id);
  CREATE TRIGGER analysis_verification_reports_no_update BEFORE UPDATE ON analysis_verification_reports
    BEGIN SELECT RAISE(ABORT,'analysis verification report is immutable'); END;
  CREATE TRIGGER analysis_verification_reports_no_delete BEFORE DELETE ON analysis_verification_reports
    BEGIN SELECT RAISE(ABORT,'analysis verification report is immutable'); END;
  INSERT INTO rebuild_migrations(version) VALUES(30);`);
}
module.exports={migrateAnalysisVerification};

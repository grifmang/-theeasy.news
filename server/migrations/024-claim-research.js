function migrateClaimResearch(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=24').get()) return;
  db.exec(`
    CREATE TABLE claim_relationships (
      id INTEGER PRIMARY KEY,
      claim_id INTEGER NOT NULL REFERENCES research_claims(id),
      other_claim_id INTEGER NOT NULL REFERENCES research_claims(id),
      type TEXT NOT NULL CHECK(type IN ('related','duplicate','component_of')),
      actor_id INTEGER NOT NULL REFERENCES users(id),
      claim_context_version_id INTEGER REFERENCES claim_context_versions(id),
      other_context_version_id INTEGER REFERENCES claim_context_versions(id),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 8000 AND length(CAST(reason AS BLOB))<=8000),
      request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 100),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(claim_id<>other_claim_id),
      CHECK(type='component_of' OR claim_id<other_claim_id),
      UNIQUE(actor_id,request_id)
    );
    CREATE INDEX claim_relationships_other ON claim_relationships(other_claim_id,id);
    CREATE INDEX claim_relationships_pair ON claim_relationships(claim_id,other_claim_id,type,id);
    CREATE TABLE claim_relationship_revocations (
      id INTEGER PRIMARY KEY,
      relationship_id INTEGER NOT NULL UNIQUE REFERENCES claim_relationships(id),
      actor_id INTEGER NOT NULL REFERENCES users(id),
      action TEXT NOT NULL CHECK(action IN ('revoked','corrected')),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 8000 AND length(CAST(reason AS BLOB))<=8000),
      request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 100),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(actor_id,request_id)
    );
    CREATE TRIGGER claim_relationships_context BEFORE INSERT ON claim_relationships
      BEGIN
        SELECT RAISE(ABORT,'invalid relationship context') WHERE
          (NEW.type='component_of' AND (
            NEW.claim_context_version_id IS NOT (SELECT MAX(id) FROM claim_context_versions WHERE claim_id=NEW.claim_id)
            OR NEW.other_context_version_id IS NOT (SELECT MAX(id) FROM claim_context_versions WHERE claim_id=NEW.other_claim_id)
            OR COALESCE((SELECT type FROM claim_events WHERE claim_id=NEW.claim_id
              AND type NOT IN ('restricted','restored') ORDER BY id DESC LIMIT 1),'unreviewed')<>'reviewed'
            OR COALESCE((SELECT type FROM claim_events WHERE claim_id=NEW.other_claim_id
              AND type NOT IN ('restricted','restored') ORDER BY id DESC LIMIT 1),'unreviewed')<>'reviewed'
          )) OR (NEW.type<>'component_of' AND
            (NEW.claim_context_version_id IS NOT NULL OR NEW.other_context_version_id IS NOT NULL));
      END;
    CREATE TRIGGER claim_relationships_no_duplicate BEFORE INSERT ON claim_relationships
      BEGIN
        SELECT RAISE(ABORT,'active claim relationship exists') WHERE EXISTS (
          SELECT 1 FROM claim_relationships r WHERE r.claim_id=NEW.claim_id
            AND r.other_claim_id=NEW.other_claim_id AND r.type=NEW.type
            AND NOT EXISTS(SELECT 1 FROM claim_relationship_revocations v WHERE v.relationship_id=r.id)
            AND (r.type<>'component_of' OR (
              r.claim_context_version_id IS (SELECT MAX(id) FROM claim_context_versions WHERE claim_id=r.claim_id)
              AND r.other_context_version_id IS (SELECT MAX(id) FROM claim_context_versions WHERE claim_id=r.other_claim_id)
              AND COALESCE((SELECT type FROM claim_events WHERE claim_id=r.claim_id
                AND type NOT IN ('restricted','restored') ORDER BY id DESC LIMIT 1),'unreviewed')='reviewed'
              AND COALESCE((SELECT type FROM claim_events WHERE claim_id=r.other_claim_id
                AND type NOT IN ('restricted','restored') ORDER BY id DESC LIMIT 1),'unreviewed')='reviewed'
            ))
        );
      END;
    CREATE TRIGGER claim_relationships_no_cycle BEFORE INSERT ON claim_relationships
      WHEN NEW.type='component_of'
      BEGIN
        SELECT RAISE(ABORT,'claim component cycle') WHERE EXISTS (
          WITH RECURSIVE parents(id) AS (
            VALUES(NEW.other_claim_id)
            UNION
            SELECT r.other_claim_id FROM claim_relationships r JOIN parents p ON r.claim_id=p.id
              WHERE r.type='component_of'
                AND NOT EXISTS(SELECT 1 FROM claim_relationship_revocations v WHERE v.relationship_id=r.id)
                AND r.claim_context_version_id IS (SELECT MAX(id) FROM claim_context_versions WHERE claim_id=r.claim_id)
                AND r.other_context_version_id IS (SELECT MAX(id) FROM claim_context_versions WHERE claim_id=r.other_claim_id)
                AND COALESCE((SELECT type FROM claim_events WHERE claim_id=r.claim_id
                  AND type NOT IN ('restricted','restored') ORDER BY id DESC LIMIT 1),'unreviewed')='reviewed'
                AND COALESCE((SELECT type FROM claim_events WHERE claim_id=r.other_claim_id
                  AND type NOT IN ('restricted','restored') ORDER BY id DESC LIMIT 1),'unreviewed')='reviewed'
          ) SELECT 1 FROM parents WHERE id=NEW.claim_id
        );
      END;
    CREATE TABLE claim_search_attempts (
      id INTEGER PRIMARY KEY,
      claim_id INTEGER NOT NULL REFERENCES research_claims(id),
      actor_id INTEGER NOT NULL REFERENCES users(id),
      query TEXT NOT NULL CHECK(length(trim(query)) BETWEEN 1 AND 2000 AND length(CAST(query AS BLOB))<=4000),
      source_url TEXT CHECK(source_url IS NULL OR (length(source_url) BETWEEN 1 AND 2048 AND length(CAST(source_url AS BLOB))<=4096)),
      outcome TEXT NOT NULL CHECK(outcome IN ('results','no_results','inaccessible','deferred')),
      note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 8000 AND length(CAST(note AS BLOB))<=8000),
      request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 100),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(actor_id,request_id)
    );
    CREATE INDEX claim_search_attempts_claim ON claim_search_attempts(claim_id,id);
    CREATE TABLE claim_coverage_events (
      id INTEGER PRIMARY KEY,
      claim_id INTEGER NOT NULL REFERENCES research_claims(id),
      actor_id INTEGER NOT NULL REFERENCES users(id),
      context_version_id INTEGER REFERENCES claim_context_versions(id),
      dimension TEXT NOT NULL CHECK(dimension IN ('origin','context','support','counterevidence','source_independence','identity')),
      state TEXT NOT NULL CHECK(state IN ('unknown','needs_work','reviewed','disputed','inaccessible','deferred')),
      expected_event_id INTEGER REFERENCES claim_coverage_events(id),
      reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 8000 AND length(CAST(reason AS BLOB))<=8000),
      request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 100),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(actor_id,request_id)
    );
    CREATE INDEX claim_coverage_events_claim ON claim_coverage_events(claim_id,dimension,id);
    CREATE TRIGGER claim_coverage_events_context BEFORE INSERT ON claim_coverage_events
      BEGIN
        SELECT RAISE(ABORT,'invalid coverage context') WHERE
          NEW.context_version_id IS NOT (SELECT MAX(id) FROM claim_context_versions WHERE claim_id=NEW.claim_id);
        SELECT RAISE(ABORT,'invalid coverage expectation') WHERE
          NEW.expected_event_id IS NOT (SELECT MAX(id) FROM claim_coverage_events
            WHERE claim_id=NEW.claim_id AND dimension=NEW.dimension
              AND context_version_id IS NEW.context_version_id);
      END;
    INSERT INTO rebuild_migrations(version) VALUES(24);
  `);
  for (const table of ['claim_relationships','claim_relationship_revocations','claim_search_attempts','claim_coverage_events']) {
    for (const operation of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER ${table}_no_${operation.toLowerCase()}
      BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'claim research is append-only'); END;`);
  }
}
module.exports={migrateClaimResearch};

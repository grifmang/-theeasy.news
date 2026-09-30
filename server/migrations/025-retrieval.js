function migrateRetrieval(db) {
  if(db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=25').get())return;
  db.exec(`CREATE TABLE passage_normalizations (
    passage_id INTEGER PRIMARY KEY REFERENCES research_passages(id),
    normalizer_version TEXT NOT NULL CHECK(normalizer_version='nfkc-case-punctuation-space-v1'),
    normalized_quote TEXT NOT NULL CHECK(length(CAST(normalized_quote AS BLOB))<=4194304),
    quote_bytes INTEGER NOT NULL CHECK(quote_bytes BETWEEN 1 AND 4194304)
  );
  CREATE TRIGGER passage_normalizations_valid BEFORE INSERT ON passage_normalizations BEGIN
    SELECT RAISE(ABORT,'invalid passage normalization') WHERE
      NEW.normalized_quote IS NOT normalize_passage(
        (SELECT quote FROM research_passages WHERE id=NEW.passage_id))
      OR NEW.quote_bytes IS NOT length(CAST(
        (SELECT quote FROM research_passages WHERE id=NEW.passage_id) AS BLOB));
  END;
  CREATE VIRTUAL TABLE passage_normalized_search USING fts5(normalized_quote,
    content='passage_normalizations',content_rowid='passage_id',
    tokenize='unicode61 remove_diacritics 0');
  CREATE TRIGGER passage_normalizations_search AFTER INSERT ON passage_normalizations BEGIN
    INSERT INTO passage_normalized_search(rowid,normalized_quote)
      VALUES(NEW.passage_id,NEW.normalized_quote);
  END;
  INSERT INTO passage_normalizations(passage_id,normalizer_version,normalized_quote,quote_bytes)
    SELECT p.id,'nfkc-case-punctuation-space-v1',normalize_passage(p.quote),length(CAST(p.quote AS BLOB))
    FROM research_passages p;
  CREATE TRIGGER research_passages_normalize AFTER INSERT ON research_passages BEGIN
    INSERT INTO passage_normalizations(passage_id,normalizer_version,normalized_quote,quote_bytes)
      VALUES(NEW.id,'nfkc-case-punctuation-space-v1',normalize_passage(NEW.quote),length(CAST(NEW.quote AS BLOB)));
  END;
  CREATE TRIGGER passage_normalizations_no_update BEFORE UPDATE ON passage_normalizations
    BEGIN SELECT RAISE(ABORT,'passage normalization is immutable'); END;
  CREATE TRIGGER passage_normalizations_no_delete BEFORE DELETE ON passage_normalizations
    BEGIN SELECT RAISE(ABORT,'passage normalization is immutable'); END;
  CREATE TABLE claim_retrieval_runs (
    id INTEGER PRIMARY KEY,
    claim_id INTEGER NOT NULL REFERENCES research_claims(id),
    context_version_id INTEGER NOT NULL REFERENCES claim_context_versions(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 100),
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
    requested_limit INTEGER NOT NULL CHECK(requested_limit BETWEEN 1 AND 30),
    fts_scanned INTEGER NOT NULL CHECK(fts_scanned BETWEEN 0 AND 32768),
    discovered_count INTEGER NOT NULL CHECK(discovered_count BETWEEN 0 AND 32768),
    pool_count INTEGER NOT NULL CHECK(pool_count BETWEEN 0 AND 1000),
    chain_nodes INTEGER NOT NULL CHECK(chain_nodes BETWEEN 0 AND 8192),
    chain_links INTEGER NOT NULL CHECK(chain_links BETWEEN 0 AND 16384),
    chain_reason_bytes INTEGER NOT NULL CHECK(chain_reason_bytes BETWEEN 0 AND 4194304),
    candidate_count INTEGER NOT NULL CHECK(candidate_count BETWEEN 0 AND 1000),
    quote_bytes INTEGER NOT NULL CHECK(quote_bytes BETWEEN 0 AND 4194304),
    oversized_excluded INTEGER NOT NULL CHECK(oversized_excluded BETWEEN 0 AND 32768),
    byte_budget_excluded INTEGER NOT NULL CHECK(byte_budget_excluded BETWEEN 0 AND 32768),
    discovery_cutoff INTEGER NOT NULL CHECK(discovery_cutoff IN (0,1)),
    pool_cutoff INTEGER NOT NULL CHECK(pool_cutoff IN (0,1)),
    candidate_cutoff INTEGER NOT NULL CHECK(candidate_cutoff IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(actor_id,request_id)
  );
  CREATE INDEX claim_retrieval_runs_claim ON claim_retrieval_runs(claim_id,id);
  CREATE TRIGGER claim_retrieval_runs_context BEFORE INSERT ON claim_retrieval_runs BEGIN
    SELECT RAISE(ABORT,'retrieval context changed') WHERE
      NEW.context_version_id IS NOT (SELECT MAX(id) FROM claim_context_versions WHERE claim_id=NEW.claim_id)
      OR (SELECT claim_id FROM claim_context_versions WHERE id=NEW.context_version_id) IS NOT NEW.claim_id;
  END;
  CREATE TABLE claim_retrieval_variants (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES claim_retrieval_runs(id),
    ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
    query TEXT NOT NULL CHECK(length(trim(query)) BETWEEN 1 AND 500 AND length(CAST(query AS BLOB))<=500),
    normalized_query TEXT NOT NULL CHECK(length(normalized_query) BETWEEN 1 AND 500),
    raw_scanned INTEGER NOT NULL CHECK(raw_scanned BETWEEN 0 AND 2048),
    normalized_scanned INTEGER NOT NULL CHECK(normalized_scanned BETWEEN 0 AND 2048),
    fts_scanned INTEGER NOT NULL CHECK(fts_scanned BETWEEN 0 AND 4096),
    discovered_count INTEGER NOT NULL CHECK(discovered_count BETWEEN 0 AND 4096),
    raw_cutoff INTEGER NOT NULL CHECK(raw_cutoff IN (0,1)),
    normalized_cutoff INTEGER NOT NULL CHECK(normalized_cutoff IN (0,1)),
    discovery_cutoff INTEGER NOT NULL CHECK(discovery_cutoff IN (0,1)),
    exact_count INTEGER NOT NULL CHECK(exact_count>=0),
    phrase_count INTEGER NOT NULL CHECK(phrase_count>=0),
    normalized_count INTEGER NOT NULL CHECK(normalized_count>=0),
    fts_count INTEGER NOT NULL CHECK(fts_count>=0),
    outcome TEXT NOT NULL CHECK(outcome IN ('results','no_results')),
    UNIQUE(run_id,ordinal)
  );
  CREATE TABLE claim_retrieval_results (
    run_id INTEGER NOT NULL REFERENCES claim_retrieval_runs(id),
    ordinal INTEGER NOT NULL CHECK(ordinal>=0),
    passage_id INTEGER NOT NULL REFERENCES research_passages(id),
    source_retrieval_id INTEGER REFERENCES source_retrievals(id),
    extraction_id INTEGER REFERENCES extraction_manifests(id),
    receipt_id INTEGER REFERENCES fetch_receipts(id),
    original_sha256 TEXT REFERENCES original_objects(sha256),
    tier TEXT NOT NULL CHECK(tier IN ('exact','phrase','normalized','fts')),
    variant_ordinal INTEGER NOT NULL CHECK(variant_ordinal BETWEEN 0 AND 7),
    PRIMARY KEY(run_id,ordinal), UNIQUE(run_id,passage_id)
  );
  CREATE TRIGGER claim_retrieval_results_provenance BEFORE INSERT ON claim_retrieval_results BEGIN
    SELECT RAISE(ABORT,'retrieval provenance mismatch') WHERE
      NEW.source_retrieval_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM research_passages p JOIN research_documents d ON d.id=p.document_id
        JOIN source_items s ON s.id=d.source_id
        JOIN document_originals origin ON origin.document_id=d.id
        JOIN original_objects object ON object.sha256=origin.sha256
        JOIN source_retrievals sr ON sr.source_id=s.id AND sr.sha256=origin.sha256
        WHERE p.id=NEW.passage_id AND sr.id=NEW.source_retrieval_id
          AND NEW.original_sha256=origin.sha256 AND sr.status=200 AND sr.final_url=s.url
          AND sr.mime=object.mime AND (
            (NEW.extraction_id IS NULL AND NEW.receipt_id IS NULL
              AND d.extraction_method='utf8-v1' AND sr.method='manual_import' AND sr.url=s.url)
            OR (NEW.extraction_id IS NOT NULL AND sr.method IN ('http','wayback')
              AND EXISTS(SELECT 1 FROM extraction_manifests em JOIN fetch_receipts receipt
                ON receipt.id=em.receipt_id JOIN fetch_jobs job ON job.id=receipt.job_id
                WHERE em.id=NEW.extraction_id
                AND em.document_id=d.id AND em.original_sha256=origin.sha256
                AND receipt.id=NEW.receipt_id AND receipt.status=200 AND receipt.retention='private'
                AND receipt.sha256=sr.sha256 AND receipt.url=sr.url
                AND receipt.final_url=sr.final_url AND receipt.retrieved_at=sr.retrieved_at
                AND receipt.mime=sr.mime AND receipt.size=object.size
                AND job.source_policy_id=s.source)))
      );
    SELECT RAISE(ABORT,'extraction provenance mismatch') WHERE
      (NEW.extraction_id IS NULL AND NEW.receipt_id IS NOT NULL) OR
      (NEW.extraction_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM extraction_manifests em JOIN fetch_receipts receipt ON receipt.id=em.receipt_id
        JOIN fetch_jobs job ON job.id=receipt.job_id
        JOIN research_passages p ON p.document_id=em.document_id
        JOIN research_documents d ON d.id=em.document_id JOIN source_items s ON s.id=d.source_id
        JOIN document_originals origin ON origin.document_id=em.document_id AND origin.sha256=em.original_sha256
        JOIN original_objects object ON object.sha256=origin.sha256
        WHERE em.id=NEW.extraction_id AND p.id=NEW.passage_id
          AND receipt.id=NEW.receipt_id AND receipt.status=200 AND receipt.retention='private'
          AND receipt.sha256=em.original_sha256 AND NEW.original_sha256=em.original_sha256
          AND receipt.final_url=s.url AND receipt.mime=object.mime AND receipt.size=object.size
          AND job.source_policy_id=s.source));
    SELECT RAISE(ABORT,'unbound original provenance') WHERE
      NEW.original_sha256 IS NOT NULL AND NEW.extraction_id IS NULL AND NEW.source_retrieval_id IS NULL;
  END;
  CREATE INDEX claim_retrieval_results_passage ON claim_retrieval_results(passage_id);
  INSERT INTO rebuild_migrations(version) VALUES(25);`);
  for(const table of ['claim_retrieval_runs','claim_retrieval_variants','claim_retrieval_results'])
    for(const operation of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER ${table}_no_${operation.toLowerCase()}
      BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'retrieval audit is immutable'); END;`);
}
module.exports={migrateRetrieval};

// Explicit initialization only: importing this module never opens a database.
const Database = require('better-sqlite3');
const { createHash, randomUUID } = require('crypto');
const { normalizePassage } = require('./retrieval/normalize');
const SCHEMA_VERSION = 33;
const configuredConnections = new WeakSet();

function configureDatabaseConnection(db) {
  if (!configuredConnections.has(db)) {
    db.function('normalize_passage', {deterministic:true}, normalizePassage);
    configuredConnections.add(db);
  }
  return db;
}

function migrate(db) {
  configureDatabaseConnection(db);
  db.transaction(() => {
    const hasVersions = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rebuild_migrations'").get();
    if (hasVersions && db.prepare('SELECT MAX(version) AS version FROM rebuild_migrations').get().version > SCHEMA_VERSION) {
      throw new Error('Database schema is newer than this application');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS rebuild_migrations (
        version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    if (!db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=1').get()) {
    db.exec(`
      CREATE TABLE source_items (
        id INTEGER PRIMARY KEY,
        source TEXT NOT NULL, url TEXT, title TEXT NOT NULL,
        evidence TEXT NOT NULL, published_at TEXT,
        fetched_at TEXT NOT NULL, content_hash TEXT NOT NULL,
        UNIQUE(source, content_hash)
      );
      CREATE TRIGGER source_items_no_update BEFORE UPDATE ON source_items
        BEGIN SELECT RAISE(ABORT, 'source evidence is immutable'); END;
      CREATE TRIGGER source_items_no_delete BEFORE DELETE ON source_items
        BEGIN SELECT RAISE(ABORT, 'source evidence is immutable'); END;
      CREATE TABLE rebuild_jobs (
        id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES source_items(id),
        stage TEXT NOT NULL, policy_version TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued'
          CHECK(state IN ('queued','leased','retry_wait','done','exhausted')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
        next_attempt INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT, lease_until INTEGER, last_error TEXT,
        UNIQUE(source_id, stage, policy_version)
      );
      CREATE INDEX rebuild_jobs_ready ON rebuild_jobs(state, next_attempt, lease_until);
      INSERT INTO rebuild_migrations(version) VALUES (1);
    `);
    }
    require('./research-schema').migrateResearch(db);
    require('./migrations/003-research-lifecycle').migrateLifecycle(db);
    require('./migrations/004-claim-context').migrateClaimContext(db);
    require('./migrations/005-source-provenance').migrateSourceProvenance(db);
    require('./migrations/006-auth-sessions').migrateAuth(db);
    require('./migrations/007-google-identities').migrateGoogleIdentities(db);
    require('./migrations/008-role-audit').migrateRoleAudit(db);
    require('./migrations/009-original-objects').migrateOriginalObjects(db);
    require('./migrations/010-assessment-review').migrateAssessmentReview(db);
    require('./migrations/011-passage-search').migratePassageSearch(db);
    require('./migrations/012-model-budget').migrateModelBudget(db);
    require('./migrations/013-model-call-audit').migrateModelCallAudit(db);
    require('./migrations/014-claim-jobs').migrateClaimJobs(db);
    require('./migrations/015-claim-decisions').migrateClaimDecisions(db);
    require('./migrations/016-provider-permission').migrateProviderPermission(db);
    require('./migrations/017-fetch-admission').migrateFetchAdmission(db);
    require('./migrations/018-fetch-jobs').migrateFetchJobs(db);
    require('./migrations/019-fetch-receipts').migrateFetchReceipts(db);
    require('./migrations/020-extraction-manifests').migrateExtractionManifests(db);
    require('./migrations/021-extraction-review').migrateExtractionReview(db);
    require('./migrations/022-extraction-renders').migrateExtractionRenders(db);
    require('./migrations/023-source-chains').migrateSourceChains(db);
    require('./migrations/024-claim-research').migrateClaimResearch(db);
    require('./migrations/025-retrieval').migrateRetrieval(db);
    require('./migrations/026-budget-operations').migrateBudgetOperations(db);
    require('./migrations/027-provider-failures').migrateProviderFailures(db);
    require('./migrations/028-claim-job-recovery').migrateClaimJobRecovery(db);
    require('./migrations/029-work-admission').migrateWorkAdmission(db);
    require('./migrations/030-analysis-verification').migrateAnalysisVerification(db);
    require('./migrations/031-analysis-verification-jobs').migrateAnalysisVerificationJobs(db);
    require('./migrations/032-publication').migratePublication(db);
    require('./migrations/033-publication-delivery').migratePublicationDelivery(db);
  }).immediate();
}

function openStore(filename) {
  if (!filename) throw new Error('Explicit database path is required');
  const db = configureDatabaseConnection(new Database(filename));
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function saveSource(db, item) {
  const source = required(item.source, 'source');
  const title = required(item.title, 'title');
  const evidence = required(item.evidence, 'evidence');
  let url = null;
  if (item.url != null) {
    const parsed = new URL(item.url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Source URL must be HTTP(S) without credentials');
    }
    parsed.hash = '';
    url = parsed.href;
  }
  // Identity includes title/evidence/date so updates at one URL remain separate snapshots.
  const publishedAt = item.publishedAt == null ? null : new Date(item.publishedAt).toISOString();
  const hash = createHash('sha256').update(JSON.stringify([url, title, evidence, publishedAt])).digest('hex');
  db.prepare(`INSERT INTO source_items(source,url,title,evidence,published_at,fetched_at,content_hash)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(source,content_hash) DO NOTHING`)
    .run(source, url, title, evidence, publishedAt, new Date().toISOString(), hash);
  return db.prepare('SELECT * FROM source_items WHERE source=? AND content_hash=?').get(source, hash);
}

function enqueue(db, sourceId, stage, policyVersion, maxAttempts = 3) {
  required(stage, 'stage');
  required(policyVersion, 'policyVersion');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error('maxAttempts must be an integer from 1 to 10');
  }
  db.prepare(`INSERT INTO rebuild_jobs(source_id,stage,policy_version,max_attempts)
    VALUES (?,?,?,?) ON CONFLICT(source_id,stage,policy_version) DO NOTHING`)
    .run(sourceId, stage, policyVersion, maxAttempts);
  return db.prepare('SELECT * FROM rebuild_jobs WHERE source_id=? AND stage=? AND policy_version=?')
    .get(sourceId, stage, policyVersion);
}

function ingest(db, item, policyVersion) {
  return db.transaction(() => {
    const source = saveSource(db, item);
    const job = enqueue(db, source.id, 'classify', policyVersion);
    return { source, job };
  }).immediate();
}

function claim(db, { stage, now = Date.now(), leaseMs = 60000 } = {}) {
  required(stage, 'stage');
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new Error('Invalid lease clock/duration');
  }
  return db.transaction(() => {
    if (require('./ops/work-admission').isPaused(db)) return null;
    db.prepare(`UPDATE rebuild_jobs SET state='exhausted', lease_token=NULL, lease_until=NULL,
      last_error='lease_expired' WHERE state='leased' AND lease_until<=? AND attempts>=max_attempts`).run(now);
    const job = db.prepare(`SELECT * FROM rebuild_jobs WHERE stage=? AND attempts<max_attempts
      AND ((state IN ('queued','retry_wait') AND next_attempt<=?) OR (state='leased' AND lease_until<=?))
      ORDER BY id LIMIT 1`).get(stage, now, now);
    if (!job) return null;
    const token = randomUUID();
    db.prepare(`UPDATE rebuild_jobs SET state='leased', attempts=attempts+1,
      lease_token=?, lease_until=? WHERE id=?`).run(token, now + leaseMs, job.id);
    return db.prepare('SELECT * FROM rebuild_jobs WHERE id=?').get(job.id);
  }).immediate();
}

function finish(db, job, { now = Date.now(), error = null, retryAt = now } = {}) {
  if (error !== null && !/^[a-z_]{1,64}$/.test(error)) throw new Error('Use a sanitized error category');
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(retryAt) || retryAt < now) {
    throw new Error('Invalid retry clock');
  }
  const result = db.prepare(`UPDATE rebuild_jobs SET
    state=CASE WHEN ? IS NULL THEN 'done' WHEN attempts>=max_attempts THEN 'exhausted' ELSE 'retry_wait' END,
    last_error=?, next_attempt=?, lease_token=NULL, lease_until=NULL
    WHERE id=? AND state='leased' AND lease_token=? AND lease_until>?`)
    .run(error, error, retryAt, job.id, job.lease_token, now);
  return result.changes === 1;
}

module.exports = { SCHEMA_VERSION, configureDatabaseConnection, openStore, migrate, saveSource, enqueue, ingest, claim, finish };

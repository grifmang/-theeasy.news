# Easy News production implementation plan

Date: 2026-09-20. Status: planned, not deployed.

For implementation, use the executing-plans skill with review checkpoints. Do not spawn agents unless separately authorized. Preserve unrelated work; do not purchase services, run paid evaluation, change DNS, or publish without the authority specified in the production blueprint.

## Controlling design

Accuracy revision: read [ACCURACY_SPEC.md](../../ACCURACY_SPEC.md) before all
tasks. It overrides earlier small-pilot sample sizes and permissive release
wording. Apply its implementation mapping to tasks 02, 06A–16 and 18–24.
Task 13 is development evaluation; task 13A runs AFTER tasks 14–16 and is a
dependency of tasks 20, 23 and 24. No model score is yet measured.

Read [Production blueprint](../../PRODUCTION_PLAN.md), [Cost model](../../COST_MODEL.md), and [Archival sources](../../ARCHIVAL_SOURCES.md). These define quality gates and scope. This plan supersedes the earlier next-mission sequencing in the worklog. Complete dependencies before each task; task 06A belongs to Phase B. Each task is a reviewable package, not a claim that it fits a few minutes.

## Test and execution conventions

Owner override, 2026-09-26: no new unit tests; preserve existing tests and use
builds/static checks/targeted integration checks during implementation. Defer
writing E2E tests until implementation is finished. This supersedes the new-unit-
test and test-first checklist steps below; it does not waive acceptance, accuracy,
security or release gates. Existing test sketches remain requirement examples.

Tests below are acceptance sketches, not existing exports or paste-ready complete test files. Establish explicit imports and isolated fixtures in each named test file: an in-memory migrated DB, seeded identities/claims/passages, fake clock, mocked provider/transport and temporary object adapter. No network or paid calls in unit tests. `request` is supertest; UI tests use the existing React testing library. Add each introduced export to its module and tests together. Monetary amounts are integer microdollars. All timestamps are validated UTC. Never infer a passed gate from this plan.

For every package: write a failing focused test, confirm the intended failure, implement the smallest coherent change, run focused and full relevant tests, inspect the diff, and record evidence. Do not stage unrelated files or commit without instruction. A failing baseline is recorded and resolved before claiming release readiness. Review security-sensitive changes explicitly before staging.

## Task 01: Reproducible baseline and production configuration

Dependencies: None.

Files: Create server/config.js, server/__tests__/config.test.js, server/.env.example; modify .gitignore, server/package.json; update docs/AGENT_WORKLOG.md.

Contract: loadConfig(env) returns {dbPath, mode, generationEnabled, autoPublishEnabled, dailyBudgetMicros, monthlyBudgetMicros}; rejects invalid/relative production DB paths, malformed booleans, missing required secrets only when that feature is enabled. All paid flags default false.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
expect(loadConfig({ NODE_ENV: 'test', DB_PATH: ':memory:' }).generationEnabled).toBe(false);
expect(() => loadConfig({ NODE_ENV: 'production', DB_PATH: 'data.db' })).toThrow();
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Inventory the dirty worktree without reverting it. Record current tests and frontend build results; install from lockfiles. Add strict configuration parsing, safe example values, and ignores for .env, SQLite/WAL files, backups, artifacts, and logs. Remove the existing ignore rule hiding server/.env.example. Do not hide existing user documentation or stage everything.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Current backend tests plus config tests pass; frontend baseline errors are recorded/fixed before UI changes; secret scan shows no credentials in changes.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 02: Versioned migrations and review lifecycle

Dependencies: 01.

Files: Create server/migrations/003-research-lifecycle.js, server/research-lifecycle.js, server/__tests__/research-lifecycle.test.js; modify server/storage.js, server/research-schema.js, server/migrate.js, server/research.js.

Contract: appendClaimEvent(db,{claimId,actorId,type,reason,supersedesId?}) returns event; getClaimState(db,claimId) derives the latest valid review state. Events and versions are append-only; restrictions are explicit. Actor IDs refer to the application user records introduced in 03/04.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const before = db.prepare('SELECT evidence FROM source_items').all();
migrate(db);
expect(db.prepare('SELECT evidence FROM source_items').all()).toEqual(before);
expect(getClaimState(db, claimId).status).toBe('unreviewed');
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Extract ordered migration registration without rerunning v1/v2. Add claims observed_at/time/entity qualifiers, normalization/supersession links, source access policy and retrieval records using additive tables. Add lifecycle events instead of updating the trigger-frozen status. Validate slug type strictly. Detect unknown newer DB versions. Add init-db command for a new explicit path; keep existing-DB migration backup-first. Test all versions and rollback on conflict.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Fresh schema, v1→current, v2→current, repeated migration, interrupted transaction, legacy record preservation and restored backup all pass; restrictions/supersession have documented semantics.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 03: Testable API and safe service lifecycle

Dependencies: 01–02.

Files: Create server/app.js, server/bootstrap.js, server/legacy-schema.js, server/__tests__/app.test.js; modify server/index.js, server/storage.js, server/package.json, server/scheduler.js.

Contract: createApp({db,config,services}) returns Express app without listening; startService(config) opens one store, migrates during an explicit maintenance/startup sequence, then starts HTTP and the guarded runner. stop() drains jobs and closes handles.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const app = createApp({ db, config, services: fakeServices });
expect((await request(app).get('/health/ready')).status).toBe(200);
expect(fakeServices.models.call).not.toHaveBeenCalled();
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Move routes from index into testable modules without introducing new behavior except safe startup. Consolidate legacy schema creation including old columns; WAL and foreign keys on every connection. Add /health/live and /health/ready (schema/DB only). Mount a versioned /api/v1 boundary. Disable legacy generation startup permanently. Catch startup failures and handle termination with deadline/lease recovery.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Imports create no listeners/files/provider calls; readiness fails for wrong schema; graceful stop tested with active ingestion; restart recovers jobs. Add supertest as a pinned dev dependency.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 04: Identity, ownership and editor authorization

Dependencies: 03.

Files: Create server/auth.js, server/routes/auth.js, server/__tests__/auth.test.js, server/__tests__/authorization.test.js; modify server/app.js, server/research.js, theeasynews/src/components/Login.jsx, theeasynews/src/App.js.

Contract: requireUser resolves an expiring DB session; requireEditor checks DB role; requireCsrf validates Origin/token for mutations. public claims cannot assign reviewer or role. provision-editor is an operator CLI, never a public endpoint.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
expect((await asUserA.get('/api/user/'+userB.id+'/saved')).status).toBe(403);
expect((await asReader.post('/api/v1/editor/claims').send(claimInput)).status).toBe(403);
expect((await anonymous.get('/api/v1/editor/claims')).status).toBe(401);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Use verified Google subject for editor identity and exact audience/issuer checks; prevent unsafe linking by unverified email. Bootstrap roles out of band. Preserve reader accounts with robust password input validation, no password login for OAuth-only accounts, revocable hashed session tokens, 7-day absolute and 24h idle expiry. Set secure HttpOnly cookies, SameSite and CSRF/Origin checks; remove browser token storage. Fix saved-article ownership, disable unrestricted author/article creation, set proxy trust to actual topology, cap login attempts per real client.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Cross-user IDOR, role escalation, session expiry/revocation, OAuth audience/identity mismatch, CSRF, missing/wrong types, and secret/log tests pass. No public editor registration.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 05: Original-object archive and provenance

Dependencies: 02.

Files: Create server/evidence/archive.js, server/evidence/provenance.js, server/__tests__/archive.test.js, server/migrations/004-archive.js; modify server/import-research.js, server/research.js.

Contract: archiveOriginal({bytes,mime,accessPolicy}) returns {sha256,key,size}; registerFetch(db,{sourceId,url,finalUrl,status,retrievedAt,sha256,headers}) returns record. Object adapter supports put/get/head with local fixture and private S3-compatible implementations.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const a = await archiveOriginal({ bytes: Buffer.from('fixture'), mime: 'text/plain', accessPolicy: 'private' });
const b = await archiveOriginal({ bytes: Buffer.from('fixture'), mime: 'text/plain', accessPolicy: 'private' });
expect(a.key).toBe(b.key);
expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Hash original bytes, store privately by hash, retain retrieval/extraction lineage separate from old text hashes. Reject public-read permissions by default. Set max object size 25 MB initially; oversized documents require reviewed chunking/import, never silent truncation. Validate size/hash on reads. Separate restricted originals and public permitted excerpts; credentials least-privilege per bucket. Protect keys from path traversal and never derive storage path from document title.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Identical bytes deduplicate, altered bytes version, restricted originals cannot be fetched anonymously, corruption is detected, failed DB/object steps reconcile without losing provenance.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 06: Safe non-RSS discovery and fetching

Dependencies: 04–05.

Files: Create server/discovery/registry.js, server/discovery/fetch-document.js, server/discovery/manual.js, server/__tests__/fetch-document.test.js; modify server/scrape.js.

Contract: fetchDocument({url,sourcePolicy,signal},transport) returns {bytes,mime,finalUrl,headers,status}; discover({topicId,query,cursor},sourceAdapter) returns candidate URLs plus continuation. Editor-only intake creates jobs, never fetches on public GET.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
await expect(fetchDocument({ url:'http://127.0.0.1/private', sourcePolicy, signal }, fakeTransport)).rejects.toMatchObject({ code:'blocked_target' });
expect(fakeTransport.request).not.toHaveBeenCalled();
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Implement curated-source registry with allowed hosts, permitted content/access, rate/robots policy, backoff and attribution. Manual URL/file imports first; RSS remains optional. Revalidate scheme/DNS/address at every redirect (max 3), pin verified address, deny private IPv4/IPv6 and credentials, enforce 15s timeout and 25 MB decompressed limit, record conditional ETag/Last-Modified, isolate cookies. Do not bypass logins/CAPTCHAs. Authorized repository APIs and paid search plug into the adapter only with known terms/pricing. Sanitize logs.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Local/metadata IPv4, IPv6/mapped addresses, redirect-to-private, DNS rebinding, oversized/compressed payload, timeout, MIME mismatch and credential leakage tests pass. No live crawling in CI.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 06A: Historical web archive connectors

Dependencies: 05–06.

Files: Create server/discovery/wayback.js, server/discovery/archive-link.js, server/__tests__/web-archives.test.js; extend provenance migration and DTO contracts.

Contract: lookupCaptures({originalUrl,before,limit},adapter) returns fixed snapshot URLs with actual capturedAt; importArchiveSnapshot validates originalUrl, provider, archiveUrl, retrievedAt, hash and completeness. before is an inclusive UTC capture cutoff, not a requested nearest date.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
expect(captures.every(c => c.capturedAt <= cutoff)).toBe(true);
expect(new Set(originalAndArchived.map(d => d.originChain)).size).toBe(1);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Implement bounded Wayback availability/CDX discovery after a live read-only compatibility check. Start archive.is with editor-supplied exact snapshot URLs; evaluate its documented Memento interface before automation. Cache lookup results, back off on rate limits, and never bypass challenges. Keep archive copies in original source chains. Separate publication date, capture date, and retrieval date. Quarantine missing content and replay contamination. Do not submit new captures by default.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Fixtures cover nearest capture after cutoff, missing capture, changed page, duplicate archives, live resource fallback, challenge pages, malformed timestamps, and restricted originals; archives never confer truth or extra independence.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 07: Document extraction, OCR and verifiable citations

Dependencies: 05–06.

Files: Create server/evidence/extract-html.js, server/evidence/extract-pdf.js, server/evidence/ocr.js, server/evidence/passages.js, server/__tests__/extraction.test.js, server/__tests__/fixtures/documents/; modify server/research.js.

Contract: extractDocument({objectKey,mime},tools) returns {text,pages:[{page,start,end}],quality,extractorVersion}; createPassages extracts offsets from that immutable text and returns stable IDs/locators.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const extracted = await extractDocument(scannedFixture, sandboxTools);
expect(extracted.pages[0].page).toBe(1);
expect(extracted.quality.requiresReview).toBe(true);
expect(extracted.text).not.toContain('invented');
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Evaluate/pin maintained HTML readability and PDF tools; use native PDF text before local OCR. Child process gets temp directory, CPU/memory/time limits and no external network; arguments are arrays, never shell-built. Reject corrupt/encrypted content. Preserve page boundaries, footnotes, tables and OCR uncertainty. Validate citations against rendered originals; cap extraction work and quarantine low fidelity. Mark text provenance and extraction version; no hallucinated text completion.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Fixtures for native PDF, scanned PDF, multicolumn, table, footnote, redaction, broken/encrypted file, timeout and malicious filename pass; sample names/dates/amounts match originals. No auto acceptance based solely on OCR score.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 08: Claims, source chains and counterevidence workflow

Dependencies: 02,04,07.

Files: Create server/claims.js, server/source-chains.js, server/routes/editor.js, server/__tests__/claims.test.js; modify server/research.js, server/import-research.js.

Contract: proposeClaim({topicId,original,attribution,originUrl,qualifiers}) returns unreviewed claim version; linkSourceChain({documentId,parentId,reason,actorId}) records provenance; buildEvidencePacket(db,claimId) returns versioned candidate passages, counterevidence and coverage gaps.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const packet = buildEvidencePacket(db, claimId);
expect(packet.coverage).toHaveProperty('gaps');
expect(packet.sources.filter(s => s.originChain===chainId)).toHaveLength(1);
expect(packet.claim.status).toBe('unreviewed');
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Preserve original and normalized wording separately; split compound claims only with review. Require origin/observation context. Add related/duplicate claim links without destructive merge. Model suggestions never establish entity identity. Record search attempts and inaccessible sources. Add source-chain ancestry/dedup projections with cycle protection. Reviewer event binds actor ID from auth. Introduce claim-specific coverage states and explicit disputed/unknown handling.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: One document supports several claims; one claim has conflicting passages; duplicated reports do not inflate independent-source count; identity ambiguity and normalized wording retain review history.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 09: Retrieval with measurable recall

Dependencies: 07–08.

Files: Create server/retrieval/index.js, server/retrieval/search.js, server/migrations/005-search.js, server/__tests__/retrieval.test.js; modify server/evidence/passages.js.

Contract: retrieveCandidates({claimId,limit:30,queryVariants},db) returns {passages,searchLog,coverage}; result preserves document/page IDs and unfiltered provenance.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const result = retrieveCandidates({ claimId, limit:30, queryVariants:['fixture claim','fixture denial'] }, db);
expect(result.passages.map(p=>p.id)).toContain(knownContradictionId);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Build FTS5 index over passage text and metadata. Bound/escape query input, add exact docket/entity/date filters and reviewed aliases. Search supporting and challenging formulations. Rank per claim, diversify source chains without dropping unique contradictions, keep neighboring context. No verdict from retrieval rank. Add hybrid embeddings only if the held-out recall gate fails; store vectors locally initially and compare against FTS-only ablation.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Known relevant/counterevidence recall measured, source duplicates controlled, malicious query and empty results safe, restriction/retraction updates remove inaccessible material from eligible results.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 10: Cost ledger and call admission

Dependencies: 01–03.

Files: Create server/models/budget.js, server/models/prices.json, server/migrations/006-model-budget.js, server/__tests__/budget.test.js.

Contract: reserveCost(db,{requestKey,category,maxMicros,now}) returns reservation or budget_exhausted; settleCost(db,{reservationId,actualMicros,status}) records billed/unknown outcomes. Integer microdollars only; unknown prices deny admission.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
expect(reserveCost(db,{requestKey:'second',category:'model',maxMicros:900000,now})).toMatchObject({ status:'budget_exhausted' });
expect(db.prepare('SELECT COUNT(*) n FROM model_reservations').get().n).toBe(1);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Implement transactional daily/monthly/category totals including outstanding reservations. Bound input/output tokens and concurrent calls. Store price version, estimated/reported usage, retries and unknown charges. Reserve maximum permitted cost before each call, including reasoning/tool charges where applicable. Disable automatic retries in SDK adapters so one layer owns retry budget. Pause research when exhausted; published reading stays available. Add operator budget view and alert events.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Two-connection reservation race, duplicate keys, midnight/month rollover, timeout unknown charge, retry accounting, max output and manual budget change all tested; no negative or floating-point money.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 11: Jev adapter and versioned decision policy

Dependencies: 08–10.

Files: Create server/models/jev.js, server/models/questions.js, server/models/policy.js, server/__tests__/jev.test.js, server/__tests__/policy.test.js.

Contract: evaluatePassage({claim,passage,context,model,questionVersion},client) returns {model,answers,usage,requestId}; routeDecision(answer,policy) returns recommend/review/abstain only in shadow mode.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
expect(routeDecision({ choice:'supports', confidence:0.99 }, { mode:'shadow' })).not.toBe('publish');
await expect(evaluatePassage(input, malformedClient)).rejects.toMatchObject({ code:'invalid_response' });
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Implement against current official TypeSafe contract using injected transport and pinned evaluated model ID. Batch only independent questions sharing bounded state. Validate keys, option values, finite probabilities, distributions and confidence; Noul has no invented confidence. Reject mismatched responses, log sanitized request IDs, honor abort/deadline. Explicitly distinguish direct relevance, relation, and evidence type. Retain full distributions; all publication paths still require editor approval.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Mock contract tests cover each Choice/Noul/Score shape used, malformed/unknown fields, injected instructions, auth/rate errors and no-key mode. No paid calls without approved evaluation budget.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 12: Durable claim jobs and decision audit

Dependencies: 02,10–11.

Files: Create server/jobs/claim-jobs.js, server/jobs/runner.js, server/models/audit.js, server/migrations/007-claim-jobs.js, server/__tests__/claim-jobs.test.js; modify server/scheduler.js, server/bootstrap.js.

Contract: enqueueClaimJob({claimVersionId,passageId,stage,modelVersion,policyVersion}) returns job; runNext({db,providers,clock}) commits result/audit/state using fenced lease; renewLease(job,now) preserves only current ownership. commitDecision(db,lease,result) returns false for stale ownership; otherwise atomically persists the result.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
expect(commitDecision(db, staleLease, result)).toBe(false);
expect(db.prepare('SELECT COUNT(*) n FROM model_decisions WHERE request_key=?').get(key).n).toBe(1);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Add separate claim-target jobs rather than overloading source IDs. Commit result/audit/job completion atomically after network; use deterministic request key and recover ambiguous provider outcomes conservatively. Lease renewals bounded by task deadline, jittered backoff/Retry-After, three total attempts inclusive of SDK behavior. Authentication/config errors pause provider queue. Expired/exhausted items create review events. Graceful shutdown and idempotent replay do not republish.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Two workers, stale lease, restart mid-call, provider success/DB failure, cancellation, retries, duplicate response, budget exhaustion, and atomic audit failure are covered. Model calls never run in a DB transaction.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 13: Real pilot corpus and offline evaluation

Dependencies: 06–12.

Files: Create research/pilot/manifest.json, evals/labels.schema.json, evals/splits.json, server/evals/run.js, server/evals/metrics.js, docs/evaluation/pilot-report.md, server/__tests__/metrics.test.js.

Contract: runEvaluation({manifest,split,models,budget,live:false}) returns report; metrics include per-class precision/recall, recall@30, coverage, confusion matrix, Wilson intervals, latency and actual usage.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
expect(wilsonInterval({ successes:0, total:0 })).toBeNull();
expect(recallAtK({ expected:['a','b'], retrieved:['a'], k:30 })).toBe(0.5);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Acquire 50 attributed claims/100–200 useful documents gradually with permitted access; no synthetic allegations about real people. Adjudicate ≥300 claim/passage pairs plus critical cases, use 60/20/20 family/chain splits, store restricted corpus outside git. Double-review disagreements. First run mocked/cached; request bounded live budget only when ready. Evaluate candidate Jev prompts and writers against blind human labels; record unknowns and failures rather than marking anticipated quality as achieved.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Report includes reproducible manifest/hash/version, split leakage check, counts, quality gates, spend and human review time. Paid/source access absent means manual collection can continue; automated quality claims remain blocked.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 14: Grounded writer with measured model selection

Use the task-13 development benchmark for model selection; task 13A confirms
the frozen full pipeline only after writing, verification and review exist.

Dependencies: 10,12–13.

Files: Create server/models/writer.js, server/models/reviewer.js, server/analysis/draft.js, server/__tests__/draft.test.js; modify server/generate.js.

Contract: draftAnalysis({claimVersionId,evidencePacket,model,promptVersion},client) returns structured blocks/assertions/citations/uncertainties, no publication; reviewAnalysis returns proposed corrections with evidence refs.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const draft = await draftAnalysis(input, fixtureClient);
expect(draft).toHaveProperty('uncertainties');
expect(draft.citations.every(c => packetPassageIds.includes(c.passageId))).toBe(true);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Select writer from gate-passing evaluation candidates, preserve provider-replaceable interface and exact model IDs. Supply only evidence/context needed, yet retain conflicting passages. Require attribution and as-of/coverage limitations. Isolate legacy generate command behind explicit legacy flag or remove production entry point. Add one bounded revision then human review. Add Batch adapter only after synchronous idempotency/usage works and nonurgent workload justifies its maintenance.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Sparse/contradictory evidence cannot produce an unqualified finding, no title-only generation, capped output/cost, provider outage, malformed structure and revision cap tested.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 15: Assertion coverage and citation verification

Dependencies: 07,11,14.

Files: Create server/analysis/verify.js, server/analysis/coverage.js, server/__tests__/verification.test.js.

Contract: verifyAnalysis({draft,packet,policy},decisionAdapter) returns {blockingIssues,assertions,coverage,checkedVersionHash}; checks every factual block and citation before review.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const report = await verifyAnalysis({ draft: draftWithUnmappedAssertion, packet, policy }, fakeJev);
expect(report.blockingIssues.map(i=>i.code)).toContain('unmapped_assertion');
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Verify referenced source/claim IDs, exact quote spans and page maps; independently inspect sentence-level factual assertions, including ones omitted from writer claim list. Run Jev relation judgments on sufficient surrounding context, retaining contradictions/uncertainty. High confidence cannot override hard failures. Extraction flagged for OCR review cannot auto-clear. Recheck all changed blocks after revision; keep earlier results tied to previous version.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Fabricated quote, valid quote with reversed meaning, unsupported number/name, omitted assertion, false locator, outdated source, attribution laundering and prompt injection fixtures all block or require review.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 16: Editorial decisions, corrections and publication transaction

Dependencies: 04,08,12,15.

Files: Create server/publication/service.js, server/publication/outbox.js, server/migrations/008-publication.js, server/__tests__/publication.test.js; modify server/routes/editor.js.

Contract: approveVersion({analysisVersionId,expectedHash,actorId,reason}) records review; publishVersion(...) requires exact-version approval and clean checks; retractVersion(...) emits invalidation; processPublicationOutbox exports approved snapshots idempotently.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
await expect(publishVersion({ analysisVersionId, expectedHash:'stale', actorId })).rejects.toMatchObject({ code:'version_changed' });
expect(db.prepare('SELECT COUNT(*) n FROM publication_events WHERE analysis_version_id=?').get(unapprovedId).n).toBe(0);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Add immutable analysis versions, review events, publication manifest pointer, correction/supersession/retraction events and transactional outbox. Bind authenticated editor actor and reject approval of changed drafts. Human review required for all initial publications. Publish only a sanitized DTO; private evidence excluded. On restriction/retraction, update public index, caches, snapshots and document previews, and track completion. Add owner-only restriction workflow with audit and retention policy.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Draft leakage, stale approvals, duplicate publish, outage mid-export, corrections, retraction cache purge, restricted evidence and recovery of pending outbox tested.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 13A: Independent end-to-end accuracy confirmation

Dependencies: 13–16. Must complete before accuracy-qualified tasks 20, 23 and 24.

Files: create evals/protocol.json, evals/reference.schema.json,
server/evals/accuracy.js, server/__tests__/accuracy.test.js,
docs/evaluation/accuracy-report.md; extend server/evals/run.js and metrics.js.
Restricted labels and evidence live outside git; manifests retain hashes.

Interfaces: wilsonInterval({successes,total}) from metrics.js returns
{lower,upper} or null for zero observations; reject invalid counts.
scoreAccuracy(cases) returns {total,passed,accuracy,interval,criticalErrors,
correctResolutionCoverage,macroAccuracy}; each case has familyId, referenceLabel,
outputLabel, dimensions (five boolean rubric fields), criticalErrors and
referenceResolvable. Missing outputs fail. evaluateAccuracyGate(report) returns
{pass,reasons}; report also includes independentFamilies, protocolValid,
referenceReviewComplete and classCoverageValid. All are required, no defaults
that turn missing evidence into a pass.

- [ ] Freeze protocol, sampling/group split, scope, eligible cases, review budget,
      reference-label schema, five rubric dimensions and reviewer separation
      before running the candidate. Follow the complete accuracy specification.
- [ ] Write focused failing arithmetic, denominator, independence and release tests:

```js
const interval = wilsonInterval({ successes:190, total:200 });
expect(interval.lower).toBeCloseTo(0.910, 3);
expect(wilsonInterval({ successes:90, total:100 }).lower).toBeLessThan(0.90);
expect(wilsonInterval({ successes:0, total:0 })).toBeNull();
// validReport is a frozen 200-family protocol fixture with 190 passing cases,
// complete independent labels, macroAccuracy .95 and resolution coverage .8.
expect(evaluateAccuracyGate(validReport).pass).toBe(true);
expect(evaluateAccuracyGate({...validReport, criticalErrors:1}).pass).toBe(false);
expect(evaluateAccuracyGate({...validReport, independentFamilies:50}).pass).toBe(false);
expect(evaluateAccuracyGate({...validReport, correctResolutionCoverage:0}).pass).toBe(false);
```

- [ ] Run npm test --prefix server -- --runInBand __tests__/accuracy.test.js;
      confirm failures before implementation. Add fixtures for missing output,
      unsupported abstention, correct insufficient-evidence result, missing
      reference class, duplicate source families and post-hoc exclusions.
- [ ] Implement Wilson formula from ACCURACY_SPEC.md and conjunctive gates;
      compute whole-case passes only when all rubric dimensions pass. Retain
      all eligible cases and report every exclusion, abstention and failure.
- [ ] Run focused then full backend tests. Mock every provider in these tests.
- [ ] Collect and double-label the separate 200-family confirmation set; freeze
      versions. Obtain separate authority before live paid calls. Run automation
      and human-reviewed workflow tracks, preserving outputs before edits.
- [ ] Publish internal report with denominators, confidence bounds, class and
      stratum diagnostics, critical failures, review minutes, costs, protocol
      deviations and scope limitations. Insufficient evidence is not a pass.
- [ ] On failure inspect causes, repair on development/regression sets, then
      collect a fresh confirmation set rather than tuning on the final test.
- [ ] Integrate report hash and exact model/policy/config versions into task-23
      staging and task-24 release checks. Verify headline and metadata fidelity.
- [ ] Add task-22 monitoring for independent monthly random audits, separate
      targeted audits, critical-error pause, corrections and revalidation.

Gate: the full ACCURACY_SPEC.md requirements are evidenced in the report;
no averaged component metric, self-confidence, mocked suite or manual correction
may be substituted for independently scored full-pipeline results.

## Task 17: Public read/search API and reader account compatibility

Dependencies: 04,09,16.

Files: Create server/routes/public.js, server/publication/dto.js, server/__tests__/public-api.test.js; modify server/app.js, server/routes/auth.js.

Contract: GET /api/v1/topics, /claims/:id, /analyses/:slug and /search return approved DTOs; GET /api/v1/me/saved uses current identity. Editor and public data serializers are distinct.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
expect((await anonymous.get('/api/v1/analyses/'+draftSlug)).status).toBe(404);
expect((await anonymous.get('/api/v1/search?q=private-fixture')).body.items).toEqual([]);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Public filters apply to direct IDs, pagination, search, saved records and exports. Return text/excerpts and citation metadata, not internal prompts, reviewer emails, keys or restricted source bodies. Use bounded page/query sizes, parameterized search, ETag and cache policies; private responses no-store. Redirect legacy article URLs only after reviewed migration; otherwise present accurate unavailable/legacy status. Add structured API errors and rate limits.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: All routes enforce publication filters; public GET causes zero model calls; pagination/search handling and cache isolation pass.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 18: Reader and editor interfaces

Dependencies: 08,16–17.

Files: Create theeasynews/src/components/Topic.jsx, Claim.jsx, EvidencePanel.jsx, Analysis.jsx, ReviewQueue.jsx, ReviewDetail.jsx, Corrections.jsx; create related component tests; modify App.js, NavBar.jsx, Articles.jsx, Article.jsx, SavedArticles.jsx, styles.

Contract: Reader components consume public DTOs; editor components consume role-protected endpoints. ReviewDetail submits analysisVersionId/expectedHash, never raw authority flags.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
render(<EvidencePanel evidence={allegationFixture} />);
expect(screen.getByText(/allegation/i)).toBeVisible();
expect(screen.queryByText(/court finding/i)).not.toBeInTheDocument();
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Build topic→claim→analysis navigation, readable evidence context, clear epistemic labels, dates, correction history and source links. Editor compares original/extraction/draft and records specific decisions; show cost and failure status where actionable. Handle empty/loading/error/retry states, keyboard navigation, focus, semantic markup and responsive reading. Avoid sensational guilt implication in copy. Keep reader bookmarks if auth gate passed; no hidden administrative controls as substitute for backend auth.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Mocked UI tests plus real staging API flow; every verdict has context/source affordance; keyboard-only review and citation navigation usable; no credentials in built JS.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 19: Public HTML, discoverability and cache correctness

Dependencies: 16–18.

Files: Create server/publication/render.js, server/publication/export.js, server/__tests__/render.test.js; create theeasynews/public/_headers; modify theeasynews/netlify.toml and public metadata files.

Contract: renderPublicAnalysis(dto) returns escaped complete HTML; exportPublication({manifestVersion}) writes public assets and atomically activates a manifest; invalidatePublication({slug,version}) retracts old public access.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const html = renderPublicAnalysis(dto);
expect(html).toContain(dto.title);
expect(html).toContain('rel="canonical"');
expect(html).not.toContain('<script>alert(');
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Reuse the public DTO for static/server rendering with canonical URLs, title/description, Article structured metadata, sitemap and robots rules. No crawler-only special content. Batch routine publication builds, but publish corrections immediately. Choose static host after the cost gate; if Netlify deployment credits do not support cadence, use Cloudflare static assets or measured backend rendering/CDN. Keep private admin noindex/no-store. Cache only allowlisted public responses; never cache Set-Cookie/private data.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: JavaScript-disabled reader sees article/citations, link previews resolve, canonical/direct refresh works, draft URLs absent from sitemap, corrected/retracted content disappears within tested invalidation target.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 20: End-to-end, accessibility and load gates

Dependencies: 18–19.

Files: Create e2e/research.spec.js, e2e/auth.spec.js, e2e/retraction.spec.js, playwright.config.js, scripts/load-test.js; modify package.json.

Contract: npm run test:e2e runs isolated fixtures and mocked providers; npm run test:load targets a specified staging origin with no paid routes.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
await page.goto('/analyses/fixture-analysis');
await expect(page.getByRole('link', { name:/source/i }).first()).toBeVisible();
await expect(page.getByText(/reviewed as of/i)).toBeVisible();
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Cover import→claim→retrieval→decision→draft→review→publish→reader→correction, with reboot/provider outage variants. Test mobile/desktop, keyboard/labels/contrast, slow network, no JS reading and link navigation. Run 20-reader load against public routes during one bounded parser job; verify no cross-user cache data. Screenshot only useful failures and summarize outputs. Clean only test-owned resources.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Quality gates in PRODUCTION_PLAN.md pass with recorded environment/versions; failures block release rather than being waived for budget.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 21: Reproducible builds, CI and deployment artifacts

Dependencies: 03–04,07,20.

Files: Create Dockerfile, .dockerignore, .github/workflows/ci.yml, scripts/check-release.js; modify package scripts and frontend build config only if required.

Contract: CI installs lockfiles, tests backend/UI, builds frontend/container, scans secrets/dependencies, and records artifact digest. Release consumes a tested digest/commit, not a mutable local workspace.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
// Release checker must reject enabled auto-publication or missing tested artifact.
expect(validateRelease({ ...release, autoPublishEnabled:true })).toContain('auto_publish_forbidden');
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Use supported pinned Node/runtime/parser versions and nonroot container where compatible; verify volume permissions instead of blindly granting root. Account for native SQLite compilation on Linux. Add minimal parser binaries, process limits, readiness endpoint, config checks and disabled workers by default. Evaluate CRA dependency risks; migrate to Vite only if audit/build maintenance requires it, preserving route/API behavior with tests. PR builds use mock providers and no production secrets.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Linux CI reproduces passing build/tests; dependency findings triaged for exploitability; no known exploitable critical/high release issues; frontend assets contain no server secrets.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 22: Backups, monitoring and operator controls

Dependencies: 05,12,16,21.

Files: Create server/ops/backup.js, server/ops/metrics.js, server/ops/alerts.js, server/__tests__/backup.test.js, docs/OPERATIONS.md; update DEPLOYMENT_RUNBOOK.md.

Contract: backupAndUpload({db,bucket,retention}) returns encrypted snapshot/hash; restoreCheck(snapshot) verifies schema/content and publication manifests; operator pause toggles job admission while reads stay available.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
const restored = await restoreCheck(snapshot);
expect(restored.integrity).toBe('ok');
expect(restored.publicVersionHash).toBe(expectedHash);
expect(restored.modelCalls).toBe(0);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Daily consistent backup to separate private storage, 7 daily/4 weekly retention, recovery key custody and monthly restore rehearsal. Monitor queue/provider failures, budget, disk, backup age, invalidation errors, citation failures and review backlog. Structured redacted logs with short retention; actionable alerts only. Document RPO/RTO and tested rollback with additive schema. Reconcile outbox/object store after restore. Do not run jobs twice after restoration.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Restore in fresh environment meets 24h RPO/4h RTO target, failed upload/expired key alerts, retention cannot delete last good backup, kill switch and cache invalidation drills pass.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 23: Private staging and release evidence

Dependencies: 13,20–22.

Files: Create docs/releases/staging-report.md, deploy/railway.json, deploy/static-host.md; update COST_MODEL.md with measured usage.

Contract: Staging report includes commit/digest, schema/model/policy versions, quality report, restore result, memory/CPU/traffic cost forecast, editorial approvals, and current account plans. Config defaults paid processing off.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
// Release evidence is a machine-readable checklist plus prose.
expect(report.gates.every(g => g.status === 'pass')).toBe(true);
expect(report.costForecast.totalUsd).toBeLessThanOrEqual(report.approvedBudgetUsd);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: Before provisioning obtain selected account/budget authority. Reuse matching services/volumes only after inventory and backup; never overwrite unknown data. Deploy private staging with isolated secrets/data. Run one approved bounded live research cycle and compare forecast with actual usage; all sensitive pilot output reviewed. Test provider outage, process restart, correction purge, invalidation failure, disk warning and rollback. Shut down temporary staging resources when done.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: All required gates supported by artifacts, not promises. Blocked model/source access is documented; no paid activation, public data or new domain attachment without scope.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

## Task 24: Public cutover and first-month operations

Dependencies: 23.

Files: Create docs/releases/launch-record.md; update DEPLOYMENT_RUNBOOK.md, OPERATIONS.md, AGENT_WORKLOG.md.

Contract: Launch record captures selected host IDs, domain/NS records before and after, TLS checks, published manifest hash, backup ID, rollback target, budget and responsible editor.

- [ ] Read current implementations and dependency outputs; reconcile existing changes without reverting them.
- [ ] Add isolated failing tests for the contract and all failure cases in the gate below.

```js
// Run bounded public smoke checks without creating accounts or paid jobs.
expect(smoke.https && smoke.citations && smoke.noDraftLeak && smoke.canonical).toBe(true);
```

- [ ] Run the focused test and verify it fails for the intended missing behavior.
- [ ] Implement: After explicit release approval, export DNS and preserve _atproto; confirm registrar delegation, old service recovery, canonical hostname and OAuth origins. Publish ten fully reviewed analyses or fewer if quality gate delays some; never invent filler to meet count. Attach domain, verify apex/www/HTTPS/direct paths/API/auth/search/robots/citations, retain paid kill switch and manual publication. For seven days inspect daily usage/errors/corrections; weekly quality sample, monthly restore and cost review. No automatic expansion until measured readiness.
- [ ] Run the focused tests, then the full relevant suite/build; backend default: `npm test -- --runInBand` from `server/`. Use package-specific frontend/e2e commands after their scripts are introduced.
- [ ] Verify gate: Public smoke evidence and rollback target recorded; all model publications still require human approval; 30-day review compares cost/quality to plan and prioritizes measured bottlenecks.
- [ ] Review diff/security implications and record command results, unresolved risks and next dependency in the worklog. Stop at any external authority boundary.

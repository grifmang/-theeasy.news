## 2026-09-26 — Task13 offline evaluator and Task12 provider recovery UI

`server/evals/run.js` plus `server/evals/metrics.js` provide a v2 offline,
fail-closed evaluation pipeline. It models retrieval queries separately from
classification cases, with at most one ranked top-30 result per claim/query.
`retrievalSnapshotSha256` binds the corpus, documents, passages, retrieval
configuration and cutoff. Input data is deeply snapshotted and frozen before
callbacks or awaits. The runner requires the exact current Jev model pin and
digest and rejects mutable aliases. Manifest checks prevent leakage across
claim families, source chains and passage hashes. Metrics and output include
usage, reviewer time, report hashing, retrieval and classification results;
missing/error/abstain outcomes fail closed.

The repository pilot manifest remains `incomplete`, empty, and explicitly
supports no quality claim. A real 50-case development corpus, 100–200 held-out
cases, >=300-case publication corpus, independent double review and paid model
evaluation do not yet exist. Task14 writer selection remains blocked on a real
gate-passing development benchmark. Full backend suite: 545 passed, 1 optional
skip. Disposable adversarial probes passed; scoped Astra review passed after
two rounds. No live calls were made.

Task12's provider recovery UI is integrated into BudgetPanel. Recovery uses
exact pause-version compare-and-set, audited reason and idempotent continuation
in pages of at most 100 jobs. Frontend results: 18/18 relevant tests, lint,
public-config boundary and build passed; independent Luna review passed.
Classification remains disabled with zero budget. Follow-up polish observations:
success wording when the cursor is invalid, and clearer retry guidance after 409.

Release/runtime facts did not change: local schema28; Railway runtime and DB
schema21; no schema28 release image, migration or rollback rehearsal. No
production data, deployment, configuration, DNS, or paid/live provider state
was changed. See [RESUME](RESUME.md) and [offline evaluation gates](MODEL_ARCHITECTURE.md#offline-evaluation-and-gates).

# Verified state and handoff

## 2026-09-26 — Task12 claim-job recovery (local only)

Local runtime requires schema28; Railway runtime and active database remain
schema21. Migration028 consolidates recovery schema. Claim jobs use stage
`passage-evaluation-v1`, finite five-minute deadlines and fenced renewal. Job
review events are append-only. Authenticated editor/session/CSRF recovery uses
exact pause-version CAS and request-ID hashing, checks eligibility, current
permission and unresolved holds, and continues in bounded batches of at most
100. Provider success is committed atomically after the network call; saved
split results replay without another call. A partial-recovery index and planner
evidence bound recovery work. Missing-key startup remains fail-closed; runtime
invalid-key detection durably pauses the queue.

Backend suite:545 passed/1 optional skip; disposable probes covered 13 scenarios
and 6,200 jobs. Scoped Astra specification/security review passed. Classification
and default paid flags remain off/zero, requiring private shared persistent
`BUDGET_FAIL_CLOSED_PATH`. Workspace has no retained DB files; prior schema28
probes were disposable; production is schema21. Any separately retained database
from an earlier draft028 must be recreated or explicitly migrated, never assumed
repaired. No schema28 release image, provider/live calls, production mutation,
deployment or E2E completion is claimed. Release needs a fresh matching image,
backup-first schema21→28 migration and matching rollback image/backup. Frontend
provider recovery UI is a classification-enablement prerequisite, not a blocker
to deploying the disabled backend. See `RESUME.md` and `DEPLOYMENT_RUNBOOK.md`.

## 2026-09-26 — Task10/Task11 local budget and provider recovery

Local runtime requires schema27 (migrations026–027); Railway runtime and active
database remain schema21. Task10 delivered schema26 budget guards and the editor
budget operator UI with scoped security and UI reviews. Paid flags require a
private shared persistent `BUDGET_FAIL_CLOSED_PATH`. Task11's pinned Jev adapter
preserves sanitized provider status, bounded Retry-After and validated request
IDs. Provider failures are persisted; authentication/configuration failures pause
the queue. Retries are capped and budgeted, with crash recovery. Missing provider
key fails startup. A permanent-4xx retry issue was fixed; scoped Astra review
passed. Classification and generation flags remain off and budgets zero.

Backend suite:545 passed/1 optional skip; disposable probes passed. No live model
calls, production DB mutation, deployment, or Task12+/E2E completion. There is no
current schema27 release image; the schema23 image is stale. A release needs a
fresh matching image, coordinated backup-first schema21→27 production migration,
and matching rollback image and backup. Authenticated audited compare-and-set
provider unpause and deliberate blocked-job recovery remain prerequisites before
classification can be enabled. See `docs/RESUME.md` and
`docs/DEPLOYMENT_RUNBOOK.md`.

## 2026-09-26 — Task09 deterministic retrieval (local only)

Local runtime now requires schema25; deployed Railway runtime/database remain
schema21. Implemented deterministic `retrieveCandidates` and authenticated
editor `POST /claims/:id/retrieval-runs`, bound to current claim context with
immutable actor/request/variant/result audit. Exact retries return the saved
run; request ID conflicts return409. Search has bounded raw and
NFKC-normalized FTS tiers, pre-limit topic/policy filtering, audited source
chain grouping before pool cap, exact-or-null provenance and 1:1 passage
normalization/byte metadata. Quote/source/response budgets are checked before
hydration, with explicit cutoffs, gaps and history scope. The editor displays
variants, results, provenance, neighboring context, audit and coverage. No
network, embeddings or model calls.

Backend suite:545 passed/1 optional skip. Frontend ResearchDesk18/18, lint,
public-config check and build passed. Disposable RED→GREEN probes covered
starvation, Unicode, chain suppression, provenance, raw UDF runtime/recovery,
resource budgets, HTTP and populated backup-first24→25 migration/integrity/
rollback. Independent Sol/Luna reviews closed all Critical/Important findings.
No frozen independently labeled corpus or measured macro recall@30 / critical
counterevidence results exist; evidence-time cutoff and browser/E2E remain open.
Per-index2048, discovered32768, pool1000 and byte cutoffs mean completeness is
unverified. Deferred Task08 minor: per-claim aggregate manual-ledger budget.
Task09 editor controls were addressed. No production DB, deployment, DNS or
model calls changed. No schema25 candidate image exists; prior schema23 image
is stale and not deployable. Any release requires a fresh image and coordinated
backup-first schema21→25 migration. See `docs/RESUME.md` and
`docs/INGESTION_API.md`.

## 2026-09-26 — PDF process adapter

Added internal evidence/pdf-process.js after disposable sandbox compatibility
probe revealed renderer exit0 could hide font errors. Adapter rejects diagnostics,
limits PDF input25MiB/output8MiB/time5s, fixes operation arguments and waits for
child close before caller cleanup. No HTTP route or unsandboxed fallback.
Actual Linux nonroot sandbox probe through the new adapter accepted synthetic
metadata/bbox text/render (306/894/13622 bytes), no diagnostics; syntax check passed.
Failure-lifecycle integration verification and sealed production PDF bundle remain
next. No new unit tests/production changes. Full task07 and production goal open.

Follow-up integration evidence: actual PDF adapter rejected corrupt input,
nonexistent launcher, real stalled-process cancellation,5s timeout and >8MiB
output. `/proc` child list empty after every promise settled. Durations11/3/103/
5001/11ms respectively. Metadata/text/render still passed. Disposable probe image
0960abb34e0df56c7ce5e3b84c0715445967cdad70d70aba9f06fdc755bb8489 retained outside
release; no new repository tests or production changes. Packaging/page maps next.

## 2026-09-26 — local CI rehearsal and owner testing policy

Ruling: stop authoring unit tests and defer E2E authoring until implementation is
finished, per owner. Preserve existing tests; use builds/static/integration checks.
This changes verification timing/coverage, not product accuracy or security gates.
Recorded in AGENTS.md and the controlling implementation plan so old test-first
steps do not override the owner on resumption.

Local `.github/workflows/ci.yml` inspected; actionlint had passed earlier today.
Clean Linux rehearsal used `easy-news:ci-toolchain` image
`sha256:98818aca63cfc86bd68593c4caa45d805f0b68f001a49c99152e8df37e4328f2`,
UID1000, capabilities dropped, no-new-privileges, read-only source mount and
disposable writable copy. Both npm ci installs, public-config check, ESLint,
Vite build and source staging exited0. Manifest reproduced
`67b1b25435206a97ceb92fc71e46ee65e232c1036ae44927c919e488f0427f68`.
No new test files, production mutation, model calls or GitHub push this turn.
Workflow not run on GitHub; artifact promotion remains a gap. Whole
production objective incomplete; see latest RESUME checkpoint for next work.

Follow-up: added pinned Gitleaks8.24.3 gates before dependency installation
(full fetched history plus source) and for generated release/browser files.
Redaction100%, no verbose/report uploads, inline allow comments ignored, no
baseline added. Verified official CLI documentation before choosing flags.
Actual local scans:44 commits/~1.19MB; clean CI input snapshot/~688KB;
retained backend bundle/~265KB; current browser build/~298KB. Each exited0
with no leaks found. Updated actionlint exited0. These scan scopes do not imply
every ignored/untracked local file or container layer was scanned. No new tests,
paid calls, push or production change. Hosted CI and release promotion pending.

Next continuation: GitHub read-only metadata confirms public repository
grifmang/-theeasy.news, default main, Actions enabled. Requested owner approval
before publishing the large local changes; no push performed. Added existing
native sandbox invocation to CI using the verified-source compiler image.
Actual local UID1000/network-none/cap-drop-all/no-new-privileges run:14 passed,
1 optional Node-archive case skipped, exit0. Actionlint passed. No new unit/E2E
tests authored. Optional archive and root-only cases remain outside this CI step.

## Implementation progress — 2026-09-20

Railway access recovered via Edge and official CLI 5.58.0. Existing service is
offline with no active deployment; visible historical deployments Removed.
CLI authenticated and local directory linked to existing project/environment/
service recorded in DEPLOYMENT_RUNBOOK.md. Volume listing definitively empty
for this environment. Owner permits backend rebuild; asked for specific new
persistent-volume/fresh-DB approval and $10/month target. No remote mutations
other than normal CLI authorization; no deployment, volume or data changes.

Frontend compatible dependency fixes applied without force/lifecycle scripts.
Audit now reports 30 findings (9 low / 7 moderate / 14 high / zero critical),
not a clean security gate. Fresh 19 tests / 3 suites and production build pass;
CRA undeclared Babel dependency warning persists. Main JS is 79.17 kB gzip.
React Router and build-tool findings need targeted remediation; no unsafe
react-scripts@0.0.0 downgrade applied. No deployment or DNS changes.

Compatible backend npm audit fixes applied without force or lifecycle scripts.
Fresh production audit now reports 3 moderate findings and zero high/critical;
281 tests / 37 suites pass after the update. Remaining uuid advisory is through
gaxios/node-cron; inspected installed call sites use v4, unlike the advisory's
v3/v5/v6 buffer APIs. No blanket exemption: target-host clean install, frontend
audit and deployment verification remain. See DEPENDENCY_TRIAGE.md checkpoint.

Read-only backend production dependency audit found 11 vulnerable packages
(1 critical / 5 high / 5 moderate). Dependency paths verified with npm explain;
initial applicability and required closure recorded in DEPENDENCY_TRIAGE.md.
No upgrades applied, no finding waived, no deployment made. Prioritize patched
request-path rate limiting/routing, compatible transitive updates and full
regression tests; do not blindly force the proposed node-cron major upgrade.

Deployment handoff: owner confirms an existing paid Netlify account, not approval
for another paid backend. Latest account inventory found 17 sites and no matching
Easy News name/custom domain. Backend identity/data recovery remain unresolved;
no local Railway CLI/auth configuration, and Docker daemon unavailable. No
deployment, DNS change, billable resource or provider call was made. Updated
runbook from current config/bootstrap/session source: same-origin API proxy is
required for the proposed split-domain staging topology; proxy target, trusted
client-IP handling and hosting-level private access remain release gates.
Removed obsolete environment-variable and API-only bootstrap instructions.

Previous implementation checkpoint: enqueue POST now strips internal lease_token
like GET/list; regression covers re-enqueue of a leased job while preserving the
DB token. Full backend verification recorded 281 passing tests / 37 suites.
This supersedes the follow-up leak warning below, not the unfinished release gates.

Editor UI now prepares a pinned JEV classification job from a source-checked
passage, refreshes the job list and opens its input preview. Preparation does
not grant disclosure; deduplicated existing jobs retain existing permission.
Job controls separately grant/revoke Typesafe disclosure with required reason,
explicit acknowledgement for grants, expected event ID and input hash. UI blocks
grants on unavailable/terminal jobs and stale permission conflicts; explains
charges and that revocation cannot recall already-sent data. No real permission
or provider call was made. Verified 19 frontend tests / 3 suites, 18 focused
backend provider/editor tests and production build. Browser permission/revocation
and conflict scenarios remain to verify; intake/context browser coverage,
editor lifecycle controls, source connectors, accuracy, publication and
deployment remain unfinished. Follow-up API review: enqueue response currently
returns the full job row, unlike GET/list projections that strip lease_token;
strip that internal field on POST responses too, with regression coverage.

Claim context editor added: normalized wording, timeframe, location, optional
strict-UTC observation time, up to 50 named entities with optional identifiers,
and required change rationale. Posts the loaded expected version to the existing
append-only context endpoint; unknown date/identity remain null, original claim
is not overwritten. Superseded claims do not show editing controls. Conflict
retains edits and requires reload; context reload clears selected assessment/job
to avoid stale detail display. Removed misleading 'reviewed context' empty-state
wording: a context version is not itself approval. Verified 17 frontend tests /
3 suites, production build, and focused backend context/editor tests. Browser
context/conflict scenarios still pending, as are source connectors, remaining
editor controls, independent accuracy evaluation, publication and deployment.

Human assessment now loads the full preserved document and highlights the
selected passage. Submission stays disabled until document identity, integer
offset bounds and exact source slice match the retrieved quote. Failed load or
mismatch stays fail-closed with retry guidance. Tests first failed for missing
context and missing mismatch rejection; all 16 frontend tests / 3 suites and
production build now pass. Real local browser verified synthetic claim → FTS
search → full-source view → human assessment save → history refresh through
Express/SQLite, with claim still unreviewed. Local fixture process and browser tab
were stopped afterward. No production data or paid calls. Conflict/history edge
cases, import browser verification, context editing, permission controls, source
connectors, independent accuracy evaluation and deployment remain unfinished.

Claim pane now has topic-scoped lexical passage search and human assessment
forms, with explicit relevance/relation/evidence-type choices and rationale.
Writes bind selected passage and loaded context version; reviewer identity stays
server-derived. Search is labeled non-exhaustive and not a truth judgment;
human labels remain separate from JEV output and do not review/publish the claim.
Assessment history is cursor-paginated and displays actor, rationale and server
stale-context flag. A context conflict disables resubmission until reload.
Verified 15 frontend tests / 3 suites and production build; new browser flow,
conflict/history edge cases and full-document context presentation still need
verification/improvement. No real assessments or paid calls. Import browser
verification, context editing, provider controls, connectors, accuracy and
publication/release work remain pending.

Document text import UI added to each research topic. Captures title, publisher,
HTTP(S) attribution URL, document type, originating chain, explicit retrieval UTC,
optional publication UTC and up to 1M characters. Unknown publication stays null;
retrieval is explicitly distinct from archive capture. Copy explains that the
stored original is submitted text, not fetched HTML/PDF; no fetch or model call
occurs. Uses versioned editor API/session-CSRF transport, duplicate-submit guard,
input retention on errors and archive-unavailable guidance. Successful import
refreshes documents and opens the returned document for passage selection.
Verified 14 frontend tests / 3 suites and production build. New import browser
flow and validation/error edge cases still need expanded coverage; existing
CRA/Babel/Browserslist warnings persist. Human assessment/context review,
permission controls, source connectors, evaluation and deployment remain.

Document request-size mismatch corrected. Editor routes now authenticate and
check CSRF/role before JSON parsing; only POST /api/v1/editor/documents/text
gets a 7 MiB envelope cap (permits escaped JSON for the existing 1M UTF-16 text
limit). Other routes retain 100 KiB. Rate limiting precedes parsing. Compressed
request bodies are disabled; parse/size/encoding failures return bounded JSON
errors without request content. Two new HTTP tests first reproduced 413 for a
valid 1M-character import and for anonymous requests; after repair, all 280
backend tests / 37 suites pass. Tests verify original text roundtrip, unchanged
small limits elsewhere, identity-before-parse, oversized rejection and no stored
document on rejected intake. Document import UI, broader ingestion, review and
publication workflows, release evaluation and deployment remain unfinished.

Live local integration check found and fixed a frontend/backend route mismatch:
UI used /api/editor while the server only mounts /api/v1/editor. Corrected test
fixtures first (all seven research tests failed), then all UI callers. Earlier
frontend-only green results did not prove real API connectivity. Added an
explicit localhost-only synthetic in-memory browser fixture script; no real
DB, provider calls or persistent permissions. Real browser verified sign-in,
topic/document navigation, attributed claim creation with unreviewed status,
and passage save/list refresh through the real Express/SQLite app. Browser
automation selection changed DOM offsets without updating React's automatic
preview; added an explicit Use selected text control and tested that path without
a synthetic select event. Browser then confirmed exact offsets 0–14 and saved
quote 'First edition.'. Inspected desktop rendering; mobile and full keyboard
coverage remain unverified. All 13 frontend tests and production build pass.
Document import UI was deferred while repairing this integration issue. The
global 100 KiB JSON limit conflicts with the internal 1M-character document
limit and needs a bounded authenticated intake parser before large UI imports.

Document inspection now supports selecting a passage in a read-only text area,
entering a locator and saving through the existing authenticated passage API.
Browser-normalized CRLF offsets are mapped back to original UTF-16 source
offsets; a test covers CRLF and a surrogate-pair character together. Only offsets
and locator are submitted, never a client-authored quote. Empty selection is
disabled, in-flight submits guarded, failure retains selection, and success
refreshes passages without changing assessment/publication state. Verified 13
frontend tests / 3 suites, 13 editor API tests, production build and diff check.
Browser visual/keyboard verification remains outstanding; existing toolchain
warnings persist. Document import UI, claim evidence linking/assessment, review
and permission controls, archival connectors, evaluation and deployment remain.
No live evidence or paid model calls were used.

Research desk now includes topic and attributed-claim creation forms. Inputs
have explicit labels/length limits; claims require attribution and an HTTP(S)
origin without embedded credentials. Existing cookie/CSRF helper carries writes;
server authorization is unchanged. In-flight submissions are guarded, unmounts
cancel local request handling, server failures retain input, and returned records
open with refreshed lists. Creation does not approve, publish, enqueue or grant
provider disclosure. Tests first failed on missing forms, then all 12 frontend
tests / 3 suites passed; production build passed (research JS chunk 3.77 kB
gzip). Existing dependency warnings remain. Browser verification and the broader
document import, passage selection, human assessment, context review, permissions,
archive intake, evaluation and deployment workflows remain incomplete. No live
records, paid calls or deployment changes were made.

Read-only research desk implemented at /editor, lazy-loaded after session
restoration. Existing server editor authorization remains authoritative; denied
readers see an explicit access message. Topic/claim/document/job navigation uses
100-item cursor pages, cancellation guards and keyed panes. Claim attribution,
preserved source text, retrieval metadata, exact prepared model inputs and saved
JEV responses are separated; model scores explicitly are not truth verdicts or
publication approval. Navigation issues GET requests only, with no disclosure
grant or paid call. Frontend 10 tests / 3 suites pass; production build passes
(separate research chunk 2.59 kB gzip). Existing CRA/Babel/Browserslist and React
test warnings remain; one run also reported delayed Jest shutdown. Visual browser
verification, authoring/review/permission forms, source ingestion expansion,
accuracy evaluation and deployment remain unfinished. No live model calls,
real records, permissions, or deployment changes. The preceding archive answer
verified provider documentation but did not implement an archive connector.

Editor browsing/read models now expose topic-scoped claims/documents and
claim-scoped jobs with bounded ID-cursor pages. Document lists return metadata,
not entire evidence; job reads/lists exclude lease tokens. Job inspection includes
saved JEV answers/full distributions, shadow routing, input hash and current
eligibility issues; queued jobs explicitly return decision:null. An HTTP test now
covers enqueue→preview→permission→simulated worker→decision inspection, retaining
editor authorization and preventing spoofed actor IDs. Verified 278 backend tests /
37 suites. Editor browser UI is not yet implemented; no real classification or
deployment. These read endpoints provide its required navigation contracts.

Classification runtime loop is wired into explicit service startup behind
CLASSIFICATION_ENABLED=false by default. Enabling requires TYPESAFE_API_KEY and
positive daily/monthly budgets, not a writer key. A single process runs one job at
a time, waits between runs, and aborts/drains active work before closing SQLite.
Independent processes still coordinate through DB leases/budget transactions.
Generation/publication remain disabled. Verified 277 backend tests / 37 suites,
including non-overlap/error delay/cancellation and a real service startup/shutdown
test with an injected provider that confirms failure audit before DB close.
No environment flags changed, no real credentials used, no paid calls or deployment.
Production observability, independent-process worker limits, key rotation, UI,
remaining ingestion features and accuracy/release gates remain pending.

Final-attempt crash recovery corrected after a failing maxAttempts=1 test showed
the queue exhausted a lease before checking its durable successful call. Worker
now requests recovery-only leases for lease-expired exhausted jobs with a saved
success for their last exact attempt key. Recovery does not increase attempts,
cannot issue a provider call, and still passes permission/input-hash/lease checks.
Failed exhausted attempts remain exhausted. Verified 272 backend tests / 36 suites,
including recovery with limits of one and three and no retry beyond failure cap.
Unresolved-charge/operator reconciliation, runtime loop, UI, ingestion expansion,
accuracy evaluation and deployment still remain. No paid/live calls occurred.

Single-unit claim worker implemented in claim-worker.js, with no import/startup
side effects. It leases only jobs with an approval event, checks exact-input
permission and lease immediately before transport, uses budgeted call admission,
and commits through the fenced decision boundary. Budget denial defers without
consuming an attempt. Successful prior calls can be reused after lease recovery;
unresolved calls park for reconciliation, recorded failures permit separately
budgeted bounded retries. Post-call permission is checked before decision commit.
Verified 270 backend tests / 36 suites: no-grant idle, full approved path, zero-
budget deferral and recovery without a duplicate paid attempt, all simulated.
No startup loop/live calls. Final-attempt crash recovery, operator unblock flow,
lease renewal, runtime concurrency/shutdown integration and browser workflows
remain pending. No paid usage or production deployment.

Provider disclosure permissions implemented with migration 016 (schema 16).
Permissions default deny, bind exact Jev request hash/provider/job, require an
editor-supplied reason and optimistic event/hash checks, and retain immutable
actor-bound approval/revocation events. Current source/claim restrictions override
approval. Editor API now queues pinned shadow jobs, previews exact input and
permission, and records permission using authenticated actor (ignoring spoofed
actor fields). Job inspection hides lease tokens. Verified 266 backend tests /
35 suites, including default denial, stale approval, revocation, restriction,
spoofed actor and reader denial. No real permission grants or provider calls.
This permission is distinct from public-source access; worker must check it before
each actual transmission. Background worker and UI remain pending.

Claim decision commit boundary implemented with migration 015 (schema 15).
prepareClaimEvaluation derives attributed original/normalized claim, immutable
passage, qualifiers and neighboring source context from DB rows. Shared request
hash binds the validated paid-call result to that exact input. commitClaimDecision
checks current lease and evidence eligibility, matches successful call hash, then
atomically stores immutable decision and completes job. Mismatch rolls back job
completion; revoked eligibility blocks without a decision. All routing remains
shadow/high-risk-review pending evaluated policy; no claim review events or
publication rights are created. Verified 262 backend tests / 34 suites covering
success, mismatched evidence, stale lease and in-flight source restriction.
No external calls. Next: provider-egress authorization and worker execution,
lease renewal/recovery, API/editor inspection and production rollout gates.

Durable claim jobs implemented with migration 014 (schema 14): unique claim /
context version / passage / model / question / policy identity, transactional
leases with ownership tokens, expiration/reclaim, retry timing and bounded attempts.
Eligibility checks block changed/superseded/restricted claims and restricted
sources before leasing and again before completion. Tests cover duplicate/version
identity, expired worker rejection, retries/exhaustion and restriction during a
lease. Verified 258 backend tests / 33 suites. Scheduling primitives only: no
automatic execution, API enqueue, provider-egress grants, lease renewal, or atomic
decision/result linkage yet. Completion here is queue state, NOT claim approval
or publication. No paid model calls, live documents or deployment.

Concurrency verification added using two worker threads with separate SQLite
connections, synchronized before competing for a file-backed WAL ledger. Both
different-key budget contention and identical-key duplicate admission leave
exactly one 60-microdollar reservation under a 100-microdollar cap. JEV adapter
deadline and in-flight cancellation tests verify transport signal abortion even
when a simulated client never resolves. No production behavior changed in this
checkpoint; these tests strengthen evidence for existing concurrency/cancellation
invariants. Actual network timeout integration, worker lease recovery and crash
reconciliation remain pending. No live provider calls or deployment.

Budgeted Jev call coordinator implemented with migration 013 (schema 13):
validate/snapshot/hash request, atomically reserve full pinned context cost and
record attempt, release DB transaction before network, then atomically persist
validated response and usage-based settlement. Stored billed amount is a price-
catalog calculation from reported usage, not provider invoice reconciliation.
Duplicate keys return cached result/pending reconciliation/recorded failure;
changed input under a used key is rejected. Failures retain unknown maximum
charges. Results/attempts are immutable. Verified 249 backend tests / 31 suites,
including overlapping duplicate calls, budget denial and no DB transaction held
during provider work. Tests use simulated responses only. Coordinator remains
internal/unwired: callers must authorize evidence egress; claim-job lease fencing,
independent connection races, crash reconciliation, retry scheduling and provider
status-specific handling remain pending. No paid calls or deployment.

Jev HTTP transport added with fixed HTTPS endpoint, pinned model, redirect refusal,
server-only bearer key, single attempt, abort/deadline, 24 KiB request bound and
64 KiB streamed response cap. UTF-8/JSON and content type validated; request IDs
sanitized; provider bodies/credentials excluded from returned errors. Tests use
injected fetch and real Response streams, not a live provider. Verified 244 backend
tests / 30 suites. Factory is NOT wired into bootstrap/jobs or the budget ledger;
no background calls, credentials accessed or spending occurred. Runtime callers
must wrap this low-level transport in budget admission and durable decision audit
before enabling work. Concurrency/retry ownership and actual token-limit handling
remain pending, as do end-to-end abort/network integration checks.

Jev contract adapter and shadow policy implemented: pinned jev-1.13.0, versioned
independent Choice questions for relevance/relation/evidence type, bounded
text-only payloads, exact response key/option/type validation, finite normalized
distributions, winning-choice consistency, usage validation and sanitized IDs.
Injected transport performs one attempt with abort/deadline; no live transport,
key loading, or budget/audit wiring yet. Shadow routes recommend/review/abstain
always set publicationAllowed=false. The 0.9 routing threshold is provisional,
not calibrated. Tests prove untrusted text stays in data fields, NOT resistance
of the real model to injection or factual accuracy. Verified 235 backend tests /
29 suites with simulated responses, malformed outputs and provider errors.
Only Choice is used; no invented Noul confidence. UTF-8 request cap is a resource
bound, not exact tokenization. Provider token limits need transport-side handling.
Next: ledger-backed transport, decision persistence and durable claim jobs.

Price-aware admission added in models/prices.js with checked-in, expiring Jev
rate record. Re-fetched https://docs.typesafe.ai/models and /api through the
required fetch_markdown tool: jev-1.13.0, $0.042/M input tokens, output free,
64k combined request context and 32k state+longest question. JSON rate expires
2026-10-20 pending re-verification; aliases, unpriced models, invalid bounds and
expired rates fail closed. Integer BigInt arithmetic rounds upward to microdollars;
full 64k Jev context reserves 2688 microdollars. Adapter must enforce input bounds
and the separate 32k constraint; neither transport nor tokenizer is implemented.
Writer pricing deliberately absent until model selection/evaluation. Verified
217 backend tests / 27 suites; no provider calls/spending. HTTP reference uses
POST /v1/systemone with state/model/questions and answers/model/usage response;
Choice includes choice, probabilities and confidence. SDK default retries must
be disabled when implemented. Next: Jev request/response validation and shadow
decision policy, then ledger-backed transport and audit persistence.

Model cost ledger added with migration 012 (schema 12). Internal reserveCost uses
an immediate transaction, integer-microdollar input/BigInt totals, daily/monthly
and optional category daily limits; zero budgets deny admission. Duplicate keys
return already_reserved, never a second call permit. Immutable settlement events
allow unknown→billed/unbilled reconciliation; unknown/outstanding maximum costs
carry across calendar boundaries. Settled charges use reservation UTC periods.
Reported overruns remain recorded, so subsequent admissions account for them.
Verified 205 backend tests / 26 suites covering limits, duplicates, settlements,
rollovers, unknown charges and invalid money. No provider calls or real spending.
Task 10 is NOT complete: authoritative price catalog/estimation, actual provider
usage, concurrent two-connection race tests, retry adapter wiring, operator
budget-change audit and alerts remain pending. Price version is a required label,
not yet validation against provider rates. Runtime generation remains disabled.

Versioned claim evidence packets implemented at editor GET
`/api/v1/editor/claims/:id/evidence-packet`. A read transaction joins original
claim/current context/state, current authenticated assessments, exact passages,
neighboring text, access state and source-chain groups; SHA-256 identifies the
returned snapshot. Latest judgment per reviewer/passage is used, preserving
conflicting reviewers; old context and restricted evidence are excluded with
explicit gaps. Groups do not establish independence, and coverage stays unknown.
Oversized packets fail rather than silently truncate. Private packet content
does not grant external-model or publication permission. Verified 194 backend
tests / 25 suites. Durable packet persistence, unreviewed retrieval candidates,
audited chain ancestry and measured search coverage remain pending. No deployment.

Local FTS5 passage search now indexes quote/title/source with migration 011
(schema 11), backfills old passages and indexes new passages transactionally.
Editor GET `/api/v1/editor/topics/:id/search?q=...&limit=30` scopes to a topic,
bounds queries/results, treats query operators as literal tokens, retains source
provenance and excludes currently restricted sources. No public search exposure.
Verified 189 backend tests / 24 suites: supporting/challenging fixtures, metadata
matches, immediate restrictions, backfill/idempotency and HTTP reader denial.
This is lexical search infrastructure, not completion of retrieval Task 09:
claim-specific variants/logs, exact entity/docket/date filters, chain diversity,
neighboring context and held-out recall measurement remain pending. No relevance
or truth inferred from rank. No live data, paid calls or deployment.

Authenticated human assessments now use GET/POST
`/api/v1/editor/claims/:id/assessments`. Migration 010 (schema 10) adds immutable
reviewer/context-version bindings to existing append-only assessment rows.
Writes atomically bind the session actor, ignore forged reviewer fields, reject
stale or superseded claim context, and validate classification enums. Reads mark
historical context assessments stale and exclude unbound legacy assessments.
This records passage-level judgments, not claim truth or publication approval.
Verified 184 backend tests / 23 suites, including HTTP actor spoofing, stale
writes, invalid classification rollback and reader denial. Jev and independent
accuracy evaluation remain unimplemented; no live deployment/model calls.

Editor passage selection is available through GET/POST
`/api/v1/editor/documents/:id/passages`. Quotes are derived from immutable source
text using UTF-16 start/end offsets; submitted quote fields are ignored. Lists
are bounded to 100 with an ID cursor. Tests cover exact quote, deduplication,
pagination, invalid ranges, missing documents and reader/anonymous denial.
Full backend suite: 182 tests / 23 suites pass. Locators remain editor-provided
descriptions, not verified PDF page coordinates. Passage selection does not
establish relevance or truth; authenticated assessments and Jev remain pending.

Editor text intake and document inspection are connected at POST
`/api/v1/editor/documents/text` and GET `/api/v1/editor/documents/:id`.
Existing editor/session/CSRF middleware protects intake and reads; supplied
content/extraction overrides are ignored. Runtime accepts optional ARCHIVE_PATH,
which must be an existing absolute private directory. Missing archive disables
intake with 503. Existing JSON body limit remains 100 KiB: large-file upload is
not implemented. Submitted text is preserved as UTF-8, not represented as a
verified remote original. Full backend suite: 180 tests / 23 suites pass.
No live ingestion, model usage or deployment. Next: file/HTML/PDF extraction,
retrieval provenance, editor UI and model/review/publication workflows.

Original text intake now joins preserved bytes to research documents and retrieval
history through migration 009 (schema version 9). `importTextOriginal` strictly
decodes UTF-8, bounds content, preserves private originals, and atomically records
the manifest, document binding and manual retrieval. Duplicate imports reuse
objects/documents while retaining separate retrieval records. DB failures roll
back metadata but retain the object for future reconciliation. Verified full
backend suite: 177 tests / 23 suites. No live documents, model calls or deployment.
This is internal text-only intake; authenticated intake routes, PDF/HTML parsing,
archive-provider fetches, cloud objects and orphan reconciliation remain pending.

Original-byte local archive implemented with 25 MiB cap, SHA-256 keys, immutable
dedup writes and checked reads. Complete temporary files are fsynced then linked
without overwrite; corrupt existing objects fail. Private storage intent only;
host directory ACLs remain an operator responsibility (especially Windows).
173 backend tests / twenty-two suites pass, including altered-byte versions,
corruption, traversal and oversized/public-intent rejection; diff checks pass.
This is the local adapter only: S3/R2, DB/object reconciliation, intake integration
and parser sandbox remain planned, not implemented. No real documents imported.

Editor research API connected at /api/v1/editor: bounded topic list/create,
claim create/detail, review events and context versions. Session/editor/CSRF
middleware protects the router; actorId always comes from authenticated session.
Client actor fields cannot impersonate reviewers. Stale changes return 409;
validation errors are sanitized. HTTP tests cover create→review→read, spoofed
actor, stale write and reader/anonymous denial. 169 backend tests / twenty-one
suites pass plus diff checks. Document ingestion routes and editor UI remain
pending, as do the evidence/model/publication pipeline and deployment.

Legacy publication quarantine: old articles no longer appear on public lists,
search, detail, categories or saved lists; rows/bookmarks are retained. Direct
legacy detail gives 410; writes/saves through old endpoints are retired. Editors
can inspect /api/v1/editor/legacy/articles/:id (no-store/auth/role enforced).
This is NOT the replacement publication implementation: public feeds remain
empty until approved-analysis APIs/UI are implemented. Seven regression cases
reproduced leaks before fix; full backend suite now 166 tests / twenty suites
passes, plus diff checks. No content deleted or production deployment changed.

Role audit completed in migration 008: privilege update and append-only previous/
new-role/operator/reason event commit atomically; failed audit rolls back role.
CLI now REQUIRES a final quoted reason argument. Operator is OS username, not
an independently authenticated human identity; restrict shell/DB access and
retain infrastructure access logs. Real subprocess tests verify grant/audit and
missing-file refusal. 159 backend tests / nineteen suites and diff checks pass.
No real user roles changed. Next: quarantine legacy publication and connect
editor research routes before evidence ingestion/writer implementation.

Operator-only role provisioning added: `npm run provision-editor --prefix server
-- <absolute-db-path> <verified-google-subject> <editor|reader>`. Requires existing
DB/current schema and a previously Google-linked identity; no new account or
email match. Existing sessions see demotion immediately. Core service tests pass;
no real roles changed. Verified 155 backend tests / eighteen suites and diff
checks. Still needs CLI end-to-end coverage and durable operator audit before
release; public role management is deliberately absent.

Browser cookie integration: api.js sends credentials and in-memory CSRF; App
restores identity from /api/session, clears old localStorage credentials, and
revokes on logout. Login uses cookies; saved lists use credentials; saves reject
HTTP failures instead of falsely showing success. React guidance kept session
state in memory and waits for session lookup before protected-route redirects.
Verified six frontend tests / two suites, production build and diff checks.
Existing React/CRA/Browserslist warnings remain. Browser end-to-end verification
against real API and deployed cookie topology is still required; no deployment.

Cookie API integration complete: login/register/Google responses issue HttpOnly
cookies and csrfToken only; bearer session authentication removed. /api/session
returns no-store identity/CSRF state; /api/logout revokes and clears cookie.
Authenticated mutations require exact allowed Origin and session-bound CSRF;
all unsafe requests require allowed Origin, including login. Production no
longer implicitly allows localhost. Full backend suite: 149 tests / seventeen
suites pass; focused cookie tests also verify bearer rejection and cross-origin
logout denial. FRONTEND IS TRANSITIONAL: still uses old tokens and must be
updated next before deployment or browser acceptance. No deployment performed.

Cookie transport primitives implemented/tested in session-transport.js: production
__Host- cookie (Secure/HttpOnly/Path=/, SameSite=Lax), duplicate/malformed cookie
rejection, session-bound CSRF digest and exact-origin mutation validation.
147 backend tests / sixteen suites pass; diff checks pass. These functions are
NOT yet connected to routes; bearer auth still operates. Next must integrate
cookie issuance/read/logout/session endpoints and remove browser token storage
together, with HTTP and UI regression tests. No claim of deployed CSRF protection.

Google identity hardening: migration 007 maps verified Google subject to a user,
not email. OAuth route still uses Google library signature verification, then
checks exact audience, allowed issuer, expiry and verified email before mapping.
Changed email retains identity; matching email never inherits a password account
or its role. Old email-only OAuth accounts require explicit recovery/linking;
they are not auto-linked. New Google accounts use opaque internal usernames.
Verified 136 backend tests / fifteen suites and diff checks. Live Google login
and browser display/compatibility remain unverified; cookies/CSRF and editor
provisioning remain upcoming. No credentials or external accounts changed.

HTTP authorization tightened: legacy article/author writes now require a
server-resolved editor role; public registration cannot assign it. Login and
registration validate string types, username bounds and bcrypt's 72-byte input
limit; new passwords need 12 characters. OAuth-only empty-password accounts
cannot password-login. HTTP tests reproduced unauthorized writes/malformed-input
failures before fixes. Verified 126 backend tests / fourteen suites and diff
checks. Still pending: cookie/CSRF migration, stable Google subject mapping,
editor provisioning, legacy publication quarantine and frontend compatibility.

Auth foundation: migration 006 adds hashed DB sessions and user_roles. Sessions
expire at seven days absolute / 24h idle, revoke immediately, and look up current
DB role on each resolution (default reader). app.js now uses these sessions;
saved-article reads reject another user's URL ID. Verified 116 backend tests /
thirteen suites and diff checks. Bearer-token compatibility remains temporarily;
HttpOnly cookies/CSRF, editor route guards, Google-subject identity, provisioning
and frontend token removal are still required before deployment. No public
endpoint provisions editor roles. Existing in-memory sessions are invalidated.

Migration/startup gap closed: backupAndMigrate now applies research and legacy
schema changes in one transaction after backup verification. Minimal old article
tables gain nullable missing metadata before index creation; original content
and author prompts stay intact. Integration tests start the server after upgrade
and prove a duplicate-title migration conflict rolls everything back while
retaining the backup. Verified 104 backend tests / twelve suites and diff checks.
Do not resolve duplicate historical rows by silently deleting them; migration
intentionally stops for an explicit data-reconciliation decision. Next major
task remains session/role authorization; no live deployment has occurred.

Bootstrap integration: index.js now import-safe and delegates to startService.
It requires explicit config and an existing prepared DB, checks schema, enables
WAL/foreign keys and starts the extracted app. Paid generation is explicitly
rejected until its worker exists. stop() drains HTTP with a 10-second connection
deadline and closes SQLite idempotently. init-db now creates legacy API tables
alongside research schema. Existing research-only databases may lack legacy
tables; backup-first migration consolidation remains to be completed before
deploy. Known legacy authorization flaws remain in app.js. Verified 99 backend
tests / eleven suites and diff checks; no external deployment or paid calls.

Task 03 begun: app.js exports createApp({db,config,services}) with no import-time
DB/listener effects; legacy-schema.js isolates transactional legacy schema setup.
Real loopback HTTP tests verify readiness/live and existing categories contract.
95 backend tests pass / ten suites; diff checks pass. IMPORTANT: index.js still
uses the old startup until bootstrap integration next; app.js temporarily copies
legacy routes, including their known auth flaws. Do not deploy this transitional
state. Next: replace index with import-safe bootstrap, explicit migration/start
separation, graceful stop and then authorization fixes.

Source provenance migration 005 added: source access defaults private, access
decisions and retrieval records are append-only, stale access writes rejected.
Retrieval metadata validates URLs/dates/status/MIME and stores a separate
original-byte digest. These are internal services only: archive adapters,
authentication, public serializers and cache restriction enforcement are NOT
wired yet. Failed first-time discovery before a source exists still needs a
separate intake-job failure record in the discovery task. Verified 92 backend
tests / nine suites and diff checks. Future migrations must use numbers >=006;
the original plan's proposed migration filenames are superseded by this registry.

Claim context added in migration 004 (planned archive migration must use the next
unused number, not reuse 004). claim-context.js stores immutable normalized
wording, explicit UTC/null observation dates, entity identifiers and time/place
qualifiers. Context updates use optimistic concurrency and reset review while
preserving restrictions. Originals remain unchanged; identity is never inferred.
Verified 81 backend tests / eight suites and diff whitespace checks. Source
access/retrieval records and API integration remain outstanding; no deployment.

New database initializer: `npm run init-db --prefix server -- <absolute-path>`
creates exclusively, requires an existing parent directory, migrates and checks
integrity, seeds no data/accounts, and refuses existing files. Import is inert.
Failed initialization leaves its file for diagnosis rather than deleting data.
Existing databases still require backup-first migrate. Verified 68 backend tests
across seven suites, including real CLI exit codes and unchanged bytes after
repeat invocation; git diff --check passes. No live databases were changed.

Task 02 continued: migration 003 introduces append-only claim_events with
legacy-compatible user references. research-lifecycle.js derives review,
restriction and supersession states; expectedEventId rejects stale changes
inside an immediate transaction. Original claim rows remain immutable. Actor
existence is enforced but editor authorization is NOT implemented here; no
HTTP route exposes the new service yet. API must bind actor from auth later.
Fresh verification: 59 backend tests / six suites pass, including v2 upgrade,
idempotent migration, conflict rollback, stale review, invalid actors and
supersession cycles; git diff --check passes. Remaining task-02 work includes
claim context/version metadata, source access/retrieval records and init-db.

Working on codex/accuracy-production in the existing checkout; prior changes
preserved. Task 01 configuration module and safe environment example added;
paid flags default off, automatic publication rejected, absolute DB paths,
strict boolean/microdollar parsing and feature-specific secret checks tested.
Runtime integration is deferred to task 03; do not assume the old server now
uses these safeguards. Task 02 begun: newer-schema rejection and strict slug
types; event lifecycle/migrations still outstanding.

Baseline frontend dependency install completed from lockfile. Production build
passed and frontend smoke test passed (1 test), with CRA/Browserslist warnings.
Audit reports 65 dependency findings including 3 critical; exploitability and
remediation remain unverified. No forced dependency updates or deployment.
Backend config red/green cycle passed 45 tests; migration-guard tests then
reproduced six failures before fixes. After fixes: 51 backend tests across five
suites pass; git diff --check passes (line-ending warnings only). Ignore checks
confirm real .env/build outputs excluded and server/.env.example visible.

Keep this compact. Replace obsolete facts; do not append transcripts or raw logs.

## 2026-09-20 — rebuild preparation

- User approved documentation for a later rebuild, covering coding-agent
  efficiency and runtime model architecture. Jev is the intended semantic
  decision/classification provider. No publication or infrastructure changes
  are part of this milestone.
- Baseline: local branch `main`, commit `7a63600`; remote URL
  `https://github.com/grifmang/-theeasy.news.git`. Existing untracked
  `docs/REVIEW-2026-06-09.md` belongs to the user and was preserved.
- Source confirms React/CRA frontend, Express/SQLite backend, standalone
  scheduler, and headline-only OpenAI generation. No Jev integration exists.
- Authenticated Netlify listing returned 17 projects, with no matching custom
  domain or repository shown. Local project is not linked to a Netlify site.
- Netlify DNS zone `6737d7a74d832f80e18c5207` for `theeasy.news` exists;
  `site_id` is null and the only listed record is `_atproto.theeasy.news` TXT.
  Preserve that record during restoration.
- Public lookup returned no apex A record and NXDOMAIN for `www` CNAME;
  HTTPS fetches for apex and www failed. Lookup returned an SOA naming
  `dns1.p01.nsone.net`; zone API lists the `p03` nameserver set. SOA primary
  is not proof of parent NS delegation: verify registrar and authoritative NS
  before any DNS change.
- A deleted site is plausible, but the available evidence does not establish
  deletion history or rule out a site under another account/name. The earlier
  conversation's categorical deletion claim was too strong.
- Backend URL, Railway service, persistent volume, backups, and account access
  remain unverified. No service or database was provisioned or changed.
- Official TypeSafe docs reviewed: Choice/Score return confidence and
  probabilities; Noul returns a probability without confidence. Docs currently
  list `jev-1.13.0`; production should pin the version evaluated at rebuild time.
  Typed output does not guarantee factual correctness or injection resistance.

## Next implementation handoff

Direction expanded to claim-centered analysis of disputed internet claims.
Version 2 migration adds topics, attributed claims, non-RSS document metadata,
exact passages, and append-only human assessments. A bounded local JSON import
command supports reviewed text and shared document provenance. Epstein is the
planned first collection; no real corpus was loaded. Synthetic tests only.
See RESEARCH_PILOT.md for supported intake and remaining retrieval/Jev work.

Local foundation implemented after blueprint approval: `server/storage.js`
provides explicit initialization, transactional additive migration, immutable
source snapshots, idempotent ingestion/jobs, attempt caps, and token-fenced
leases. `server/migrate.js` backs up an existing DB and checks backup integrity
before migration. RSS ingestion and scheduling now use the source/job store;
the legacy API/generator remain separate.
No production DB was migrated, no model requests were made, and no deployment
was changed. New tests use temporary databases and close/remove their fixtures.
Verification: `npm test --prefix server -- --runInBand` passed 2 suites / 10
tests, including migration rollback, pre-migration backup restoration, immutable
evidence, two-connection lease contention, stale-worker rejection, and restart
retry limits. `git diff --check` passed. Existing dependencies installed from
the lockfile; no provider key or network model call was needed.

Problem: prepare a reliable, economical news pipeline from a small prototype.
Affected areas: backend schema/jobs/models/API, source provenance, publication
states, frontend source/disclosure/review behavior, deployment configuration.
Invariants: immutable source evidence, server-only keys, durable job claims,
bounded spend/retries, no unreviewed publication during shadow rollout.
Design and acceptance checks: [MODEL_ARCHITECTURE.md](MODEL_ARCHITECTURE.md).
Restoration sequence: [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).
RSS milestone: injected parser/DB, bounded intake, individual item validation,
URL/date/evidence persistence, idempotent classification queue, feed retries,
fatal storage errors, import-safe scheduler, overlap guard, and shutdown drain.
No live feed requests or model calls were made. Availability remains unverified.
RSS milestone verification: full backend suite passed 2 suites / 18 tests;
`git diff --check` passed. Tests cover provenance/deduplication, changed evidence,
malformed items, bounded retries/intake, fatal DB errors, and scheduler draining.

Next bounded mission is now task 01 of the production implementation plan below;
Jev integration follows schema, authorization, provenance and budget prerequisites.
Lease renewal, review routing, provider retry/backoff, budgets, and publication
state remain future integration work.
Production thresholds and writer/reviewer model IDs require measured evaluation.

Production planning, 2026-09-20: [Blueprint](PRODUCTION_PLAN.md),
Accuracy revision: [ACCURACY_SPEC.md](ACCURACY_SPEC.md) now controls release
criteria. Target >=95% observed whole-case correctness and a 95% Wilson lower
bound >=90% on >=200 independent held-out families, separate automation and
human-reviewed tracks, useful resolution coverage and zero critical errors.
Task 13A adds confirmation after tasks 14–16; pilot data is development only.
Costs now explicitly include independent evaluation labor outside service bills.
Documentation change only: no benchmark executed or accuracy result claimed.
[Cost model](COST_MODEL.md), and
[Executable task sequence](superpowers/plans/2026-09-20-production.md).
Archive support is explicitly included: [Archival sources](ARCHIVAL_SOURCES.md).
This planning milestone does not implement connectors or deploy anything.

## 2026-09-22 — fail-closed HTML process integration (local only)

The production HTML entry point now requires a verified, externally pinned Linux
x64 sandbox bundle and operator-owned scratch parent. It has no direct-Node
fallback. Private scratch cleanup follows process close on success, cancellation,
deadline and output rejection; parser result shape and source offsets are checked.
Portable content tests use a clearly test-only harness rather than weakening the
production entry point. Eight synthetic wrapper scenarios run inside the real
Linux integration suite. Verified: WSL 15 tests pass; backend 481 tests / 54 suites
pass. The new missing-configuration and malformed-result tests first failed against
the prior behavior and passed after implementation. No production deployment,
database access, paid model call or HTML API enablement. Immutable runtime build
and deployment configuration, independent security review, persisted extraction
quality/provenance, PDF/OCR, evaluation and publication gates remain unfinished.

## 2026-09-22 — Linux release packaging (not deployed)

Added build-parser-bundle CLI and opt-in container recipe/default-deny context.
Build output is verified, read-only and accompanied by a separate checksum;
existing outputs are preserved. Real WSL build plus sealed-bundle parsing and
cleanup pass within the 15-test Linux suite; backend remains 481/54 passing.
Docker engine is unavailable, so container build, native SQLite and non-root
volume/runtime verification remain untested. No builder setting or service change.
Container recipe pins official Node amd64 image, builds as root and runs UID1000;
apt repositories are not snapshot-pinned. WSL same-owner permissions are not
proof of deployment immutability. Full release hold remains in effect.

## 2026-09-22 — extraction manifests and container startup diagnosis

Local schema 20 stores immutable original/receipt/document-to-text extraction
manifests, SHA-256 digests, UTF-16 maps, extractor version, requesting actor and
mandatory review marker. Plain-text import, retrieval and manifest writes commit
atomically; tested rollback and repeat-extraction idempotence. No human review is
implied or API HTML parsing enabled. Backend 483 tests/54 suites pass, including
backup-first 16→20 fixture migration. The live schema remains 16.

Docker Desktop start failed with its inference-manager socket removal/listening
error, confirmed in backend logs. Stopped only our two hung CLI probes; no Docker
data deletion/reset, new service, paid model call, or deployment. Container build
is still unverified. Last usage check: 62% consumed, 38% remaining.

## 2026-09-22 — extraction review API and evidence packet provenance

Schema 21 adds immutable review events fenced by exact manifest hash and last
event ID. Acceptance requires original-comparison attestation; actor comes from
session, not request body. Added editor-only manifest detail and hash-verified
original downloads with attachment/no-store/nosniff/sandbox headers. Evidence
packet identity incorporates review status; missing/pending/rejected quality is
flagged without discarding counterevidence. Expanded real HTTP/SQLite/archive
integration covers stale edits, CSRF, actor spoofing, roles and immutable history.
All 483 backend tests/54 suites pass, including fixture 16→21 backup migration.
No production migration/deployment. Review UI and writer/publication enforcement
remain unimplemented; human attestation is not independent factual adjudication.

## 2026-09-22 — review interface and responsive verification

User granted UI redesign freedom. Added a research-first extraction review panel
with explicit comparison, version-fenced saves, readable provenance/limitations,
private original link, and a clear distinction from truth/publication approval.
No decision or attestation is preselected. Reload is required after failed/stale
saves; notes survive. Frontend 37 tests/6 suites and lint-gated build pass. Edge
synthetic full intake→extraction→rejection→reload workflow passed. Mobile inspection
found a long URL heading overflow; fixed and verified content width equals viewport
width at 341 CSS px. Final warning text and responsive panel inspected. Viewport
reset, synthetic account logged out and temporary tab closed. No production deploy.

## 2026-09-22 — internal HTML receipt-to-manifest persistence

Added extractFetchHtml using the existing sandbox wrapper and shared atomic
original/document/retrieval/manifest persistence. Preserves parser source offsets,
quality warnings and mandatory review marker; no review or verdict is created.
Editor and abort fencing prevent commits after asynchronous parsing. Tests cover
original substitution, runtime failure, revocation, cancellation, idempotence,
same-version changed-output rollback, MIME separation, and real-wrapper failure
without runtime config. Backend 491/54 passes. Persistence tests mock successful
parser results; actual container/runtime deployment verification is still pending.
No HTML HTTP enablement, production write, paid model call or DNS change. Usage
check: 73% consumed / 27% remaining. Full production goal remains incomplete.

## 2026-09-22 — installed parser runtime ownership preflight

Added loadHtmlRuntime and an import-inert check-parser-runtime CLI. Requires a
non-root Linux x64 process with no inheritable/permitted/effective/ambient caps,
root-owned sealed single-link bundle and external digest, safe ancestors, and
private service-owned scratch. Verifies manifest then actual sandbox smoke parse.
Test-first root-owned disposable WSL fixtures exercised real UID/GID1000 children
across 12 positive/negative cases. Moved ownership cases after the preexisting
root parse to avoid test-order contamination from changing scratch ownership.
Fresh ordinary Linux suite: 15/15. Fresh backend: 491 tests/54 suites. Container
command documented but not executed; startup/API wiring remains pending. No
production deployment, database changes, paid calls, or DNS changes.

## 2026-09-22 — opt-in HTML service, API and capability-aware UI

Wired verified runtime into startup behind HTML_EXTRACTION_ENABLED=false default.
Single active parse per process; no request queue. Client disconnect and shutdown
cancel parsing, and shutdown drains before DB close. Server-owned receipt/session
identity and operator paths are not overridable by request JSON. HTTP emits
availability, busy429 and disabled503; UI gates HTML and explains retry conditions.
Backend503/55, frontend39/6 and lint-gated build pass. Tests cover startup rejection,
concurrency/drain, real HTTP disconnect and HTTP→service→immutable-manifest flow
with mocked Linux parser/runtime boundaries. Actual WSL parser checks remain
separate evidence, not full container HTTP proof. Production remains unchanged.

## 2026-09-22 — Docker diagnosis and bounded Wayback discovery

Read-only Windows/WSL checks confirm inaccessible dockerInference reparse entry:
fsutil reports error1920, WSL sees a zero-byte Aug27 entry. Existing backend remains
in the previously logged error state. Requested explicit user approval to stop
Docker, move only this entry aside recoverably, and restart. No approval received
or Docker mutation performed this turn. No resets or diagnostic uploads.

Read official Wayback availability/CDX docs; two public example.com compatibility
queries succeeded. Availability returned capture20200101231047 after a Jan1
midnight cutoff, directly demonstrating nearest-date risk. Added internal
lookupCaptures with explicit adapter only: exact URL, inclusive UTC cutoff,
1–100 rows,1MiB response,10s deadline, cancellation, metadata validation/dedup and
conflict rejection. Results explicitly discovery-only/unverified, archive digest
not local SHA256. No transport activation, caching/budgets, replay intake, provider
calls in tests, Save Page Now submissions or production changes. Backend524/56
passes including21 archive cases. Usage check78% consumed/22% remaining.

## 2026-09-22 — owner restored Docker; actual container flow verified

Owner reported Docker running after their restart; verified engine29.6.1 Linux
x86_64. Did not perform pending socket move/reset. Built candidate image. First
real preflight rejected root bundle directory0755, caused by Docker COPY creating
destination root with default mode; children remained sealed. Added targeted
chmod0555 in final stage and rebuilt. Actual preflight passed. New read-only-mounted
container-smoke.js verifies UID1000, real Linux SQLite/schema21 startup, actual
sandbox through authenticated HTTP extraction, immutable unreviewed manifest,
original attachment bytes, scratch cleanup and shutdown. No external network,
all capabilities dropped, no-new-privileges, synthetic disposable data only.
Final rebuilt/tested image: sha256:16fc25c33afa60dd7dc0bb8b6606c2ae534a6a850a728d50249ddcf0a0f055b6.
All test containers self-removed; image retained. No production deployment yet.

Also completed Wayback receipt/manifest/source-chain integration: exact capture
and original retained across all redirect hops, matching Memento-Datetime and
capture≤retrieval required before storage, rechecked at extraction. Manifest
separates capture/retrieval/original/archive URLs and warns completeness unverified.
Original plus two captures group into one origin chain. Five added integration
tests cover provenance/grouping and missing/wrong dates, changed capture and live
fallback. Backend529/56 passes. archive.is429 honored without retry; its reviewed
snapshot metadata remains unsupported. Full plan remains incomplete.

### 2026-09-23 — encrypted recovery and maintenance release preparation

User approved encrypted backup on this PC. Live root/schema16 inventory verified;
original_objects and originals directory empty. Installed verified portable age1.3.2,
protected identity with Windows DPAPI CurrentUser, restricted local recovery ACL,
exported a consistent SQLite backup and encrypted it outside OneDrive/git. Verified
decryption, integrity/FKs and in-memory16→21 migration preserving account/role counts.
No plaintext data/key output or production migration. Artifact/hash/limitations in
DEPLOYMENT_RUNBOOK.md. Earlier failed restore rehearsals caught retained WAL mode;
regression reproduced, backup-only now normalizes the copy to DELETE, not the source.

Added explicit maintenance mode before DB/parser/auth/job initialization; all app
requests503, health payload clearly maintenance. Full backend533/57 passes. Fresh
image2c4b0311 passed actual HTML HTTP extraction and separate maintenance/no-DB smoke
under UID1000/networknone/capdrop/no-new-privileges. No Railway/Netlify changes yet.
Still need safe UID1000 directory preparation, writer-stop/final backup/migration,
release verification and deployment. Portable key escrow/scheduled backups remain.
Latest account usage87% consumed. Full goal remains active and incomplete.

### Cutover in progress — do not assume the former deployment is still serving

Set MAINTENANCE_MODE=true and all processing flagsfalse with --skip-deploys.
Nixpacks maintenance uploads38306120 and9e4b10cc failed during build: dashboard
showed .dockerignore excluded Nixpacks-generated .nixpacks files (CLI omitted the
useful BuildKit logs). Narrow .nixpacks exception added. Upload91e1688a built but
crashed because models/prices.json was excluded by the Railway upload filter.
Added explicit recursive source-directory exceptions in .railwayignore and checked
all60 runtime subtree files against rg's normalized upload list; zero missing.
Corrected maintenance deployment9ef8f8eb-02da-4d42-b830-a48f7fe84ec3 is in flight.
Old037c32b4 deploymentStopped=true was verified before91e startup; no DB migration
or volume permission change yet. Recheck authoritative state before any next step.
Frontend39 tests and lint-gated production build passed with public OAuth config.

### Cutover completed — 2026-09-23 UTC

Repository rg filter check did not predict actual Nixpacks contents; prices.json
was still absent in9ef8f8eb. Switched to clean explicit91-file source stage without
.dockerignore for temporary maintenance. Deployment8cf174e8 succeeded, public
health maintenance/writesEnabledfalse; final post-stop encrypted backup verified.
New/data/research private dirs+SQLite backup created and chowned explicitly1000.
Node refused in-process setgid(io_uring CVE guard); no bypass, spawned uid/gid1000
child for migration16→21 and readiness rehearsal. Integrity/FKs/accounts/roles pass.
Original/data/easy-news.db and historical/data.db preserved, no recursive chown.

Restored Docker ignore to clean stage; local candidate smoke passed. Railway
10d63288-d3f0-4601-aa55-d2e7dfdd6402 SUCCESS with DOCKERFILE, public healthready.
PID1 UID/GID1000 and effective/permittedcaps0 confirmed; root SSH is separate.
Actual parser runtime preflight passed in uid1000 child on Railway. HTML remainsoff.
Netlify6ab3489533e4b1c99d146908 deployed; home/login render, API proxy/publicempty
and editorunauthorized401 verified. Google chooser click timed out; authenticated
UI check remains open, not fabricated or bypassed. No DNS/paidprocessing enabled.
Updated local Windows backup source to active/data/research with DB_PATH guard;
post-release schema21 encrypted restore verified. See releases/staging-report.md
for artifact hashes/backup names, rollback cautions and full incomplete gate list.
Full goal remains active. No commits/pushes or additional hosting services.

### 2026-09-23 — verified release source packaging

Added import-inert ops/stage-release.js after failing CLI behavior tests. Explicit
source allowlist includes JSON/MJS/C assets, forbids linked/private/unexpected
runtime entries, rejects overwrite/overlap and pins deterministic exact manifest.
Twelve focused tests pass; backend545/58pass,1Linux-mode test skipped onWindows.
Separate real Linux staging with umask077 initially failed600vs644 assertion;
explicit generated code644/dirs755 fixed non-root Docker COPY readability while
outer bundle remains0700. Linux check passes, same digest as Windows snapshot.
Built from that generated93-file bundle, then real isolated Docker HTTP extraction,
original download and shutdown smoke passed. Retained digest/paths in runbook.
No live restart/deploy needed for local packaging tools. CI/secret scanning/remote
promotion and full public-production plan still incomplete; no goal completion.

### 2026-09-26 — local PDF OCR fallback

Completed the already-packaged OCR path inside document extraction. Native text
remains first; only zero-native-word pages use the bounded 4096px English OCR
raster/Tesseract/mapper path. Manifests now distinguish native, OCR-derived and
OCR-unresolved pages, retain confidence/provenance and always require comparison
with the private rendered original. Extractor version changed to avoid colliding
with native-only manifests. A real image-only PDF sandbox probe recovered the
exact synthetic sentence/amount as four OCR spans; a blank scan stayed explicitly
unresolved. UID1000/no-network execution and scratch cleanup passed. Existing
backend50 and frontend12 affected checks, lint and build passed; no new tests.
Local schema remains22/deployed21. No deploy, migration, DNS or feature enablement.

### 2026-09-26 — PDF production-image candidate and sandbox closure

Added pinned PDF/OCR build and final runtime dependencies, sealed bundle/digest
copy, private scratch, and CI PDF startup preflight to the production Dockerfile.
A focused security review demonstrated queued-signal and filesystem-metadata P1
escapes plus aggregate scratch P2 in the earlier launcher. Denied signal and
metadata mutation syscalls (including fchmodat2); production launchers now deny
all scratch writes. A sealed deterministic Fontconfig cache preserves rendering.
Regression probes blocked both P1s and direct scratch creation; native14/14
applicable checks passed (1 optional skip). Staged source106-file digest is
797fecbb95d94f430e26084093afab76077c888e621b01427ba8803d0cad1837;
PDF97-file digest16339c525fab762d5049f2a70b64c2bb08a99a09fbf2562536ca6b43bb2f2932;
image sha256:e0e63fce14cb5e95fc8965c6005db059b4b6b693a48da38295e902afbff7a380.
Exact image passed HTML/PDF startup, scanned/blank OCR and read-only-scratch probes
as UID1000 without network/caps; affected backend65/65 and actionlint passed.
Astra re-review closed those three findings for this exact image. Hosted CI,
production-host enforcement, broader fidelity/browser gates, schema22 migration
and deploy remain open; feature flags stay false and no external state changed.

### 2026-09-26 — PDF synthetic fidelity and adversarial gate

Ran the exact candidate image against a disposable offline corpus: multicolumn,
table, footnote, visual redaction, image-only OCR, encrypted, malformed,
option/shell-looking filename, embedded document JavaScript and an aborted
80-page extraction. Required names/dates/amounts matched; all successful results
required review, OCR retained derived/English-only warnings, redacted digits did
not appear, hostile content did not execute, rejects failed closed and scratch
returned empty. Exported exact comparison renders for the five layout/OCR cases
were visually inspected. Evidence remains outside the repo at
`C:\Users\grifm\AppData\Local\Temp\easy-pdf-fidelity-20260926`. No new unit or
E2E tests, dependencies, production data, migration, deployment or feature
enablement. Real editor-browser and varied real-world/multilingual review remain.

### 2026-09-26 — schema23 audited source-chain slice

Added immutable actor-attributed document-parent links, database cycle rejection,
bounded ancestry display/API and conservative evidence-packet dedup projection.
Astra reproduced two Important issues in the initial draft: an oversized edge
could commit before response failure, and dense ancestry could amplify reads.
Component-wide node/link/reason-byte admission now runs inside the immediate
transaction, response construction occurs before commit, reads have row/byte
limits, and packet projections omit repeated audit text with an aggregate cap.
Disposable RED→GREEN overflow evidence proved rollback/readability; ordinary
cycle, immutability, grouping, packet integrity and populated backup-first21→23
probes passed. Existing affected backend55/55 and frontend16/16, lint and build
passed. Astra re-review closed both findings for service-written graphs. Local
runtime now requires23; deployed DB remains21. No migration or deployment ran.
Fresh staging produced108 files/source digest
5ec49484cf30976d3577b8baea400613f420d9de7f65fc273d4dcc246766147f and image
sha256:fdfd0008f534822d67cf2f275630cd6f028e650a8a5dee59c7ac01428f3daa0d.
That exact image passed HTML/PDF preflights, UID1000 authenticated HTTP smoke,
source-chain probes and the Task07 corpus with no network/capabilities. Full
backend passed545/545 with1 optional skip; no external state changed.

### 2026-09-26 — Task08 atomic claims and research workflow (local only)

Local runtime now requires schema24; deployed Railway runtime/database remain
schema21. `POST /claims` is an atomic attributed proposal with required explicit
qualifiers and distinct original/normalized wording. The server derives actor
identity from the authenticated session. Identical retries return the original
proposal only while initial state/context still match; collisions return409.
Task08 adds append-only source chains, context-bound `component_of` claim
relationships, append-only revoke/correct history, recorded search outcomes,
six-dimension context-bound coverage with stale projections, evidence-packet gap
reporting, and an accessible editor flow. These are research workflow records,
not truth findings or publication authorization.

Verification: backend58 suites/545 passed/1 optional skip; affected proposal
checks51/51; focused schema24 fixes70/70; frontend ResearchDesk18/18, lint,
public-config check, build and diff checks passed. Disposable probes covered
populated backup-first21→24 migration, stale context, relationship revoke/correct
and rollback, idempotency, actor spoofing, HTTP bypass, packet/FK/integrity.
Independent Sol reviews found and fixed all Critical/Important issues; none are
open. Deferred minors are per-claim aggregate search/coverage storage and query
budget, and explicit44px minimum heights for text/date/select controls.
No production DB, deployment, DNS or model call changed. Browser/E2E and a fresh
schema24 release image remain open. The schema23 image
`sha256:fdfd0008f534822d67cf2f275630cd6f028e650a8a5dee59c7ac01428f3daa0d` is
stale and must not be deployed; a fresh backup-first21→24 release rehearsal is
required.
# 2026-09-26 — Task13 offline evaluator and Task12 provider recovery UI

`server/evals/run.js` plus `server/evals/metrics.js` provide a v2 offline,
fail-closed evaluation pipeline. It models retrieval queries separately from
classification cases, with at most one ranked top-30 result per claim/query.
`retrievalSnapshotSha256` binds the corpus, documents, passages, retrieval
configuration and cutoff. Input data is deeply snapshotted and frozen before
the first callback/await. The runner requires the exact current Jev model pin
and digest and rejects mutable aliases. Manifest checks prevent leakage across
claim families, source chains and passage hashes. Metrics and output include
usage, reviewer time, report hashing, retrieval and classification results;
missing/error/abstain outcomes fail closed.

The repository pilot manifest remains `incomplete`, empty, and explicitly
supports no quality claim. A real 50-case development corpus, 100–200 held-out
cases, >=300-case publication corpus, independent double review and paid model
evaluation do not yet exist. Task14 writer selection remains blocked on a real
gate-passing development benchmark. Full backend suite: 545 passed, 1 optional
skip. Disposable adversarial probes passed; scoped Astra review passed after
two rounds. No live calls were made.

Task12's provider recovery UI is integrated into BudgetPanel. Recovery uses
exact pause-version compare-and-set, audited reason and idempotent continuation.
Frontend results: 18/18 relevant tests, lint, public-config boundary and build
passed; independent Luna review passed. Classification remains disabled with
zero budget. Follow-up polish observations: success wording when the cursor is
invalid, and clearer retry guidance after 409.

Release/runtime facts did not change: local schema28; deployed Railway runtime
and DB schema21; no schema28 release image, migration or rollback rehearsal.
No production data, deployment, configuration, DNS, or paid/live provider state
was changed. See [RESUME](RESUME.md) and [offline evaluation gates](MODEL_ARCHITECTURE.md#offline-evaluation-and-gates).
# 2026-09-27 — Task22 durable work admission

Local runtime requires schema29; Railway runtime and the active DB remain
schema21. No schema29 release image exists. Migration029 adds a global durable
admission state with append-only audited transitions. Existing authenticated
editor authorization is used; actor IDs are derived from the session, and all
editors currently hold operator authority. Pause/resume requires exact version
CAS and uses hashed idempotency request IDs. A matching retry replays the saved
result; changed payload or stale state conflicts.

Pause blocks dispatch, not in-flight work. Claim/fetch/rebuild lease fences and
short immediate pre-send fences close the admission race; pre-send denial is
recorded `not_billed`. Eligible claim jobs receive baseline deadline credit
across pause, while genuine retry readiness/backoff remains the eligibility
baseline. Status uses bounded indexed counts and read-only guard inspection;
backup age is explicitly unknown. `WorkAdmissionPanel` exposes status and
controls in the editor.

Backend verification: 545 passed, 1 optional skip; disposable cross-process
probes passed. Scoped Astra review passed after three fix rounds. Frontend:
18/18 relevant tests, lint, public-config check and build passed; independent
Luna review passed. No deployment, production DB change or live provider call.

Task22 remains incomplete pending independent scheduled encrypted backups,
7-daily/4-weekly retention, portable key custody, delivered alerts, current
fresh-host restore and measured RPO/RTO, archive-original backup/reconciliation,
and Task16 publication/outbox/invalidation restore checks. The encrypted Sep23
backup is historical, not a current recovery point. Release requires a fresh
matching image, backup-first schema21→29 migration, and matching rollback
image/backup. See [RESUME](RESUME.md), [OPERATIONS](OPERATIONS.md), and
[DEPLOYMENT_RUNBOOK](DEPLOYMENT_RUNBOOK.md).

# 2026-09-27 — Private pilot candidate registry

An offline private candidate registry is stored at
`%LOCALAPPDATA%\EasyNews\pilot\tranche-001\candidate-registry.json`
(SHA256 `db557e8b9525846cd1f8d567c276ffcc4716aef17f643613265dc7467171ebc5`).
It contains metadata only: 6 official source candidates and 8 unreviewed
candidate claims; `sourceTextStored` is false. Independent double review and
source snapshots remain pending. Retrieval limitations: the Maxwell page was
available; OIG PDF requires sealed PDF intake; FBI Vault returned 403; SDNY
press release was not snapshotted. This registry is not ground truth, is not a
checked-in manifest, and supports no quality or publication claim. Do not edit
or infer completion from `research/pilot/manifest.json`. No paid/live model calls
or production mutation occurred.

# 2026-09-27 — Task14 legacy-generator safety slice

`server/generate.js` is import-inert and fails closed unless
`LEGACY_GENERATION_ENABLED=true`, `GENERATION_ENABLED=true`, a nonblank
`OPENAI_API_KEY`, and an absolute `DB_PATH` are all present. The database closes
in `finally`, and the package command is renamed `generate:legacy`. README
labels it recovery-only and not grounded or publication-compliant. Verification:
`node --check`, import-inert probe, disabled CLI exit 1, `legacyConfig` 4/4,
package script inspection, diff check, and the existing backend suite (58/58
suites; 545 passed, 1 optional skip). No provider call, DB mutation, paid usage,
or deployment occurred. Task14 remains blocked on the real benchmark, model
selection, and grounded writer pipeline.

# 2026-09-27 — Task14 offline grounded-contract slice

New files: `server/models/writer.js`, `server/models/reviewer.js`, and
`server/analysis/draft.js`. The contract uses provider-neutral injected
`complete(request)` with no selected/default writer model. It enforces packet-v2
digest, shape, and context binding; packet-only citations; derived
counterevidence; and access, extraction, and assessment validation. Incomplete
coverage yields no supported assertions. Qualification is deterministic
`editor_only_unresolved` with `findingEstablished=false`,
`publicationAllowed=false`, and `requiresHumanReview=true`. Revision is limited
to one. There is no persistence, route, or live transport.

Verification: `node --check` on all three files; implementer disposable
fake-client probes covered malformed/tampered/restricted inputs,
hidden-counterevidence, and revision cap. Parent real schema29 packet probe
passed a valid packet and rejected tampering. Scoped Sol review found three
Important and one Minor items; the fix round addressed all within the slice and
final re-review was clean. Tracked/new-file whitespace checks passed. No
provider/model call, paid usage, DB persistence, or deployment occurred. Task14
is not complete. Remaining blockers: real Task13 benchmark/model selection;
writer price/budget/permission/admission transport; rebuilding and comparing
the current packet from trusted DB immediately before provider admission;
Task15 sentence verification; and persistence/editor publication in Tasks16+.

# 2026-09-27 — Pilot source partial capture

`fetch_markdown` retrieved the official SDNY Maxwell case-update page. Four
bounded relevant excerpts were stored outside git/OneDrive at
`%LOCALAPPDATA%\EasyNews\pilot\tranche-001\src-sdny-maxwell-case-page.partial.json`
(SHA256 `49cd866b81b923df20777879aa94600ceb773a4982abd61b4b47df38ba8cf32c`).
The private registry now has SHA256
`168c9e0acecfc1c18951d601e7f5c0d45819dc27f7fd621148ae0b1ac617d21c` and still
contains 6 source candidates and 8 unreviewed claims. The capture is marked
partial, unreviewed, not ground truth, and not for publication; it does not
establish the conviction, sentence, or appellate-affirmance portion of the
candidate claim. Independent double review, remaining source snapshots, and all
quality gates remain pending. A second bounded `fetch_markdown` attempt for the
2019 SDNY charging release returned empty; the registry records that source as
blocked pending a permitted alternate acquisition path so future sessions do
not repeat the same fetch. The checked-in pilot manifest was not changed.
No provider/model call, paid usage, database mutation, or deployment occurred.

# 2026-09-27 — Private candidate-registry validator

Added `server/evals/validate-candidates.js` and the `validate-candidates` package
command. The CLI accepts exactly one absolute registry path and uses bounded,
regular, non-symlink reads. It validates private-candidate restrictions,
source/claim references, snapshot containment and filenames, artifact hashes,
and snapshot metadata binding without emitting source text. The live private
registry validated as SHA256
`168c9e0acecfc1c18951d601e7f5c0d45819dc27f7fd621148ae0b1ac617d21c` with 6
sources, 8 unreviewed claims, and 1 partial snapshot. `node --check`, package
JSON parsing, the real registry run, three negative CLI probes, and tracked/new
file whitespace checks passed. Per owner policy, no unit test was added. This
does not establish review quality or corpus readiness; the checked-in pilot
manifest remains unchanged. No model/provider call, production mutation, or
deployment occurred.

# 2026-09-27 — Task15 mechanical assertion inventory

Task14 `draftAnalysis` now returns exact claim-context, packet, model, and prompt
provenance. Added `server/analysis/coverage.js`: it revalidates the packet/draft,
segments every non-limitation block into bounded sentences independently of the
writer's assertion list, binds sentences to passage IDs, reports unmapped,
unknown, or unaccepted-extraction evidence, and hashes the checked version.
Semantic review is always still required; incomplete coverage and counterevidence
remain explicit blocking issues. A disposable real schema29 integration probe
mapped 2/2 sentences and retained coverage, extraction, and semantic-review
blockers. `node --check` and new-file whitespace checks passed. Per owner policy,
no unit test was added. Task15 remains incomplete pending Jev sentence relations,
quote/page-map and OCR fidelity checks, adversarial fixtures, persistence, and
changed-block rechecks. No provider/model call, paid usage, DB persistence, or
deployment occurred.

`server/analysis/verify.js` now provides the next offline stage through an
injected decision adapter. It refuses dispatch for unaccepted cited or
counterevidence extraction, includes all counterevidence with every sentence,
caps each case, and requires exact assertion/model/policy/input-hash binding.
Model outputs are only `semantic_candidate` results: mechanical blockers remain,
human confirmation is always required, and disagreements with recorded human
relations are explicit blockers. A disposable schema29 fake-adapter probe
covered mechanical no-dispatch, two bounded decisions, malformed response
rejection, and human confirmation/disagreement. No live Jev call or admission
path is wired. Task15 remains incomplete for the limitations listed above.

Task14 citations now require bounded exact UTF-16 quote spans tied to stored
passage text. Task15 detects straight/curly/guillemet, bounded single-quoted,
and Markdown-block quotations independently of the writer; an unverified or
malformed quotation is a mechanical blocker and prevents decision dispatch.
The writer instruction requires structured double-quoted spans. A real schema29
probe accepted an exact span and rejected missing and malformed spans; the
focused quote detector passed 5/5 including contractions and unmatched quotes.
PDF page-map/rendered-original fidelity remains open, so quote mechanics do not
yet complete Task15. Evidence packets expose extraction summaries but not the
trusted PDF page/box projection needed to prove a locator. A quotation tied to a
Poppler extraction now emits `pdf_page_map_required`, treated as a pre-dispatch
hard blocker until that projection is implemented. The focused runtime detector
probe passed 4/4 for Poppler, HTML, empty-manifest, and absent-passage inputs.

Task15 decision requests now separate immutable relation-review instructions
from an `untrustedEvidence` envelope. Assertions, claims, passages, metadata,
and recorded assessments are explicitly data, never instructions, and both the
task and evidence envelope are covered by the adapter input hash. The focused
guard constant probe passed. No live adversarial Jev run occurred, so prompt-
injection resistance remains an unmeasured release gate.

The Task15 verifier now pins decision candidates to exact `jev-1.13.0` and
`assertion-review-v1`; arbitrary or mutable model/policy identifiers fail before
packet processing or adapter dispatch. The focused alias probe rejected both a
mutable model and mutable policy 2/2. This does not select a writer model or
enable live Jev.

Task15 semantic evaluation is sequential and now stops on the first adapter
failure, retaining `semantic_review_failed` and `semantic_review_incomplete`
blockers. A provider outage therefore cannot fan out calls across the remaining
assertion inventory. Durable budget admission/retry ownership remains future
integration work.

Task15 verification now accepts an optional validated AbortSignal, rejects work
already cancelled, checks cancellation between sentences, passes the signal to
the decision adapter, and stops with `semantic_review_cancelled`. The focused
pre-cancelled/invalid-signal probe passed 2/2. Adapter-level deadlines and
durable job cancellation still belong to the future wired integration.

Recognized durable-worker control errors are preserved: pause, budget guard,
permission, lease loss, deadline, cancellation/timeout, provider pause/auth/
rate/overload/configuration, and provider transport failure are rethrown for
the existing job/recovery layer. Generic adapter failures still stop the loop
and produce an incomplete content-review report.

The verifier accepts optional `deadlineAt` and injected `clock`, validates both,
and throws `deadline_expired` before inventory processing if the deadline is
reached. Focused probe: deadlineAt 100 with clock returning 100 yielded
`deadline_expired`; fractional deadline and nonfunction clock each yielded
`invalid_request`. `node --check server/analysis/verify.js` passed. This remains
caller-supplied deadline enforcement, not durable job deadline integration.

# 2026-09-27 — Task15 trusted PDF page-map projection

`buildEvidencePacket` now selects the latest accepted Poppler extraction whose
text hash matches the immutable document and projects only the current passage's
overlapping page ranges, allowlisted word boxes, render hashes/dimensions and
extraction hashes. The projection excludes private object keys, binds the exact
passage text and UTF-16 range, derives a canonical `page N` / `pages N-M`
locator, and is counted against the packet resource budget. Malformed manifest,
render or coordinate state fails closed.

Task15 coverage now treats either the trusted document extraction method or a
Poppler manifest as requiring a PDF map. It validates the stored locator against
the canonical mapped pages, verifies non-whitespace quote characters resolve to
word boxes, rejects duplicate/missing/tampered maps, merges intervals rather
than scanning every box per character, and caches passage/span results within an
inventory. `verifyCurrentAnalysis` rebuilds the packet from the current database
and rejects stale draft provenance before any decision-adapter call. The direct
packet function remains available only as the provider-neutral offline contract;
future live job/provider wiring must use the trusted rebuild boundary.

Verification: syntax checks passed for `packet.js`, `coverage.js` and
`verify.js`. A disposable real schema29 projection produced canonical `page 1`,
one page, three word boxes and no private keys. Focused probes rejected false
locator, removed word coverage, text tamper, duplicate page, PDF-manifest
relabeling through the stored extraction-method check, and a stale draft with
zero adapter calls. Existing affected suites passed 28/28. The full backend
suite passed 58/58 suites, 545 tests with one optional skip. A scoped Sol review
identified three Important issues and one Minor; the single fix pass addressed
all four categories. Per owner policy, no unit test was added.

This is not Task15 completion or rendered-original fidelity proof. Live Jev
admission, durable job deadlines/cancellation, adversarial evaluation,
verification-result persistence, revision changed-block rechecks, and broader
PDF/OCR fidelity gates remain open. No provider/model call, production mutation,
deployment or paid usage occurred.

Task15 revisions now have a fail-closed changed-block plan. Coverage assigns
deterministic block and assertion hashes, and `planChangedBlockRecheck` returns
previous/current draft hashes, previous/current checked-version hashes, uniquely
matched unchanged block pairs and the block indexes requiring recheck. Packet,
claim-context, model, prompt, citation, assertion-list, uncertainty, chronology
or summary changes force every current block back through verification. Duplicate
block hashes are treated as ambiguous and rechecked rather than reused.

A disposable schema29 probe changed one evidence block and obtained only block0
in the recheck set with the unchanged limitation block paired. Changing citation
structure forced both blocks; changing the packet version also forced both and
retained the earlier draft hash. Syntax passed. This contract does not yet reuse
semantic decisions or persist reports, so Task15 remains in progress and no live
adapter/provider call or production mutation occurred.

# 2026-09-29 — Task15 immutable analysis verification persistence

Local schema30 adds append-only `analysis_versions` and
`analysis_verification_reports`. Drafts are content-addressed and bound to the
current claim context, packet, writer model and prompt; SQLite rejects a context
from another claim. Saving requires an editor and rebuilds the trusted evidence
packet. `verifyAndRecordAnalysis` uses the current-packet verifier and repeats
the packet/version check in the final immediate transaction after adapter work,
so intervening evidence changes discard rather than misattach a report. Draft
and report hashes are checked, retries are idempotent, and update/delete triggers
protect both histories.

A disposable schema30 probe saved the same draft twice as one row, persisted a
mechanically blocked report with zero adapter calls, and confirmed immutability.
The schema-upgrade fixtures were updated for the new append-only tables; focused
recovery/migration checks passed 3/3. The final backend suite passed 58/58 suites,
545 tests with one optional skip. No new unit test was added. No live provider
call, production DB migration, deployment or paid application usage occurred.
Railway stays schema21 and no schema30 image exists. Task15 still lacks durable
job dispatch for semantic verification, report review UI and semantic-result
reuse; broader accuracy gates remain open at this schema30 checkpoint. The
subsequent schema31 entry below supersedes its durable-job-dispatch status.

# 2026-09-29 — Task15 durable semantic verification jobs

Local schema31 adds durable analysis-verification job records and append-only
editor permission events. Admission hash is SHA-256 of the JSON tuple
`[draft_sha256, packet_version, policy_version, decision_model]`. Current editor
role is rechecked before adapter calls; revocation, global/provider pause, stale
context, lease ownership, and task deadline are fenced before every call. Each
assertion gets deterministic request key
`analysis-verification-job:<jobId>:input:<inputHash>`. Immutable report insertion
and job completion are atomic and database-bound to the analysis version. Global
admission status includes analysis-verification active leases and backlog. Raw
transports fail closed unless the adapter declares `durable-budgeted-v1`.

Disposable probes covered auth/no-auth, role revocation, pause, stale context,
lease, idempotency, raw-adapter rejection, and cross-version report binding.
Backend passed 58/58 suites, 545 passed, 1 skipped; frontend lint/build passed.
No bootstrap, route, or configuration was added, and no live call or deployment
occurred at this checkpoint. Railway remains schema21, with no schema31 image.
The lease-through-deadline behavior recorded here is superseded by the following
adapter checkpoint, which adds a 30-second renewable lease and safe
cached/pending takeover.

# 2026-09-29 — Task15 durable-budgeted Jev assertion adapter

Added `server/analysis/jev-adapter.js`, reusing `runJevCall` and the immutable
reservation, settlement, concurrency-slot, and audit ledger. Strict pinned
model/policy, input-hash, request-key, and complete evidence preflight checks run
before transport. The adapter makes one bounded `passage-v1` call per cited or
counterevidence passage. Aggregation precedence is contradiction > supports >
mentions_only > insufficient; it returns only matching passage IDs. Per-passage
keys are deterministic. Exact-key cached crash replay is safe; unknown or missing
settlement blocks without another transport. Retry suffixes are allowed only for
allowlisted failures after explicit `not_billed` reconciliation, capped at three
attempts. The actual `preDispatch` fence runs inside the send transaction. A
30-second renewable lease uses `leaseGuard` on new and cached paths. Typed budget
and reconciliation controls prevent incomplete reports from being persisted.

Security re-review found no P1/P2 findings. Disposable probes covered
two-passage aggregation, preflight, billed/cached replay, unknown hold and
`not_billed` retry, pause/revocation fence, expired-lease takeover/stale token,
accepted-extraction end-to-end `semantic_candidate`, and cached-path lease
renewal. Backend passed 58/58 suites (545 passed, 1 skipped); syntax checks
passed. No live calls, startup, routes, configuration, or deployment occurred.
Railway remains schema21; no schema31 image exists. Task15 remains incomplete:
add authenticated queue/report routes and review UI, then gated bootstrap/config
activation and final live sandbox authorization/evaluation. Adversarial and
fidelity gates remain open.
## 2026-09-29 — Task15 authenticated editor analysis review surface

Authenticated local editor routes now expose immutable analysis versions,
verification-job queue/list/detail, permission events, and attached reports.
Drafts and reports are integrity checked. Permission writes compare the expected
permission event ID and exact admission hash. The JSON parser accepts at most
300 KB and rejects compressed/inflated input. The Research Desk now saves
editor-only grounded JSON drafts, queues bounded jobs separately, lists/selects
versions and jobs, displays report stages/blockers/assertions/coverage, and
requires a reason plus confirmation for separate allow/revoke actions. Queueing
does not grant permission, no worker is activated, and no live worker is implied.
All editors currently have operator authority.

Disposable auth, parser-boundary, and integrity probes passed. Backend passed
58/58 suites (545 passed, 1 skipped); frontend lint/build passed. Final Astra
audit found no P0/P1/P2 issue. No live calls. Local schema31 remains unreleased;
Railway and its active DB are schema21 with no schema31 image. Task15 remains
incomplete. Next gates: explicit worker/bootstrap/config activation, adversarial
and accuracy/fidelity evaluation, fresh encrypted off-Railway backup and
coordinated schema21→31 release, staging end-to-end/editor-browser review, and
public/publishing gates.
## 2026-09-29 — Task15 explicit analysis-verification activation slice

`server/config.js`, `server/bootstrap.js`, and `.env.example` now implement
`ANALYSIS_VERIFICATION_ENABLED`, strict and default-off. Activation requires
exact staging deployment environment, key, positive global/classification
budgets, one maximum concurrent model call, token limit, and absolute fail-closed
guard validation. Analysis-only mode creates a shared guard; only the audited
durable-budgeted adapter is accepted. One serial worker uses a renewable 30-second
lease; fatal guard errors halt, shutdown aborts/drains before database close, and
there is no auto-permission or recovery path.

Disposable schema31 fake-client bootstrap probes passed authorized dispatch and
report persistence, unapproved exclusion, global/provider pause, pre-send
revocation, fatal failures before/after dispatch, and in-flight abort/drain with
unknown settlement. Exact 64,000-token gate and drain-before-close were
confirmed. Backend passed 58/58 suites, 545 passed, 1 skipped. No live calls,
deployment, or environment mutation occurred; runtime remains off. Astra's final
recheck found no remaining P0–P3 findings and no activation regression. Provider
auth/config failures currently terminal analysis jobs;
existing recovery covers claim jobs only. Before opt-in: isolate staging
resources/credentials and pass adversarial, accuracy, and rendered-fidelity
gates. Schema31 remains local; Railway schema21 has no release image. Task15 and
production remain incomplete.
## 2026-09-29 — Task16 private schema33 exporter

Local runtime now requires schema33. Implemented a private filesystem exporter
and outbox worker with exact staging-only, default-off activation. It verifies
canonical DB/root identity and takes an exclusive sink process lock. `head.json`
is O(1), while immutable history and installed-generation proofs preserve
generation identity. Startup reconciles receipts, artifacts, delivery tasks,
and outbox records exactly. Latest-review and final-pause fences reject stale
publication while still allowing invalidation. Interrupted pending/link work
supports recovery and replay. Linux directory fsync failure fails closed;
production Windows activation is rejected. DTO/object prewrite happens outside
the final SQLite transaction. Coverage remains a hard actual-publish blocker.
There are no public routes, public/CDN purge, real production integration,
deployment, or paid/live model calls.

Backend: 58/58 suites, 545 passed, 1 skipped. Focused disposable crash, tamper,
46-generation, clone, process-lock, pause, invalidation, and fsync probes passed.
Astra final review reported no P0–P3 findings. Railway remains schema21 with no
schema33 release image. Release still requires fresh encrypted off-Railway
backup, Linux filesystem/runtime validation, coordinated backup-first
migration, and E2E after implementation. Task16 and production remain
incomplete.

## 2026-09-29 — Task16 schema33 release image artifact verification

The release bundle now includes analysis-verification and private publication
runtime. The host orchestrator loads the trusted verifier, captures one bounded
tar `Buffer`, validates/extracts that same buffer, and streams those exact bytes
over stdin to both Docker targets. The Dockerfile is in the archive. Images are
labeled with the manifest digest; CI uses immutable image IDs. The exact source
tar is retained and round-trip verified.

Evidence: manifest has 141 files / 912,247 bytes and digest
`327071bd14ba91264ef4715bb74be67a3860e183c5321ff04626d6e749cfbaad`; tar
SHA-256 is `564a8ff94952b3611d84664f3c8ed3d4eb33e7e25bd177bfd070d9c35f94167b`
(1,085,440 bytes). Runtime image ID is
`sha256:726effb734a9247a701290ddc708340cdd83aba5cf68e4e622190383e105f25b`;
toolchain image ID is
`sha256:18698ec2b02af34e663b71f7d7323495aa347741aba6b49391c78314452d4f0d`.
Parser, PDF, non-root container, native sandbox, and archive smoke checks passed;
relevant parent tests passed 54 with 1 skipped. Astra found no P0–P3 issue and
the source-archive TOCTOU P2 is closed within the trusted-runner boundary.

Hosted Linux CI, production volume ownership/permissions, export durability,
PID 1 behavior, backup-first schema21→33 migration, staging E2E/recovery, and
public gates remain open. Railway remains schema21. No deployment or live/provider
calls occurred. Trust includes the CI runner, already-loaded helper/verifier,
process memory, Docker, and tar; dependency downloads are not source-manifest
attested. The release-desk UI still awaits approval.

## 2026-09-29 — Task16 authenticated publication editor API

Added session-authenticated, CSRF-protected publication state, review, action,
and retraction routes under `/api/v1/editor`. The actor is session-bound.
Review/action inputs require exact bodies with dependency-hash and expected
review/head/generation compare-and-set fields, reason, and idempotency key.
Owner-only retraction remains available when claim state independently blocks
preview. Responses are sanitized allowlists with private/no-store headers;
they omit raw reports, private evidence, request hashes, and owner lists.
Pre-router errors are sanitized. Coverage remains an actual-publish blocker;
this adds no UI, public routes, or delivery guarantee.

Backend verification: 58/58 suites, 545 passed, 1 skipped. Disposable HTTP
flows passed; Astra final review found no P0–P3 findings. No deployment,
production integration, or live/paid calls occurred. Railway remains schema21;
the later verified-image checkpoint records artifact status. Next: bounded
release-desk UI, then remaining
coverage/evaluation/public/E2E/deployment gates. Task16 and production remain
incomplete.

## 2026-09-29 — Task16 audited publication core

Local schema version is 32. Migration032 adds an initially-empty audited
publication-owner capability, immutable review/snapshot/event/dependency records,
monotonic desired-manifest heads/tombstones, immutable outbox identity, and
per-target durable delivery tasks, lease attempts, and receipts. The explicit
`provision-publication-owner` CLI only grants an already verified editor; there
is no HTTP self-promotion. Claim restriction/restoration and source restriction
transitions require the owner in the same transaction. Dependency changes
tombstone the active desired head and queue invalidation.

A text-only DTO binds exact draft/report/DTO/packet/context/access dependencies;
it inventories packet sources and fails closed for private/restricted content,
unsafe URLs, HTML, and uncovered dependencies. Approval never clears report
blockers. Real publish remains blocked by `coverage.complete=false`; only
`human_confirmation_required` can potentially be satisfied. No public routes,
export worker, startup/public activation, or live publication exists.

Disposable probes covered schema/idempotency, owner grant/revoke/denial, exact
binding/CAS/idempotency, private/unsafe/uncited counterevidence dependencies,
coverage block, and synthetic atomic publish/correct/retract/outbox/invalidation/
rollback. Latest worker-reported backend suite: 58/58 suites, 545 passed, 1
skipped; parent rerun remains in progress. Astra found no P0–P3 findings. Railway
is schema21 with no schema32 image. Fresh encrypted off-Railway backup and
coordinated 21→32 migration remain required. Next: private outbox exporter with
monotonic sink fencing and purge verification, authenticated editor routes/UI,
coverage/evaluation gates; public API only later. Task16 and production remain
incomplete.

## 2026-09-30 — fresh encrypted Railway recovery point

Ran the explicit one-off Railway-to-Windows backup tool against the active
`/data/research/easy-news.db`. It created a consistent schema21 snapshot,
encrypted it locally with the existing DPAPI-protected age identity, and
restore-tested the decrypted bytes through schema33. Integrity and foreign-key
checks passed, accounts were preserved, and the source contained zero archived
original files. Production was not migrated or restarted.

Retained artifact:
`C:\Users\grifm\AppData\Local\EasyNews\recovery\easy-news-2026-09-30T00-41-28-897Z-55688e3e-df1d-48b6-bfd8-dc1697e73719.db.age`;
SHA-256 `771f1e9ef6491065f6acd5d65a053b8d4ec7ef7034aaecde14b5bcf3e3e02c1d`.
This is the current manual pre-migration recovery point, not evidence for
scheduled off-host retention, portable key custody, fresh-host RPO/RTO, or
publication/outbox recovery. Railway remains schema21.

## 2026-09-30 — encrypted fresh-container restore rehearsal

Added the security-reviewed, host-only `server/ops/rehearse-encrypted-restore.js`;
it is excluded from future release bundles. Its accepted file boundary resolves
local same-basename paths only, binds the canonical parent to the resolved
trusted recovery directory, checks both requested and resolved paths for
reparse points, and retains file-descriptor/hash binding. The initial preflight
failure came from packaged Codex AppData virtualization; it was corrected by
accepting only the resolved local artifact under the trusted recovery directory.

Synthetic and real encrypted artifacts both returned strict success in fresh
containers: schema21→33, integrity and foreign-key checks true, zero archived
originals, source preserved, and private canonical `users`, `user_roles`,
`google_identities`, `auth_sessions`, and `role_change_events` preserved with
one row each. Health was live/ready. The real run used encrypted artifact SHA-256
`771f1e9ef6491065f6acd5d65a053b8d4ec7ef7034aaecde14b5bcf3e3e02c1d`, runtime
image `sha256:726effb734a9247a701290ddc708340cdd83aba5cf68e4e622190383e105f25b`,
and manifest `327071bd14ba91264ef4715bb74be67a3860e183c5321ff04626d6e749cfbaad`.
Docker Desktop Linux used a pinned named pipe. The container had no network,
host mounts, socket, or credentials; it ran non-root/read-only, without
capabilities, with no-new-privileges, resource limits, and tmpfs. Output was
sanitized and cleanup used exact container ID/name. `service.stop` and limits
were checked. Independent post-run checks found zero restore containers,
Docker-config temporary directories, and cipher temporary directories. Four
suites passed: 37 passed, 1 skipped. Astra found no P0–P3 findings.

Limits remain: same-host/current-Windows-user DPAPI key recovery only; no fresh-
host key proof. Immutable base64 transport, swap/dump exposure, and local Docker
trust remain. `service.stop` does not prove PID1 signal handling. Production
volume permissions/export durability, scheduled off-host retention/alerts,
measured RPO/RTO, originals backup/reconciliation, publication/outbox restore,
hosted Linux CI, public/E2E/coverage gates, and coordinated backup-first
migration remain open. Railway is unchanged at schema21; there was no deploy or
live/provider call, and release-desk UI approval remains outstanding.

## 2026-09-30 — exact schema33 image PID 1 gate

Ran the immutable runtime image
`sha256:726effb734a9247a701290ddc708340cdd83aba5cf68e4e622190383e105f25b`
(manifest
`327071bd14ba91264ef4715bb74be67a3860e183c5321ff04626d6e749cfbaad`)
against a disposable Docker Desktop Linux named volume. The first setup probe
failed because `--cap-drop ALL` also removed `CAP_CHOWN`; a minimal comparison
confirmed that adding only `CAP_CHOWN` to the isolated root setup helper created
UID/GID 1000, mode 0700 directories. Database initialization and the runtime
itself then ran non-root with every capability dropped, no-new-privileges, no
network, a read-only root filesystem, and private tmpfs.

`node index.js` was PID 1 with PPID 0, UID/GID 1000, effective capabilities
zero, and `NoNewPrivs: 1`. Live and ready health checks returned 200. A real
Docker SIGTERM stop completed in 211 ms with exit 0, no OOM kill, and no state
error. The stopped database was schema33 with `integrity_check=ok` and zero
foreign-key violations. The disposable container and volume were removed.

This closes the local exact-image PID 1 gate only. Railway volume
ownership/permissions and export durability, hosted Linux CI, UI approval,
coverage/evaluation/public/E2E gates, and coordinated backup-first migration
remain open. Railway stayed schema21; no production data, deployment, provider
call, or repository code changed.

## 2026-09-30 — read-only Railway volume permission inspection

The Railway CLI was absent, so the authenticated Railway console was used only
for read-only `id`, `stat`, and permission predicates. A single live-health GET
woke the idle instance. Active successful deployment
`10d63288-d3f0-4601-aa55-d2e7dfdd6402` currently runs as root. `/data` is root
owned mode 0755; `/data/research` is 1000:1000 mode 0700; the active schema21 DB
is 1000:1000 mode 0600; `/data/originals` is root owned mode 0755. A `su` probe
as UID/GID 1000 confirmed DB read/write and research-directory write access,
but no write access to `/data` or `/data/originals`.

The non-root schema33 image is compatible with the DB path. It cannot create a
new private sink at `/data`, and the exporter forbids overlap with DB/archive/
budget/frontend/build paths. Controlled maintenance must create a distinct
`/data/publication-export` (or equivalent sibling), owner 1000:1000, mode 0700,
before private export activation. Archive writes require a separate deliberate
ownership change for `/data/originals`; do not broadly relax `/data`. No file,
database, variable, deployment, or configuration changed. Export durability and
the coordinated migration remain open; Railway stays schema21.

## 2026-09-30 — Railway Hobby backup constraint

Read-only inspection of the authenticated service Backups page states that
creating backups and enabling PITR are available only on Pro. The Easy News
project remains on Hobby under the approved $10/month target; no plan, backup,
or PITR setting changed. Task22 therefore still requires the separate encrypted
off-Railway schedule, retention, portable-key, alerting, and fresh-host recovery
work. The current manual encrypted artifact is not a scheduled backup system.

## 2026-09-30 — hosted PID 1 gate prepared

Extended the untracked `.github/workflows/ci.yml` release job with an Ubuntu
exact-image PID 1 gate. It creates a UID1000 disposable bind path, initializes
schema33 as the image user, runs the default image command under networkless,
capability-free, no-new-privileges/read-only constraints, waits for live/ready,
asserts `node index.js` is PID1 with PPID0/UID1000/GID1000/zero capabilities,
requires clean SIGTERM state, and rechecks database schema, integrity, and
foreign keys. Exact-name cleanup is trapped.

Ruby accepted the workflow YAML and the extracted step passed Git Bash `bash -n`.
The underlying runtime sequence already passed locally against the immutable
image, but this workflow revision has not been committed, pushed, or run on
GitHub. Hosted Linux CI remains an open release gate.

## 2026-09-30 — Task 17 public read API

Added `server/routes/public.js` and mounted it minimally from `server/app.js`.
Topics, claims, analyses, and search are admitted only through the current
active publication head when all four delivery targets have matching completed
same-generation installation receipts. DTO JSON is hash checked, canonical,
and recursively allowlisted. Current restriction/supersession state and later
source-access policy changes fail closed. The saved endpoint is authenticated,
private/no-store, and intentionally empty until reviewed bookmarks exist.

The existing backend suite passed 58 suites (546 passed, 1 skipped), syntax
checks passed, and disposable schema33 HTTP probes covered negative privacy,
bounds, ETags, a synthetic positive publication, and zero database writes from
anonymous public GETs. The positive fixture bypassed publication write guards
in memory, so this is not evidence that the coverage gate or filesystem exporter
can publish real material. No unit tests were added and no provider, network,
production, commit, or deployment action occurred. The current immutable image
does not contain this change and is stale for release purposes.

## 2026-09-30 — Task 15 PDF boundary and Task 17 public hardening

Closed the scoped PDF review findings in `server/evidence/packet.js`,
`server/analysis/coverage.js`, and `server/analysis/verify.js`: canonical PDF
locators are bound to projected pages, public packet fields are explicit,
interval coverage is prepared once, and only a fresh DB-backed packet can reach
semantic dispatch. Disposable probes rejected a false locator, an injected
private manifest field, and a rehashed extraction relabel with no adapter call;
the maximum 5,000-interval probe with 100 assertions took 23 ms.

Astra's public API audit found and the parent fixed: stale approval after later
rejection (P1), unreviewed topic slug leakage (P2), unbounded list/search scan
work (P2), and percent-encoded private-path bypass (P2). The public gate now
requires the latest exact review, emits opaque topic IDs, caps scan/window work
at 1,000 rows, and rejects percent-encoded paths both when producing and reading
the DTO. A real ephemeral HTTP listener verified readable approval, full hiding
after rejection, no old-ETag 304, no revival by a later approval, opaque topic,
and bounded pagination. The current-runtime sink mount/reconciliation is still
not proven merely by historical database receipts and remains a release gate.

The combined backend run passed 58 suites, 546 tests, with 1 skipped. No tests
were added, and no provider, network, production, commit, or deploy action was
taken. Rendered PDF fidelity remains unverified.

## 2026-09-30 — Task 13A deterministic evaluator scaffold

Added `server/evals/accuracy.js`, `evals/reference.schema.json`,
`evals/protocol.json`, and an explicit not-run accuracy report. Whole-case pass
requires the exact reference disposition, all five rubric dimensions, and zero
critical errors; missing output remains a failure. The scorer reports Wilson
interval, per-disposition and macro accuracy, correct-resolution coverage,
attempted-resolution precision, abstention diagnostics, and unique-family
counts. The conjunctive gate requires 200 independent families, 95% observed
accuracy, 90% Wilson lower bound, 90% macro accuracy, 70% resolution coverage,
zero critical errors, and explicit protocol/review/class-coverage completion.

Syntax/JSON checks passed. A deterministic 190/200 probe returned a 0.9104
Wilson lower bound and passed; a 90/100 run and duplicate families failed. The
protocol is intentionally `incomplete`: no restricted labels, independent
review, actual candidate run, or accuracy claim exists.

## 2026-09-30 — staging public-read admission

Added explicit default-off `PUBLIC_READ_ENABLED`. It is valid only in staging
with the private exporter enabled. Bootstrap binds and reconciles the current
sink before listening, and the public route guard rechecks the held lock, root
identity, and marker identity. Sink loss or a fatal exporter reconciliation
error latches topic/claim/analysis/search GET/HEAD requests to private `503`
responses; health/editor/operator/account access remains available.

Disposable HTTP probes covered default-off, reconciled staging, database-only
restore, post-start marker loss, route variants, and preserved non-public access.
Backend passed 58 suites, 546 tests, with 1 skipped. No unit test, deployment,
production mutation, provider call, or commit occurred. This does not authorize
public production reads or replace Task23/24 release evidence.

## 2026-09-30 — scheduled encrypted backup restored

Resolved the Task Scheduler path failure to Codex packaged-app virtualization:
interactive `C:/Users/grifm/AppData/Local/EasyNews` mapped to physical
`C:/Users/grifm/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EasyNews`.
`server/ops/backup-railway-to-windows.js` now uses physical package-cache paths
for recovery storage and age tools. The `EasyNewsEncryptedBackup` task is restored
to the Node script action, daily 03:00, `StartWhenAvailable`, `IgnoreNew`, and
current-user Interactive/Limited. Verified actual run: LastRunTime
2026-09-29 21:40:51 -04, LastTaskResult 0; status success at
`2026-09-30T01:40:54.307Z`.

The current encrypted artifact is
`easy-news-2026-09-30T01-40-53-849Z-b3d8ae2e-30e8-4a5b-abfc-a2437a2e7d05.db.age`,
SHA-256 `ca4fb68f12a374a0b894a7a1be2caf6809e5a71dbe775563c2bfa366679540f3`,
matching one sidecar. Retention dry-run kept this plus the verified Sep23 03:35
generation and removed none; two older Sep23 encrypted artifacts without
sidecars remain for manual review. Normal retention later removed redundant
verified copies, including the previous Sep30 01:35 artifact. Current verified
recovery remains. This records a material deletion of redundant encrypted
copies. DPAPI still binds key recovery to the current Windows profile; no
fresh-host/key escrow proof or alert delivery exists, and archived originals
remain absent. No Railway deployment or production migration occurred; Railway
is schema21 and local code schema33. See RESUME, OPERATIONS, and
DEPLOYMENT_RUNBOOK for checkpoint details.

Owner-approved model routing is active operational guidance: Luna low for bounded
documentation/simple UI, Sol medium for backend/deployment/debug/E2E (high when
needed), Astra only for a specific difficult blocker/high-risk review. Root model
selection remains owner-controlled in the picker; subagent usage is part of
account-wide usage.

## 2026-09-30 — hosted release-candidate CI passed

GitHub Actions run [36658183725](https://github.com/grifmang/-theeasy.news/actions/runs/36658183725)
passed in 2m32s on branch `codex/accuracy-production`, exact SHA
`4b7c4d04f9ddd917b1c00b725e126a09e451bda4`. Gates passed for checkout without
persisted credentials, pinned Gitleaks history/source scanning, Node setup,
locked dependency installs and advisory checks, full backend/frontend
regressions, frontend build, release bundle staging/verification, Docker build
from the bundle, generated source/browser asset secret scans, isolated container
extraction/startup/shutdown, exact-image PID1/SIGTERM, native sandbox adversarial
checks, and retained/uploaded evidence.

The CI-only fixes added Linux test-fixture mode 0700 and narrowed frontend alert
selectors; no production logic was relaxed. Railway and Netlify did not
auto-deploy: Railway tracks `main`, while Netlify deploys through the CLI.
Railway remains schema21 and no deployment or production migration occurred.
This is hosted CI evidence for the exact release candidate, not production
readiness or deployment approval. Backup-first migration, Railway sink/archive
ownership and export durability, recovery/key-custody gates, accuracy, coverage,
public/E2E and remaining approvals are still open. Owner untracked
`docs/REVIEW-2026-06-09.md` remained excluded from the release bundle.

## 2026-09-30 — Task17 topic browse API and Task18 public reader/review UI

Task17 implements `GET /api/v1/topics/:slug` with strict
`topic-<positive safe integer>` validation, bounded pagination, an approved
public DTO, and ETags. Task18 adds public home/topic/claim/analysis routes and
an honest legacy article notice. The editor publication panel supports
exact-hash review, publish, correct, and retract. Malformed-success retry
identity is preserved; the route-stale DTO issue is fixed; the UI and
transaction enforce the active-version fence. Final bounded Astra recheck found
no remaining blocker within this slice.

Verification: backend 58/58 suites (546 passed, 1 skipped); frontend 6/6 suites
(41 tests); lint, public-config, build, and `git diff --check` passed. No
Railway/Netlify deployment occurred. Production remains schema21; local schema
is 33. Broader release, deployed-browser, accessibility, and E2E gates remain.

## 2026-09-30 — Task18 public bookmarks, review detail, and corrections

Commits `63022ce`, `8675bcd`, and `9b2038c` complete the local schema34
Task18 slice. Additive public bookmarks use session, origin, and CSRF checks,
and writes require current public admission. Saved reads recheck admission and
hide withdrawn material. Authenticated bounded review queue/history and
claim-scoped ReviewDetail show saved draft, evidence, and original/extraction
comparison. Sanitized public correction chronology proves exact-generation
installation across four targets, paginates with cursors, and independently
discovers the latest correction. The public Corrections UI and focusable,
returnable citations are implemented.

All five Important findings in the Task18 review fix round were addressed. A
bounded Astra audit found no P0/P1; its P2 (owner retraction unavailable after
evidence/report failure) was fixed and re-reviewed clean. Retraction is an
independent owner action; review, publish, and correct still fail closed when
evidence/report checks fail.

Verification: backend 58/58 suites, 546 passed/1 skipped; frontend 6/6 suites,
41 tests; lint, config boundary, build, syntax, and diff checks passed. The
disposable 130-generation/22-claim probe passed uninstalled exclusion,
pagination, latest correction, and tombstone hiding. No new unit tests, live
provider/model calls, production DB use, or deployment. Cost attribution is
explicitly unavailable; chronology is cursor-paginated, not complete in one
response. Local is schema34 and Railway schema21. Real exporter staging,
browser accessibility/E2E, fresh restore, and hosted CI for schema34 remain
open. Hosted run 36660112527 proves only `090278c`, not current head.

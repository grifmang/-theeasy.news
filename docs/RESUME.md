# Resume checkpoint — 2026-09-29

## Scheduled encrypted backup restored — 2026-09-30

The scheduled Windows backup now runs against the physical AppData path. The
Task Scheduler root cause was Codex packaged-app virtualization: interactive
`C:/Users/grifm/AppData/Local/EasyNews` mapped to
`C:/Users/grifm/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EasyNews`,
which Task Scheduler could not resolve through the interactive alias. The
operator script now uses the physical package-cache recovery and age-tool paths.
`EasyNewsEncryptedBackup` is restored to a Node script action, daily at 03:00,
with `StartWhenAvailable`, `IgnoreNew`, and current-user Interactive/Limited
security. Its actual run at 2026-09-29 21:40:51 -04 completed with task result
0; status records success at `2026-09-30T01:40:54.307Z`.

Verified encrypted artifact:
`C:/Users/grifm/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EasyNews/recovery/easy-news-2026-09-30T01-40-53-849Z-b3d8ae2e-30e8-4a5b-abfc-a2437a2e7d05.db.age`;
SHA-256 `ca4fb68f12a374a0b894a7a1be2caf6809e5a71dbe775563c2bfa366679540f3`,
matching one sidecar. Retention dry-run kept this artifact and the verified
2026-09-23 03:35 generation, removed none, and flagged two older Sep23 encrypted
artifacts without sidecars for manual review. A subsequent normal retention run
removed redundant verified copies, including the earlier Sep30 01:35 artifact;
the current verified recovery point remains. This material deletion was limited
to redundant encrypted copies.

The scheduled process action and exact run were verified; this is an on-PC
scheduled backup, not portable key custody or delivered alert evidence. The age
identity remains DPAPI-protected for this Windows profile, fresh-host/key escrow
proof and alert delivery are absent, and archived originals remain excluded.
Railway production remains schema21 while local code is schema33. No Railway
deployment or production migration occurred. See [operations](OPERATIONS.md),
[runbook](DEPLOYMENT_RUNBOOK.md), and [worklog](AGENT_WORKLOG.md#2026-09-30--scheduled-encrypted-backup-restored).

Owner-approved task model routing is operational: Luna low for bounded docs and
simple UI, Sol medium for backend/deployment/debug/E2E (high when needed), and
Astra only for a specific difficult blocker or high-risk review. The root model
still requires owner selection in the picker; subagent usage counts toward
account-wide usage.

## Staging public-read runtime admission — 2026-09-30

`PUBLIC_READ_ENABLED` is now explicit, default-off, and accepted only for the
staging deployment environment together with the private publication exporter.
Before HTTP listens, startup must bind the current sink, run exact reconciliation,
and prove the live root/marker/lock identity. Each public topic, claim, analysis,
or search GET/HEAD rechecks the live binding. A missing/changed sink or fatal
export reconciliation error latches public reads closed with `503` and
`Cache-Control: no-store`; editor, account, operator, and health routes remain
available. This prevents a database-only restore from treating historical
receipts as proof of the current filesystem installation.

Disposable HTTP probes covered default-off reads, successful reconciled staging,
a database restored without its sink, post-start marker loss, case/trailing-slash
variants, and continued health/editor behavior. The backend suite passed 58/58
suites, 546 tests passed and 1 skipped. This is private-staging admission, not
production public cutover or CDN/static-host evidence. No production variable,
filesystem, deployment, or provider state changed.

## Task 15/17 hardening and Task 13A scorer scaffold — 2026-09-30

Task 15 now rejects stored PDF locators that conflict with the trusted projected
page map, derives only missing locators, and projects explicit allowlisted
manifest/page/word fields. PDF word intervals are merged once per passage and an
uncovered-character prefix answers later span checks in O(1). Packet-only
`verifyAnalysis` is mechanical and cannot dispatch semantic decisions;
`verifyCurrentAnalysis` rebuilds the packet from current database state before
the runtime adapter can run. Disposable probes blocked false locators, injected
private fields, and rehashed extraction relabels with zero adapter calls; a
5,000-interval/100-assertion probe completed in 23 ms. Rendered-original
fidelity remains a separate open gate.

A narrow Astra review of Task 17 found one P1 and three P2 issues. The public
query now requires the snapshot approval to be the latest review, so a later
rejection—or a later approval with a different review identity—does not leave or
revive the old publication. Topic slugs are opaque `topic-<id>` identifiers,
list/search work and pagination are capped to a 1,000-row window, and percent-
encoded citation paths are rejected consistently at DTO creation and public
deserialization. An ephemeral HTTP fixture proved the later-rejection behavior
across claim, analysis, topics, search, old ETag, later approval, and deep-page
cases. Historical delivery receipts still do not prove that a restored runtime
has the filesystem sink mounted and reconciled; this remains a Task 23 release
gate, not a production claim.

The deterministic Task 13A whole-case scorer and release-gate evaluator now
exist in `server/evals/accuracy.js`, with an exact metadata schema and an
explicitly incomplete checked-in protocol. A 190/200 probe produced Wilson lower
bound 0.9104 and passed only when protocol/review/class-coverage flags were
present; 90/100 and duplicate-family inputs failed. No independent corpus,
labels, candidate run, or accuracy result exists, and the report remains marked
not run.

After these combined changes the backend suite passed 58/58 suites, 546 tests
passed and 1 skipped. No new unit tests, live/provider calls, production changes,
commit, or deployment occurred. The prior immutable image is stale and must be
rebuilt and reverified after the remaining implementation gates.

## Task 17 public read API implemented locally — 2026-09-30

`server/routes/public.js` and the minimal mount in `server/app.js` now expose
bounded public topic, claim, analysis, and search reads plus a session-protected
empty saved collection. A record is readable only when the active publication
head is backed by the approved allowlisted DTO and matching same-generation
installed receipts for all four private delivery targets. Current claim
restriction/supersession state and later source-access policy changes hide the
record. Public responses have stable `analysis-<versionId>` slugs, ETags, bounded
pagination, and do not expose unreviewed topic titles or legacy saved articles.

Syntax checks and the existing backend suite passed: 58 suites, 546 tests
passed, 1 skipped. Disposable schema33 HTTP probes covered private/draft hiding,
input bounds, session isolation, ETag/304, and zero SQLite writes from anonymous
public GETs. A synthetic positive fixture exercised every read endpoint, but it
constructed publication metadata in memory after disabling write guards; it
proves the read contract only, not real filesystem export or coverage
eligibility. No new tests, provider/network calls, production writes, commit, or
deployment occurred. The previously verified image and manifest predate this
API change and must be rebuilt and reverified before release. Railway remains
schema21.

## Hosted CI PID 1 gate prepared — 2026-09-30

`.github/workflows/ci.yml` now reproduces the exact-image PID 1/SIGTERM gate on
Ubuntu after building the verified bundle. It initializes a disposable UID1000
bind-mounted schema33 database, starts the image's default command with no
network/capabilities, no-new-privileges, a read-only root filesystem and tmpfs,
waits for live/ready health, asserts PID/PPID/UID/GID/capability state, sends a
15-second SIGTERM stop, requires a clean non-OOM exit, and verifies post-stop
SQLite schema/integrity/foreign keys. Cleanup is trapped by exact container name.

Ruby parsed the workflow YAML and Git Bash accepted the extracted step with
`bash -n`. The same runtime behavior passed locally against the immutable image,
but the new hosted step has not run because the workflow and broader rebuild are
still untracked/unpushed. Do not claim hosted Linux CI evidence until an
authorized commit/push produces a successful GitHub Actions run.

## Railway backup-plan constraint — 2026-09-30

The authenticated Railway Backups page states that creating backups and enabling
point-in-time recovery are available only on the Pro plan. The existing Easy News
project is on Hobby, and the owner approved reuse of that plan with a $10/month
target, not an upgrade. No Railway backup or PITR control was changed. Railway
therefore cannot satisfy Task22 backup independence/retention on the current
plan; retain the encrypted off-Railway recovery point and implement scheduled
encrypted off-host retention, portable key custody, age alerts, and fresh-host
RPO/RTO evidence separately.

## Railway volume permission inspection — 2026-09-30

A read-only Railway console inspection of active successful deployment
`10d63288-d3f0-4601-aa55-d2e7dfdd6402` found the current schema21 container
runs as root, while the data intended for the schema33 non-root image is already
partly prepared: `/data` is `0:0` mode 0755, `/data/research` is `1000:1000`
mode 0700, `/data/research/easy-news.db` is `1000:1000` mode 0600, and
`/data/originals` is `0:0` mode 0755. A read-only `su` probe as UID/GID 1000
confirmed database read/write and research-directory write access, but no write
access to `/data` or `/data/originals`. One health GET woke the idle instance;
no file, deployment, variable, database, or service configuration was changed.

The exact schema33 image can therefore access the active database after the
coordinated migration, but it cannot create a new sink at the volume root. The
publication exporter rejects a sink that contains or is contained by the DB,
archive, budget, frontend, or build path. Controlled maintenance must pre-create
a non-overlapping sibling such as `/data/publication-export`, owned by UID/GID
1000 and mode 0700, before private export is enabled. `/data/originals` also
needs deliberate UID 1000 write preparation before any archive-writing feature
is enabled. Neither directory was changed in this inspection. Export durability
on Railway remains unproven; Railway remains schema21.

## Exact-image PID 1 and disposable-volume gate — 2026-09-30

The verified schema33 runtime image
`sha256:726effb734a9247a701290ddc708340cdd83aba5cf68e4e622190383e105f25b`
with manifest
`327071bd14ba91264ef4715bb74be67a3860e183c5321ff04626d6e749cfbaad`
passed a local Docker Desktop Linux integration smoke against a disposable
named volume. A one-time isolated root helper needed only `CAP_CHOWN` to create
UID/GID 1000, mode 0700 data directories; the database initializer and runtime
then ran as the image's `node` user with all capabilities dropped,
`no-new-privileges`, a read-only root filesystem, private tmpfs, and no network.

The application command was directly `node index.js` as PID 1 (`PPid: 0`),
UID/GID 1000, effective capabilities zero, and `NoNewPrivs: 1`. Both
`/health/live` and `/health/ready` returned 200. Docker sent SIGTERM through a
15-second stop boundary; the service stopped in 211 ms with exit code 0, no OOM
kill, and no runtime error. Post-stop SQLite checks reported schema33,
`integrity_check=ok`, and zero foreign-key violations. The container and volume
were removed. No repository code, Railway state, production data, or provider
state changed.

This closes the local exact-image PID 1 behavior gate and demonstrates the
required Linux ownership pattern on a disposable Docker volume. The later
read-only Railway inspection above proves database-path compatibility but also
identifies the missing private sink/archive ownership. It does not prove private
export durability on Railway, hosted Linux CI, or production behavior.
Those checks, the release-desk UI approval, coverage/evaluation/public/E2E
work, and the coordinated backup-first migration remain open. Railway remains
schema21.

## Encrypted restore rehearsal — 2026-09-30

The new host-only `server/ops/rehearse-encrypted-restore.js` was security
reviewed and is excluded from future release bundles. It pins local Docker
Desktop to its Linux named pipe and validates resolved local files by
same-basename, trusted recovery-directory parent, requested and resolved
reparse checks, and retained file-descriptor/hash binding. The original
preflight issue was Codex AppData virtualization: filesystem resolution could
present a packaged path instead of the selected local artifact. Requiring the
resolved local same-basename file and binding its canonical parent to the
trusted recovery directory fixed that boundary.

Both synthetic and real encrypted artifact rehearsals returned strict success
in fresh containers: schema21→33, SQLite integrity and foreign-key checks true,
zero archived originals, production source preserved, private canonical
`users`, `user_roles`, `google_identities`, `auth_sessions`, and
`role_change_events` preserved with one row each, and live/ready health checks.
The real run used the encrypted artifact above (SHA-256
`771f1e9ef6491065f6acd5d65a053b8d4ec7ef7034aaecde14b5bcf3e3e02c1d`), the
verified runtime image `sha256:726effb734a9247a701290ddc708340cdd83aba5cf68e4e622190383e105f25b`,
and manifest `327071bd14ba91264ef4715bb74be67a3860e183c5321ff04626d6e749cfbaad`.
The container had no network, host mounts, Docker socket, or credentials; it
ran non-root, read-only, without capabilities, with no-new-privileges, resource
bounds, and tmpfs. Output was sanitized. Cleanup was by exact ID/name.
`service.stop` and resource limits were checked. Independent post-run checks
found zero restore containers, Docker-config temporary directories, or cipher
temporary directories. Four suites passed (37 passed, 1 skipped). Astra found
no P0–P3 findings.

This proves a fresh-container restore on this Windows host, not fresh-host key
recovery. The age identity remains DPAPI-protected for the current Windows
profile/user; immutable base64 transport, swap/dump exposure, and local Docker
trust remain in scope. `service.stop` does not prove PID 1 signal handling.
Production volume permissions/export durability, scheduled off-host retention
and alerts, measured RPO/RTO, public/E2E/coverage gates, hosted Linux CI, and the
coordinated backup-first migration remain open. UI approval is outstanding.
Railway remains schema21. No deployment or live/provider calls occurred.

## Fresh encrypted Railway recovery point — 2026-09-30

A new consistent snapshot of the active Railway database was exported from
`/data/research/easy-news.db`, encrypted on this PC, and restore-tested through
the local schema33 migrations. The deployed source was schema21; the restore
probe reached schema33 with accounts preserved, integrity and foreign-key checks
clean, and zero archived original files. Production was not migrated or
restarted.

Artifact:
`C:\Users\grifm\AppData\Local\EasyNews\recovery\easy-news-2026-09-30T00-41-28-897Z-55688e3e-df1d-48b6-bfd8-dc1697e73719.db.age`;
SHA-256 `771f1e9ef6491065f6acd5d65a053b8d4ec7ef7034aaecde14b5bcf3e3e02c1d`.
The age identity remains protected by Windows DPAPI for the current user and
depends on retaining this Windows profile. This is the current manual
pre-migration recovery point, not the missing scheduled/off-host backup system
or a fresh-host RPO/RTO rehearsal. Railway remains schema21.

## Task16 schema33 release image artifact verified — 2026-09-29

The local release bundle now includes the analysis-verification and private
publication runtime. The host orchestrator loads its trusted verifier, captures
one bounded tar archive as a `Buffer`, validates and extracts that same buffer,
then streams those exact bytes through stdin to both Docker build targets. The
`Dockerfile` is inside the archive. Both images carry the manifest digest label;
CI uses immutable image IDs. The exact tar is retained and round-trip verified.

Artifact evidence: 141 files / 912,247 bytes in the manifest, digest
`327071bd14ba91264ef4715bb74be67a3860e183c5321ff04626d6e749cfbaad`; source
tar SHA-256 `564a8ff94952b3611d84664f3c8ed3d4eb33e7e25bd177bfd070d9c35f94167b`
(1,085,440 bytes); runtime image
`sha256:726effb734a9247a701290ddc708340cdd83aba5cf68e4e622190383e105f25b`;
toolchain image
`sha256:18698ec2b02af34e663b71f7d7323495aa347741aba6b49391c78314452d4f0d`.
Parser, PDF, non-root container, native sandbox, and archive smoke checks passed.
Relevant parent tests passed 54 with 1 skipped. Astra reported no P0–P3 findings;
the original TOCTOU P2 is closed within the trusted-runner boundary.

This is a verified local artifact milestone, not a deployable release. Hosted
Linux CI has not run. Production volume ownership/permissions, actual export
durability, PID 1 behavior, backup-first schema21→33 migration, staging E2E and
recovery, and public release gates remain open. Railway remains schema21. No
deployment or live/provider calls occurred. Trust includes the CI runner, the
already-loaded helper and verifier, process memory, Docker, and tar; dependency
downloads are not attested by the source manifest. The release-desk UI still
awaits approval.

## Task16 authenticated publication editor API — 2026-09-29

Local `/api/v1/editor` now includes authenticated, CSRF-protected publication
state, review, action, and retraction endpoints. Session identity supplies the
actor; clients cannot select an actor. Review and action requests use exact
allowlisted bodies with dependency hashes, expected review/head/generation CAS
values, reasons, and idempotency keys. The owner-only retraction endpoint uses
expected generation/head-event CAS and remains callable when claim state
independently prevents preview. Responses expose only allowlisted status/event
and review metadata; reports, private evidence, request hashes, and owner lists
are not returned. Responses are private/no-store, and pre-router errors are
sanitized. Coverage still blocks actual publish. No UI, public route, or delivery
claim is added by this API milestone.

Verification: backend suite passed 58/58 suites (545 passed, 1 skipped);
disposable HTTP flows passed, and Astra final review reported no P0–P3 findings.
No deployment, live/paid calls, or production integration occurred. Railway
remains schema21; the verified image artifact and remaining release gates are
recorded in the newer checkpoint below. Next: approved bounded
release-desk UI, remaining coverage/evaluation/public/E2E gates, then deployment
only under the coordinated backup-first release process.

## Task16 private schema33 exporter milestone — 2026-09-29

Local schema version is now 33. A private filesystem exporter and durable
outbox worker are implemented with exact staging-only, default-off activation.
The worker binds the canonical database and sink root identities and takes an
exclusive sink process lock. `head.json` is O(1); generations use immutable
history and installed-generation proofs. Startup performs exact reconciliation
across receipts, artifacts, delivery tasks, and outbox state.

Publication checks enforce latest-review and final-pause fences. A stale
publication is blocked, while invalidation remains permitted. Interrupted
pending and link operations recover and replay idempotently. Linux directory
fsync failure fails closed; production Windows activation is rejected. DTO and
object prewrite happens before the final SQLite transaction, keeping large
filesystem writes outside that transaction. Coverage still blocks actual
publish. There are no public routes, public/CDN purge, real production
integration, deployment, or paid/live model calls.

Backend verification passed 58/58 suites (545 passed, 1 skipped). Focused
disposable probes covered crash recovery, tamper detection, 46 generations,
cloned-root rejection, process locking, pause/invalidation fences, and fsync
failure. Astra's final review found no P0–P3 findings. Railway remains schema21
and the image artifact checkpoint below is later evidence. Before deployment:
obtain a fresh encrypted
off-Railway backup, validate the Linux filesystem/runtime, coordinate the
backup-first migration, and complete E2E after implementation. Task16 and
production remain incomplete.

## Task16 audited publication core — 2026-09-29

Local `SCHEMA_VERSION` is now 32. Migration032 adds initially-empty audited
publication-owner capability; immutable review, snapshot, event, and dependency
records; monotonic desired-manifest heads/tombstones; immutable outbox identity;
and per-target durable delivery tasks, lease attempts, and receipts. The explicit
`provision-publication-owner` CLI can grant the capability only to an already
verified editor; there is no HTTP self-promotion. Restricting/restoring a claim or
having a source enter/leave restricted state requires the owner in the same
transaction. Any claim/source dependency change tombstones the active desired
head and queues invalidation.

A dedicated text-only DTO binds the exact draft, report, DTO, packet, context,
and access dependencies. It inventories all packet sources; private/restricted
content, unsafe URLs, HTML, and uncovered dependencies fail closed. Approval
does not clear report blockers. Real publish remains blocked because
`coverage.complete=false`; only `human_confirmation_required` is potentially
satisfiable. No public routes, export worker, startup/public activation, or live
publication exists.

Disposable probes covered schema/idempotency, owner grant/revoke/denial, exact
binding/CAS/idempotency, private/unsafe/uncited counterevidence dependencies,
coverage blocking, and synthetic atomic publish/correct/retract/outbox/
invalidation/rollback. The parent backend rerun passed 58/58 suites, 545 tests,
with 1 skipped. Astra final recheck found no P0–P3
findings. Railway remains schema21 with no schema32 image; a fresh encrypted
off-Railway backup and coordinated schema21→32 migration are required. Next:
private outbox exporter with monotonic sink fencing and purge verification,
authenticated editor routes/UI, and coverage/evaluation gates. A public API comes
only after these gates. Account-wide usage snapshot: 21% weekly used, not
task-specific. Task16 and production are incomplete.

## Task15 opt-in worker/bootstrap slice — 2026-09-29

`server/config.js`, `server/bootstrap.js`, and `.env.example` now define
`ANALYSIS_VERIFICATION_ENABLED`, strict and false by default. Enabling requires
exact `DEPLOYMENT_ENV=staging`, provider key, positive global and classification
budgets, `MAX_CONCURRENT_MODEL_CALLS=1`, token limit, and absolute fail-closed
guard validation. Analysis-only mode creates the shared guard; dispatch is
restricted to the audited durable-budgeted adapter. One serial worker uses a
30-second renewable lease. Fatal guard errors halt admission, and shutdown
aborts/drains work before DB close. No permission is auto-granted and no
automatic recovery is configured.

Disposable schema31 fake-client bootstrap probes passed authorized dispatch and
report persistence, unapproved-job exclusion, global/provider pause, pre-send
revocation, fatal errors before/after dispatch, and in-flight abort/drain with
unknown settlement. Exact 64,000-token gate and drain-before-close were confirmed.
Backend passed 58/58 suites (545 passed, 1 skipped). No live calls, deploy, or
environment mutation occurred; runtime remains off. Astra's final recheck found
no remaining P0–P3 findings and no activation regression. Provider auth/config
failures currently make analysis jobs terminal;
existing recovery covers claim jobs only. Before any opt-in, prepare isolated
staging resources and credentials and pass adversarial, accuracy, and rendered
fidelity gates. Local schema31 remains unreleased; Railway is schema21 with no
schema31 image. Task15 and production remain incomplete.

## Task15 editor route and review UI slice — 2026-09-29

Authenticated editor analysis-version, verification-job, permission, and report
routes plus the Research Desk review panel are implemented locally. Draft
versions and attached reports are integrity checked; job permission changes use
the expected permission event ID and exact admission hash as compare-and-set
preconditions. The JSON parser is narrowly capped at 300 KB and rejects
inflation. Queueing records work but grants no execution permission; no worker
bootstrap/configuration activates execution. Every editor currently has operator
authority. The panel supports editor-only grounded draft save, queueing, manual
job refresh, and distinct reasoned allow/revoke actions. It does not poll, imply a
live worker, or treat a report as truth or publication approval.

Disposable auth, parser-boundary, and integrity probes passed. Backend suite:
58/58 suites, 545 passed, 1 skipped. Frontend lint and production build passed.
Final Astra audit found no P0/P1/P2 issue. No live calls occurred. Local code is
schema31; Railway and its active database remain schema21, with no schema31
release image. Task15 and production are incomplete. Remaining gates: deliberate
opt-in worker/bootstrap/config activation; adversarial, accuracy, and rendered
fidelity evaluation; a fresh encrypted off-Railway backup followed by coordinated
schema21→31 migration and release; staging end-to-end/editor-browser review; and
the public and publication gates. The current account-wide usage snapshot was
8% weekly used; this is not task-specific consumption.

## Task15 durable-budgeted Jev assertion adapter — 2026-09-29

Added `server/analysis/jev-adapter.js`. It reuses `runJevCall` and the existing
immutable reservation, settlement, concurrency-slot, and audit ledger. It
strictly validates pinned model/policy, input hash, request identity, and fully
preflights evidence before transport. Each cited or counterevidence passage
gets one bounded `passage-v1` call; aggregation precedence is
contradiction > supports > mentions_only > insufficient, and output contains
only matching passage IDs. Request keys are deterministic per passage; exact-key
cached crash replay is allowed. Unknown/missing settlement blocks without a
second transport. A retry suffix is used only after allowlisted failure and
explicit `not_billed` reconciliation, bounded to three attempts. The actual
`preDispatch` fence runs inside the send transaction. A 30-second renewable
lease uses `leaseGuard` for new and cached paths. Typed budget/reconciliation
controls do not persist incomplete reports.

Security re-review found no P1/P2 findings in this slice. Disposable probes
covered two-passage aggregation, preflight, billed/cached replay, unknown hold
and `not_billed` retry, pause/revocation fencing, expired-lease takeover and
stale-token rejection, an accepted-extraction end-to-end `semantic_candidate`
report, and cached-path lease renewal. Final backend verification passed 58/58
suites (545 passed, 1 skipped); syntax checks passed. No live calls occurred.
No startup, route, configuration, or deployment change was made.
Railway remains schema21; no schema31 image exists.

This supersedes the prior schema31 checkpoint's lease-through-deadline warning:
the worker now uses a short renewable lease and safe cached/pending takeover.
Task15 remains in progress. Next add authenticated editor queue/report routes
and review UI, then deliberately gated bootstrap/config activation and final live
sandbox authorization/evaluation. Broader adversarial and fidelity gates remain.

## Prior Task15 durable verification job scaffold — 2026-09-29

Local schema31 adds durable analysis-verification jobs and append-only editor
permission events. Job admission binds the immutable draft SHA-256, packet
version, pinned policy version, and pinned decision model using
`SHA256(JSON.stringify([draft_sha256, packet_version, policy_version,
decision_model]))`. Current editor role is checked when permission is granted and
again before every adapter call; revocation is recorded as a new event. Global
admission pause, provider pause, lease ownership, task deadline, permission, and
trusted current packet/version are fenced before each adapter call. Each
assertion receives deterministic request key
`analysis-verification-job:<jobId>:input:<inputHash>`. The final immutable
verification report and job completion are committed atomically with database
binding to the source analysis version.

Global admission status now includes `analysisVerification` active-lease and
backlog counts. Raw transports are rejected unless an adapter explicitly
declares `durable-budgeted-v1`. Disposable probes covered authenticated versus
unauthenticated access, role revocation, global/provider pause, stale context,
lease fencing, idempotency, raw-adapter rejection, and cross-version report
binding. Backend verification passed 58/58 suites (545 passed, 1 skipped);
frontend lint and build passed. Railway remains schema21; there is no schema31
image, and no live calls or deployment occurred. No bootstrap, route, or configuration
activates this worker.

This checkpoint's lease-through-task-deadline behavior and adapter gap were
superseded by the durable-budgeted Jev adapter checkpoint above. Task15 remains
in progress; authenticated editor routes/UI and deliberate activation gates are
still outstanding.

## Task15 mechanical assertion inventory — 2026-09-27

Task14 drafts now return explicit claim-context, packet, model, and prompt
provenance. New `server/analysis/coverage.js` independently segments every
non-limitation block into bounded sentences, binds each sentence to packet
passages, revalidates the packet/draft boundary, records unmapped or unknown
passages and unaccepted extraction, and produces a deterministic checked-version
hash. It always retains `semantic_review_required`; incomplete coverage and
counterevidence remain blocking rather than being inferred away. A real
schema29 packet/draft probe enumerated and mapped 2/2 sentences while preserving
coverage, extraction, and semantic-review blockers. Syntax and whitespace checks
passed. New `server/analysis/verify.js` adds a bounded injected decision-adapter
stage: it refuses model dispatch when cited or counterevidence extraction is not
accepted, supplies every assertion's cited evidence plus all counterevidence,
requires exact model/policy/input-hash echoes, and never lets a model decision
clear mechanical blockers. Results remain `semantic_candidate`, always require
human confirmation, and explicitly flag human/model disagreement. A schema29
fake-adapter probe covered the hard block, two sentence decisions, malformed
decision rejection, and the human-confirmation/disagreement policy. Draft
citations now carry bounded exact UTF-16 quote spans verified against stored
passage text. The assertion inventory recognizes straight, curly, guillemet,
bounded single-quoted, and Markdown-block quotations; missing or malformed spans
block before semantic dispatch. Real packet probes covered exact, missing, and
malformed spans, and a focused detector probe passed 5/5. At this initial
scaffold checkpoint, live Jev admission, PDF page-map/rendered-fidelity checks,
prompt-injection fixtures, persistence, and changed-block rechecks remained
unimplemented. Current persistence/queue status and remaining adapter gates are
recorded in the schema31 checkpoint above. At this initial checkpoint, evidence
packets exposed accepted-extraction summaries but not trusted PDF page/box
projections. Until the projection was added, quotations tied to Poppler
extraction emitted `pdf_page_map_required` and could not reach semantic
dispatch. The focused PDF/runtime detector probe passed 4/4 (Poppler, HTML,
empty inventory, and absent passage). No live call, paid usage, DB persistence,
or deployment occurred. Decision-adapter requests now separate immutable
assertion-relation instructions from an `untrustedEvidence` envelope containing
all assertion, claim, passage, metadata, and assessment content; both are bound
by the required input hash. The focused guard probe passed. Live adversarial Jev
evaluation remains pending and this structure is not a prompt-injection quality
claim. The verifier now accepts only exact `jev-1.13.0` and
`assertion-review-v1` pins; a focused probe rejected mutable model and policy
aliases 2/2.
Adapter failure now stops the sequential assertion loop after the first failed
decision and returns an incomplete blocking report; it cannot fan an outage out
over the remaining sentence inventory. An optional validated AbortSignal is
checked before work, between sentences, and passed to the adapter; cancellation
also stops the loop and remains blocking. The focused cancellation probe passed
2/2. Typed worker-control failures (pause, budget guard, permission, lease,
deadline, cancellation/timeout, and provider recovery classes) are rethrown
unchanged; the verifier does not flatten them into content-review failures.
The verifier also accepts an optional absolute `deadlineAt` and injected clock,
rejects invalid deadline/clock inputs, and fails with `deadline_expired` before
inventory construction or adapter dispatch when the deadline has elapsed. A
focused probe confirmed expiry and both invalid-input cases; `node --check`
passed. This is caller-supplied deadline enforcement, not a durable job deadline.

Evidence packets now project a bounded trusted PDF locator from the latest
accepted Poppler extraction whose text hash matches the immutable document.
The projection contains only the passage-overlapping page ranges, allowlisted
word boxes, render hashes/dimensions and extraction hashes; private object keys
are excluded. It binds the exact passage text, uses UTF-16 offsets, derives the
canonical `page N` / `pages N-M` locator, and requires the stored passage locator
to match. Missing, stale, malformed, relabeled or false-locator PDF maps remain
`pdf_page_map_required` hard blockers. Interval validation is merged and cached
per passage/span. `verifyCurrentAnalysis` rebuilds the evidence packet from the
current database immediately before verification and rejects a stale draft
before adapter dispatch; the packet-only function remains the offline contract.

Fresh verification: actual disposable schema29 projection resolved one page and
three word boxes with no private keys; false locator, removed box, text tamper,
duplicate page and stale-draft probes all blocked. `node --check` passed for the
three affected modules; affected existing suites passed 28/28; the full backend
suite passed 58/58 suites, 545 tests with one optional skip. A scoped Sol review
found three Important and one Minor issue; the fix pass addressed locator
validation, CPU bounds/caching, trusted DB rebuilding, and allowlisted fields.
No live model/provider call, persistence of verification results, production DB
mutation or deployment occurred. Task15 still requires wired durable admission,
rendered-original fidelity evaluation, adversarial Jev evaluation, persistence,
and changed-block rechecks.

`planChangedBlockRecheck` now gives revisions deterministic draft, block and
assertion identities. A uniquely matching unchanged block is paired to its
earlier block while an edited/ambiguous block is scheduled for recheck. Any
packet, claim-context, model, prompt, citation, assertion list, uncertainty,
chronology or summary change fails closed to a full-block recheck. The plan
retains previous/current draft hashes and checked-version hashes so future
persistence cannot silently attach an old result to a new draft. A disposable
schema29 probe identified one changed block while retaining one unchanged pair,
then forced all blocks for citation and packet changes. This is recheck planning,
not semantic-result reuse or durable persistence; those remain open.

The schema30 slice added immutable `analysis_versions` and
`analysis_verification_reports`. `saveAnalysisVersion` accepts only an editor,
rebuilds and validates the current trusted packet/draft boundary, binds the
current claim context, and saves a content-addressed draft idempotently.
`verifyAndRecordAnalysis` verifies through the trusted current-packet boundary,
then rebuilds the packet again inside the final write transaction; evidence or
draft drift discards the report. Stored draft/report hashes are checked on load,
claim/context ownership is enforced in SQLite, and both tables reject update or
delete. A disposable schema30 probe confirmed idempotent save, mechanically
blocked persistence with zero adapter calls, and immutability. Full backend
verification passed 58/58 suites, 545 tests with one optional skip. Railway
remains schema21; there is no schema30 image or production migration. Focused
recovery fixtures passed 3/3. This persistence milestone is superseded by the
schema31 durable verification queue checkpoint above.

## Private candidate-registry validator — 2026-09-27

`server/evals/validate-candidates.js` and `npm run validate-candidates --
<absolute-registry-path>` now fail closed on non-absolute, missing, symlinked,
oversized, malformed, or structurally invalid private candidate metadata. The
validator checks source/claim identities and references, mandatory
not-ground-truth/not-for-publication/double-review restrictions, snapshot path
containment, snapshot SHA-256, source/URL/retrieval-time binding, and the
source-text inventory. Its output contains only hashes/counts/restrictions, not
source text. The current private registry passed with SHA256
`168c9e0acecfc1c18951d601e7f5c0d45819dc27f7fd621148ae0b1ac617d21c`, 6 sources,
8 claims, and 1 partial snapshot. Syntax, package JSON, relative/missing/extra
argument probes, and whitespace checks passed. No new unit tests were written.
This validates candidate integrity only; it does not review labels, establish
ground truth, or make the checked-in pilot corpus ready.

## Task14 offline grounded-contract slice — 2026-09-27

New files: `server/models/writer.js`, `server/models/reviewer.js`, and
`server/analysis/draft.js`. The contract accepts a provider-neutral injected
`complete(request)`; no writer model is selected or defaulted. It enforces
packet-v2 digest, shape, and context binding; citations come only from the
packet; counterevidence is derived; and access, extraction, and assessment are
validated. Incomplete coverage yields no supported assertions. Qualification
is deterministic `editor_only_unresolved` with `findingEstablished=false`,
`publicationAllowed=false`, and `requiresHumanReview=true`. Revision is capped
at one. There is no persistence, route, or live transport.

Verification: `node --check` on all three files; implementer disposable
fake-client probes covered malformed/tampered packets, restricted content,
hidden counterevidence, and the revision cap. Parent real schema29 packet probe
passed a valid packet and rejected tampering. Scoped Sol review found three
Important and one Minor items; a fix round addressed all within slice and final
re-review was clean. Tracked/new-file whitespace checks passed. No provider or
model call, paid usage, DB persistence, or deployment occurred. Task14 is not
complete. Remaining blockers: real Task13 benchmark and model selection;
writer price/budget/permission/admission transport; rebuilding and comparing
the current packet from trusted DB immediately before provider admission;
Task15 sentence verification; and persistence/editor publication work in
Tasks16+.

## Task14 legacy-generator safety slice — 2026-09-27

`server/generate.js` is import-inert and fails closed unless
`LEGACY_GENERATION_ENABLED=true`, `GENERATION_ENABLED=true`, a nonblank
`OPENAI_API_KEY`, and an absolute `DB_PATH` are all present. The database closes
in `finally`; the package command is `generate:legacy`. README labels this
recovery-only and not grounded or publication-compliant. Verification recorded:
`node --check`, import-inert probe, disabled CLI exit 1, `legacyConfig` 4/4,
package script inspection, diff check, and the existing backend suite (58/58
suites; 545 passed, 1 optional skip). No provider call, DB mutation, paid usage,
or deployment occurred. Task14 remains blocked on the real benchmark, model
selection, and grounded writer pipeline.

## Private pilot candidate registry — 2026-09-27

An offline private candidate registry is stored at
`%LOCALAPPDATA%\EasyNews\pilot\tranche-001\candidate-registry.json`
(current SHA256 `168c9e0acecfc1c18951d601e7f5c0d45819dc27f7fd621148ae0b1ac617d21c`).
It contains metadata for 6 official source candidates and 8 unreviewed
candidate claims. One source now has four unreviewed relevant excerpts in
`src-sdny-maxwell-case-page.partial.json` (SHA256
`49cd866b81b923df20777879aa94600ceb773a4982abd61b4b47df38ba8cf32c`).
This is a partial capture, not a complete page snapshot, and it does not
establish the conviction, sentence, or appellate-affirmance portion of the
candidate claim. Independent double review and the other source snapshots
remain pending. The registry is not ground truth, is not a
checked-in manifest, and makes no quality or publication claim. The checked-in
`research/pilot/manifest.json` was not changed. Retrieval limitations: the
Maxwell page was partially captured; the OIG PDF requires sealed PDF intake; FBI Vault
returned 403; a second bounded SDNY press-release fetch returned empty and is
now recorded as blocked pending a permitted alternate path. No paid/live model
calls or production mutations occurred.

## Prior local milestone — Task15 persistence and Task22 work admission

Local runtime now requires schema31; Railway runtime and active database remain
schema21. No schema31 release image exists. Migration 029 adds a durable global
admission state and append-only audited transitions; migrations 030–031 add
immutable analysis versions/reports and the verification-job scaffold.
Authenticated editors can
read status and pause/resume admission; actor identity comes from the session.
Transitions use exact version compare-and-set inside an immediate transaction,
idempotent request IDs, and conflict responses for stale state or reused IDs
with different payloads. All editors currently have this operator authority.

Pause blocks new dispatch. It does not cancel work already in flight. Claims,
fetches, and rebuilds have lease fences, with short immediate transactions at
the final pre-send boundary; analysis-verification workers also fence job lease,
pause, permission, context, and deadline before adapter calls. Global status now
includes analysis-verification active leases and backlog. Pre-send denials
settle as `not_billed`. For eligible claim jobs, pause/resume credits the baseline deadline interval while
preserving the existing task deadline and retry/backoff eligibility; it does
not extend work already dispatched. Status uses bounded indexed counts and a
read-only budget-guard peek. It explicitly reports backup age as unknown.
`WorkAdmissionPanel` is integrated in the editor budget panel.

Verification: backend 545 passed/1 optional skip; disposable cross-process
probes passed. Scoped Astra review passed after three fix rounds. Frontend
18/18 relevant tests, lint, public-config check and build passed; independent
Luna review passed. No deployment or production database change occurred.
Task22 operational recovery gates remain open: independent scheduled encrypted
backups; 7 daily/4 weekly retention; portable key custody; delivered alerts;
fresh-host restore with measured RPO/RTO; originals backup/reconciliation; and
Task16 publication/outbox/invalidation restore checks. The encrypted Sep23
artifact is historical and is not a current recovery point. See
[operations](OPERATIONS.md), [deployment runbook](DEPLOYMENT_RUNBOOK.md), and
[Task22 worklog](AGENT_WORKLOG.md#2026-09-27--task22-durable-work-admission).
Any release requires a fresh matching image, coordinated backup-first
schema21→31 migration, and a rollback image compatible with the retained backup.

Older checkpoints below are chronological records and are superseded where
their schema or release status conflicts with this latest checkpoint.

---

## Superseded checkpoint — 2026-09-26

## Latest local milestone — Task13 evaluator and Task12 provider recovery UI

`server/evals/run.js` and `server/evals/metrics.js` implement the v2 offline,
fail-closed evaluator. Retrieval queries and classification cases are separate
stages; each claim/query contributes at most one ranked result from the top 30.
The retrieval snapshot digest binds the corpus, documents, passages, retrieval
configuration and evidence cutoff. Inputs are deeply copied and frozen before
callbacks or awaits. Evaluation accepts only the exact current Jev model pin and
hash; mutable aliases are rejected. Manifest validation checks family, source
chain and passage-hash leakage. Reports include classification/retrieval
metrics, usage, review time, and deterministic report hashes. Missing results,
errors, and abstentions fail closed.

The checked-in pilot manifest is intentionally incomplete and empty: zero claims,
documents, retrieval pairs and classification cases. It makes no quality claim.
A real 50-case development corpus, 100–200 held-out cases and a separate
>=300-case publication corpus, double review, and paid evaluation remain absent.
Task14 writer selection is blocked until a real development benchmark passes;
the evaluator scaffold does not satisfy Task13's evidence gate. Full backend
verification passed (545 passed, 1 optional skip); disposable adversarial probes
passed, and scoped Astra review passed after two rounds. No live provider calls
were made.

Task12 provider recovery UI is integrated into BudgetPanel. It uses exact pause
compare-and-set, an audited operator reason and idempotent continuation in pages
of at most 100 jobs. Frontend
verification passed: 18/18 relevant tests, lint, public-config check and build;
independent Luna review passed. Classification remains disabled with zero
budgets. Two polish observations remain: success wording when a cursor is
invalid, and clearer retry guidance after HTTP 409.

Release boundary is unchanged: local schema28, Railway runtime/database schema21,
no schema28 release image, no migration or rollback rehearsal for this release.
Use the coordinated backup-first procedure below before any restoration or
deployment. See [the worklog](AGENT_WORKLOG.md#2026-09-26--task13-offline-evaluator-and-task12-provider-recovery-ui)
and [model architecture](MODEL_ARCHITECTURE.md#offline-evaluation-and-gates).

LATEST TASK12 CLAIM-JOB RECOVERY MILESTONE (local only; supersedes Task11 and
earlier schema checkpoints): local runtime requires schema28; Railway runtime
and active database remain schema21. Migration028 consolidates claim-job recovery
state and audit. Jobs use the `passage-evaluation-v1` stage, finite five-minute
deadlines and fenced lease renewal. Review events are append-only. Authenticated
editor recovery checks session and CSRF, exact pause-version compare-and-set,
hashed request IDs, eligibility, current permission and unresolved holds; batches
continue in bounded pages of at most 100 jobs. Provider success is committed
atomically after the network call, and a saved split result replays without a
second provider call. A partial-recovery index and planner evidence support
bounded recovery queries. Missing provider key remains fail-closed at startup;
an invalid key discovered at runtime durably pauses the queue. Classification
and default paid flags remain off with zero budgets. Paid operation still requires
a private shared persistent `BUDGET_FAIL_CLOSED_PATH`.

Verification: backend suite 545 passed/1 optional skip; disposable probes covered
13 scenarios and 6,200 jobs. Scoped Astra specification/security review passed.
There are no retained schema28 DB files in this workspace; earlier schema28
probes were disposable. Production remains schema21. Any separately retained
database made from an older draft of migration028 must be recreated or explicitly
migrated; do not assume it was repaired. No schema28 release image, provider/live
calls, production DB changes, deployment, or E2E completion are claimed. Release
requires a fresh matching image, coordinated backup-first schema21→28 migration,
and matching rollback image and backup. Frontend provider-recovery UI remains a
prerequisite to enabling classification, but does not block deployment while the
backend remains disabled.

LATEST TASK09 RETRIEVAL MILESTONE (local only): runtime now requires schema25;
Railway runtime/database remain schema21. Deterministic `retrieveCandidates`
search and authenticated editor retrieval-run POST are implemented. Runs bind
to current claim context and immutably record actor, request, variants and
results; exact retries return the saved run, while conflicting retries return
409. Retrieval uses bounded raw and NFKC-normalized FTS tiers, applies policy
and topic filters before limits, groups audited source chains before the pool
cap, and stores exact-or-null provenance. Passage normalization is 1:1 with
bounded byte metadata. Quote/source/response budgets are checked before
hydration; cutoffs, gaps and history scope are explicit. The editor presents
variants, results, provenance, neighboring context, audit and coverage. There
are no network, embedding or model calls.

Verification: backend full suite 545 passed/1 optional skip; frontend
ResearchDesk18/18, lint, public-config check and build passed. Disposable
RED→GREEN probes covered starvation, Unicode, chain suppression, provenance,
raw UDF runtime/recovery, resource budgets, HTTP, backup-first24→25, integrity
and rollback. Independent Sol/Luna reviews closed all Critical/Important
findings. No recall result is claimed: a frozen independently labeled corpus,
measured macro recall@30 and critical-counterevidence results remain open.
Evidence-time cutoff and browser/E2E review remain open. Per-index2048,
discovery32768 and pool1000 bounds plus byte cutoffs mean completeness is not
verified. Deferred Task08 minor work remains per-claim aggregate manual-ledger
budget; Task09 UI controls were addressed. No production DB, deployment, DNS or
model calls changed. Local Task09 has no release image: the schema23 candidate
image named below is stale and must not be deployed. Any release requires a
fresh image and coordinated backup-first schema21→25 migration.

SUPERSEDED TASK08 CLAIM-RESEARCH MILESTONE (local only): runtime then required
schema24; Railway runtime/database remain schema21. Claim proposals are atomic,
require explicit context qualifiers, preserve original wording separately from
normalized wording, and attribute actors from the authenticated session.
Identical retries return the original proposal; conflicting retries return409.
Append-only source chains, context-bound `component_of` relationships, append-only
relationship revoke/correct history, recorded search outcomes, six-dimension
context-bound coverage, stale coverage projections, evidence-packet gap reporting,
and the accessible editor flow are implemented. None of these records establish
claim truth or publication approval.

Verification: backend58 suites/545 passed/1 optional skip; affected proposal
checks51/51 and schema24 focused fixes70/70. Frontend ResearchDesk18/18, lint,
public-config check, build, and diff checks passed. Disposable probes covered
populated backup-first21→24 migration, stale context, revoke/correct/rollback,
idempotency, actor spoofing, HTTP bypass, packet/FK/integrity. Independent Sol
reviews found and fixed all Critical/Important issues; none remain open. Deferred
minor work: per-claim aggregate search/coverage storage and query budget, and
explicit44px minimum heights for text/date/select controls. No production DB,
deployment, DNS or model calls changed at the Task08 boundary. Browser/E2E and a
fresh schema24 release image were then open. The prior schema23 candidate image
`sha256:fdfd0008f534822d67cf2f275630cd6f028e650a8a5dee59c7ac01428f3daa0d` is
stale and must not be deployed. That checkpoint required a fresh candidate and
coordinated backup-first migration through24; Task09 now requires through25.

SUPERSEDED TASK08 SOURCE-CHAIN SLICE (local only): schema23 adds immutable,
actor-attributed document-parent provenance with database cycle rejection. The
editor document view records/displays audited ancestry; evidence packets include
a conservative deduplication projection while source independence remains
explicitly unverified. Component-wide admission caps nodes, links and reason
bytes inside the immediate write transaction; response construction also occurs
before commit. Packet projection omits repeated audit text and caps aggregate
references. A disposable RED→GREEN overflow probe proved the rejected edge rolls
back and leaves the graph readable; ordinary ancestry/cycle/immutability/packet
integrity passed. Backup-first populated schema21→23 preserved claims/documents,
left the backup at21 and passed integrity/FKs. Existing affected backend55/55 and
frontend16/16 passed; frontend lint/build passed. Astra closed both Important
resource/atomicity findings for service-written graphs. No production DB,
deployment, flags or external service changed.

LATEST TASK07 FIDELITY EVIDENCE (local disposable corpus): the exact candidate
image passed native multicolumn, table, footnote and redaction fixtures plus an
image-only OCR fixture. Extracted names, dates and amounts matched the rendered
originals; exact stored comparison PNGs were visually inspected for all five
layouts. Every result remained `requiresReview`; OCR was marked derived and
English-only, and the redacted fixture exposed no hidden numeric value. Encrypted
and corrupt PDFs rejected, a live abort cancelled an 80-page extraction, an
option-like/shell-looking filename was treated only as bytes, embedded PDF
JavaScript did not execute, and private scratch returned empty. The disposable
evidence and renders are retained at
`C:\Users\grifm\AppData\Local\Temp\easy-pdf-fidelity-20260926`; no repository
test, dependency, production data or external state was added. Actual editor
browser review, multilingual/real-world corpus evaluation, hosted CI, migration
and deployment remain open.

SUPERSEDED RELEASE-CANDIDATE EVIDENCE (local only; stale schema23 image, do not deploy): the staged production image
contains both verified HTML and PDF/OCR runtimes, but nothing was deployed or
enabled. Schema23 staged source manifest
`5ec49484cf30976d3577b8baea400613f420d9de7f65fc273d4dcc246766147f`
(108 files); deterministic `pdf-ocr-v1` bundle is 97 files, digest
`16339c525fab762d5049f2a70b64c2bb08a99a09fbf2562536ca6b43bb2f2932`;
candidate image is
`sha256:fdfd0008f534822d67cf2f275630cd6f028e650a8a5dee59c7ac01428f3daa0d`,
default user `node`. The image passed HTML and PDF startup gates plus real
HTML HTTP intake/shutdown, source-chain bounds/integrity and the full disposable
PDF corpus as UID1000 with no network/capabilities.
The sandbox now denies queued cross-process signals and filesystem metadata
mutation. Production bundles compile with read-only scratch, enabled by a sealed
manifest-covered Fontconfig cache; direct scratch creation was denied. Existing
native checks passed14/14 applicable (1 optional skip), full backend checks
545/545 with1 optional skip, frontend affected16/16, lint/build, actionlint and a
clean same-path bundle reproducibility check passed.
A focused Astra security re-review closed the two P1s and scratch-exhaustion P2
for this exact image; builds without `PARSER_SANDBOX_READONLY_SCRATCH` are not
approved. PDF/HTML flags remain false. Hosted CI, production-host enforcement,
editor browser review, schema23 backup-first migration and
deployment remain open.

LATEST: Local PDF OCR fallback is now wired end-to-end but is not deployed.
`extract-pdf.js` uses native text first, then the sealed English Tesseract path
only for zero-native-word pages. It records native/OCR span and per-page
provenance, low-confidence counts, unresolved OCR pages, mandatory review and a
new extractor version; the editor distinguishes OCR-derived from unreadable
pages. A real image-only PDF in the UID1000/network-none sandbox recovered the
exact synthetic sentence and amount as four OCR spans, retained the 1600px
review render and cleaned scratch. A blank scan remained explicitly unresolved.
Bundle remains `pdf-ocr-v1`, 95 files, digest
`322b37fd363a5a18efb269c7c8e84f48eed0437fc616f01ace3e42788912b59e`.
Existing affected regressions passed: backend 50/50, frontend 12/12; lint and
production build passed. No new unit/E2E tests, production migration, deploy or
feature enablement. Next Task07 work is broader document fidelity/adversarial
evidence and browser review before any schema22 backup-first release candidate.

HISTORICAL CHECKPOINT (superseded by the Task08 schema24 checkpoint above): at
that time, local app required schema23; deployed app/active DB remain schema21.
Migration022 adds immutable extraction_renders linked to extraction/page, with
PNG hash/key/size/dimensions/version; no production migration performed. Do not
deploy local code against21 without a fresh coordinated backup-first migration
through23. Migration023 adds immutable audited source-chain links. Current local
runtime has since advanced to schema24; do not use this checkpoint for release.
Existing four migration/storage suites27 checks passed after maintaining version
expectations and the legacy16 fixture's table teardown (no new test cases).
Next: derived-render persistence and authorized PDF intake. PDF gates remain off.

## Latest checkpoint — release pipeline, local only

Owner directs no new unit tests and E2E authoring only after implementation.
Existing tests remain; builds/static checks/integration verification continue.
`.github/workflows/ci.yml` now exists locally: pinned actions/Node, locked installs,
dependency checks, existing regressions, frontend build, verified source bundle,
isolated Docker smoke and short-lived image/source evidence. No production secrets
or deployment steps. Not committed, pushed or run on GitHub; task21 is incomplete.
On Sep26 a clean Linux UID1000 rehearsal passed locked backend/frontend installs,
public-config check, ESLint and frontend build, then produced the same 93-file
release manifest `67b1b25435206a97ceb92fc71e46ee65e232c1036ae44927c919e488f0427f68`.
Actionlint passed earlier Sep26. See runbook for scope and remaining CI gaps.
Pinned Gitleaks8.24.3 now gates source/history and generated backend/browser
artifacts; redaction100%, inline suppressions ignored. Local 44-commit history,
clean CI input snapshot, retained backend bundle and current browser build scans
reported no leaks. Updated workflow passes actionlint. This is pattern-based
detection, not proof all credentials are absent; hosted whole-checkout scan pending.
No production changes this turn; Sep23 live evidence below is historical, not a
fresh health check. Next: full hosted CI and tested-artifact
promotion; continue PDF/OCR, archives, writing/publication and accuracy gates.
The full objective remains active. Older chronological entries below are superseded
by this checkpoint and the successful cutover, not instructions to repeat cutover.
GitHub metadata checked Sep26: origin grifmang/-theeasy.news is PUBLIC, main default,
Actions enabled. Asked owner before publishing local changes; approval pending.
Existing native sandbox checks added to CI; local compiler-container run passed14,
skipped1 optional Node-archive case. Actionlint passed after wiring. No new tests.
Task07 resumed: exact PDF integration constraints and implementation sequence in
`PDF_IMPLEMENTATION_NOTES.md`. Existing extractor fatally UTF-8 decodes all bytes;
HTML runner/bundle cannot simply be reused for PDF output/dependencies. Official
Poppler interface evaluated; no PDF support/dependency/activation implemented yet.
Disposable PDF probe confirms sandboxed metadata/native text run, but rendering
reports missing font/config despite exit0. Do not claim rendering passed. Exact
image/path/evidence in PDF_IMPLEMENTATION_NOTES.md; next package restricted fonts
and verify visible output. Application and production remain unchanged.
Follow-up supersedes missing-font blocker: restricted packaged font/config plus
in-sandbox compiled renderer wrapper now produces a visibly correct synthetic
page, all three tools exit0/no diagnostics. Details and image digest in PDF notes.
Still a disposable probe, not application PDF support; broader fidelity unproven.
Application now contains internal `server/evidence/pdf-process.js`: fixed binary
operations, bounded bytes/output/time, private diagnostics, abort-to-close fence.
Actual sandbox probe through this adapter passed metadata/text/render; node syntax
check passed. It is NOT API-wired or bundle-trust validation. Next verify failure
lifecycle, implement sealed PDF packaging/page maps and review-required intake.
Failure lifecycle now verified with real sandbox processes: corrupt/missing
launcher/cancel/5s timeout/8MiB overflow reject with no children at settlement;
success paths pass afterward. No new repository tests. Next: sealed PDF packaging,
page maps/encryption/document caps, service admission and review-required intake.
Internal `pdf-page.mjs` now maps a single Poppler bbox page to immutable text,
UTF16 word spans and top-left PDF-point boxes. Real saved Poppler output mapped
the synthetic sentence/amount exactly (4 words,612x792 page). Initial HTML5 parser
rejected Poppler's obsolete XHTML doctype; only that diagnostic is now tolerated.
All output remains review-required; blank native pages request OCR. Not API-wired
or yet packaged inside sandbox worker; production PDF support remains incomplete.
Mapping worker now implemented (`pdf-map-worker.mjs`) and actually ran through
native sandbox with read-only probe mounts; exact sentence/4words/page1 verified.
This does not establish bundle integrity: new files are outside the old HTML
manifest. Next distinct PDF bundle/manifest and verified service integration.
Separate PDF builder now implemented and exercised: build-pdf-bundle.js plus
native/pdf-render.c,89-file inventory verified/sealed in disposable Linux root
build. Digest/details in PDF notes. No retained candidate or runtime activation
validator yet; production Dockerfile unchanged. Next PDF-specific trust/preflight.
PDF startup gate (`pdf-runtime.js`) now implemented and actually passed UID1000
in rebuilt disposable bundle: ownership/capability/digest checks plus native
metadata/text/mapping/render and empty scratch afterward. Production not enabled.
Next negative trust cases, encryption/document caps, service admission/intake;
retain/review a candidate image before deployment. Details in PDF notes.
`extract-pdf.js` now implements bounded whole-document native extraction using
only branded startup-verified runtime objects: page maps/word boxes/rendered
bytes+hashes, mandatory review and explicit OCR-needed pages. Real UID1000
single-page integration passed exact text/4words/1render/clean scratch. Encryption
and aggregate limits need negative-case verification; service/persistence/API/UI
and actual OCR remain unfinished. All current production flags unchanged.
Internal PDF service admission now implemented and sandbox-verified:1active/noqueue,
busy rejection, cancel/drain on stop, post-stop refusal, scratch cleanup. Receipt
authorization/persistence/bootstrap/API still not wired. Storage needs derived
render provenance (not document originals), requiring an explicit migration.
Internal receipt persistence now implemented/verified with real sandbox+schema22:
binary PDF dispatch, schema2 manifest and derived render records, repeated intake
idempotent (1document/1extraction/1original/1render), stored image hash verified.
Existing text/HTML checks30 pass. Next full intake admission, bootstrap/API/render
retrieval/UI; scanned-only OCR still missing. No remote changes. See PDF notes.
Full receipt admission now verified: pdf-service.extractReceipt holds the slot
through persistence, shares admission with byte parsing, and rejects overlapping
receipt requests. Actual sandbox/schema22 probe passed busy rejection and repeated
idempotent intake. Next bootstrap/API/private render retrieval/UI; not deployed.
PDF bootstrap/API/private PNG retrieval now wired behind default-off PDF flag.
Actual nonroot Linux HTTP integration passed anonymous401 for intake/render,
session-derived actor despite spoof body, repeated201/idempotency and exact private
PNG bytes/headers. Existing config/bootstrap/editor suites65 pass. HTTP source
bundle digest ff02fdf3409fce5ce38f5829dcbb08f10e7e19d22e823710f3abc41d30c6bd1a
retained in probe/http-source. Next editor UI/OCR/negative guards/fidelity and
release-image packaging; no live deployment or schema migration performed.
PDF editor UI now exposes available PDF extraction and page-by-page comparison:
private image, read-only selectable text, page selector, OCR/load warnings and
original download. Uses existing desk styling; mobile stacks panes. Build+lint
passed; existing review/intake UI checks12 pass. New comparison view not yet
browser-verified; no new unit/E2E tests. PDF/OCR/fidelity/release gates still open.
Full backend regression ran:57 suites passed,1 failed solely on old schema21
expectation in encrypted-backup test. Updated existing expectation to22; focused
backup suite2 checks then passed. No new test cases; whole suite not rerun after
that expectation-only edit. Local OCR probe (Tesseract5.3.0-2/eng1:4.1.0-2) ran
inside sandbox and recovered exact synthetic text/amount, no diagnostics. Details
in PDF notes; OCR application integration and real-scan quality still unfinished.
OCR TSV mapper/isolated worker now implemented and exercised on actual sandboxed
Tesseract output:4 words/exact sample amount, page coordinates/confidence retained,
explicit English OCR provenance and required review. Not yet sealed/in fallback.
Next high-res raster + OCR package/runtime + document fallback, then fidelity.

Read this before broad repository exploration. Full objective remains the whole
production plan, not merely a running research workspace. On 2026-09-22 the
usage window had reset; latest check: 78% consumed, 22% remaining. Continue conserving context and avoid
repeated polling; the prior 98–99% readings are historical.

## Verified deployment

Latest local release-hardening progress (no new live deployment):
ops/stage-release.js creates explicit source-only server/ bundle plus deterministic
SHA256 manifest; verify rejects missing/altered/extra/linked files. Required
prices.json, MJS worker/native source included. Backend545passed/58suites,1Windows
skip. Linux UID1000 check with umask077 reproduced permissions issue then passed
after explicit source644/dirs755 fix. Real generated-bundle Docker smoke passed.
Retained bundle+manifest/image hashes and commands in DEPLOYMENT_RUNBOOK.md.
CI workflow now exists locally (see newest checkpoint); no commit/push. Tool does not deploy, migrate, or callmodels.

SUCCESSFUL CUTOVER (2026-09-23 UTC), supersedes in-flight notes below:
Railway10d63288-d3f0-4601-aa55-d2e7dfdd6402 SUCCESS/RUNNING, image
sha256:f27bd88b6436361c79029618892da065957db7a586d70f13855493de1f233e73,
DOCKERFILE ops/Dockerfile.railway, Node22.23.1. Public health ready. Main PID1 is
UID/GID1000, effective/permitted capabilities0. SSH defaults root; run parser
preflight in a spawned uid/gid1000 child, not directly in root SSH. Real Railway
parser preflight passed. All processing flagsfalse, budgets0; no HTML activation.
Netlify deploy6ab3489533e4b1c99d146908 is live at easy-news-research.netlify.app.
Browser home/login render; Netlify API proxy returns articles empty and anonymous
editor/topics401. New Google login stopped at chooser (automation click timed out;
no credentials requested). Do not claim authenticated UI recheck passed.
Active schema21 DB and private originals/backups are under/data/research.
Updated local Windows backup operator to this path with runtime DB_PATH guard;
new encrypted schema21 snapshot03-35-06-526Z verified. See releases/staging-report.md.
The deployed image contains an older copy of this Windows-only operator; execute
the updated LOCAL operator only. Source-only operator change needs no redeploy.
Proxy/rate-limit warning remains (trustproxyfalse), not a crash. Public-launch,
accuracy/PDF/OCR/grounded writing/archives/operations gates remain incomplete.

ACTIVE CUTOVER checkpoint supersedes all earlier unchanged-production notes:
Maintenance deployment8cf174e8-1cb9-4fc1-a6cd-ccab3c218c4a succeeded; public health
explicitly maintenance/writesEnabled=false. Old037c32b4 writer stopped. Final
post-stop encrypted backup03-30-40-912Z verified16→21/accounts preserved. Created
private /data/research with originals/backups, copied source using SQLite backup,
chowned only these new paths to1000 and migrated copy as a uid1000 child process.
Integrity/FKs/accounts/roles and real startup readiness passed. Original
/data/easy-news.db and historical/data.db preserved. In-place setgid was refused
by Node io_uring CVE guard; no guard disabled, used spawn uid/gid instead.
Runtime settings now point DB_PATH=/data/research/easy-news.db and
ARCHIVE_PATH=/data/research/originals; MAINTENANCE_MODE=false for NEXT deployment;
all paid/ingestion/HTML flagsfalse, budgets0. RAILWAY_DOCKERFILE_PATH=ops/Dockerfile.railway.
Docker deploy10d63288-d3f0-4601-aa55-d2e7dfdd6402 is in flight; verify its result.
Do not rerun old-path export as if it backs up the new active DB. No Netlify update yet.
Authoritative upload is a clean allowlisted bundle:
C:/Users/grifm/AppData/Local/Temp/easy-news-maintenance-a3d5b995-9c53-423a-81a0-634feef5f0d5
contains server/ plus91 explicit runtime files; Docker stage also has .dockerignore.
Use --path-as-root on that stage, with Railway rootDirectory/server. Repository
upload filtering passed rg but still omitted prices.json remotely; do not trust that
check as release proof. Nixpacks also conflicts with final Docker ignore rules.
Maintenance clean bundle WITHOUT.dockerignore succeeded. Final Docker clean bundle
local imagef92ec8a5df70cc2bb12b630fd736d1143eaa756d2f9c57f1b8273abdf969b670
passed real HTTP extraction smoke. Frontend39/6 and lint/build passed again.

Latest recovery checkpoint (2026-09-23 UTC): user approved encrypted backup on
this PC. Successfully encrypted and restore-tested the live schema16 snapshot
in memory through schema21; account/role counts preserved, integrity/FKs clean.
Verified artifact and recovery procedure are recorded in DEPLOYMENT_RUNBOOK.md.
No originals exist in this snapshot; the one-off export refuses nonempty originals.
Key is DPAPI CurrentUser protected: retain this Windows profile. Portable escrow,
scheduled retention and measured RPO/RTO remain outstanding. Backup is pre-cutover,
not a final snapshot taken after stopping writers. Railway is still unchanged.
Production runs root; /data root0755, live DB root0644. New image UID1000 cannot
write there. Plan a new private /data/research directory, preserving old files;
do NOT recursively chown /data or copy a live SQLite file. Cutover is not executed.
MAINTENANCE_MODE defaults false; explicit true starts health-only HTTP without DB,
auth, ingestion or parser initialization and rejects all application requests503.
Health200 reports status=maintenance/writesEnabled=false, not research readiness.
Latest image sha256:2c4b03110966e649c984a6108a1f5fa869137cf031ad915eb2336e87f8d5a3b2
passed real UID1000 container extraction smoke and maintenance/no-DB/write-rejection
checks with network none/cap-drop ALL/no-new-privileges. Backend533/57 passed.
Usage latest87% consumed/13% remaining, superseding the older figure above.
Next: coordinate Docker builder/root context and maintenance deployment, stop old
writers, final encrypted backup, migrate a preserved copy into UID1000 directory,
verify, then activate backend/frontend. No remote config or deployment changed.

Newest Docker/Wayback checkpoint supersedes the pending-repair notes below:
owner restarted Docker successfully. Engine29.6.1/Linux x86_64 verified; no socket
move/reset needed or performed. Built/tested final local candidate image
sha256:16fc25c33afa60dd7dc0bb8b6606c2ae534a6a850a728d50249ddcf0a0f055b6
(easy-news:release-candidate). Initial preflight caught COPY making bundle root
0755; final Dockerfile explicitly chmods that root0555. Preflight passed, then
test-support/container-smoke.js passed actual non-root UID1000 Linux SQLite/schema21
startup→authenticated HTTP HTML extraction→manifest→original download→shutdown,
with network none, cap-drop ALL, no-new-privileges, disposable data and read-only
test mount. Final rebuild/retest after Dockerfile comment edit also passed. No live
containers/test sessions remain; image retained. No Railway/Netlify deploy yet.
Next release work: final image/security checks, live UID1000 volume access check,
independent recovery/backup and coordinated16→21 migration/release with paid models
disabled. Full public-production/accuracy/PDF/writer scope remains incomplete.

Wayback receipt intake now checks fixed URL, every redirect, matching Memento date
and capture≤retrieval before storage; extraction rechecks receipt metadata, persists
archive fields in immutable manifest and uses original URL for source-chain group.
Original+two captures test proves one chain. Live fallback/missing/mismatched dates
reject. archive.is FAQ returned429; not retried/bypassed, intake remains held.
Backend529/56 passed. See ARCHIVAL_SOURCES and DEPLOYMENT_RUNBOOK for limits.

Newest archive/Docker checkpoint: read-only Docker diagnostics confirm its
dockerInference entry is an inaccessible reparse point (fsutil error1920); WSL
reports a zero-byte entry last modified Aug27. Backend processes remain in their
prior error state, not a working engine. Asked user asynchronously for permission
to stop Docker, move only this entry aside recoverably, and restart; NO reply yet,
no Docker state changed. Do not reset/delete images/volumes/settings.
Meanwhile implemented bounded Wayback CDX lookupCaptures core after official docs
and two live read-only compatibility checks. Availability actually returned a
post-cutoff Jan1 2020 capture; CDX response shape verified. Core enforces exact URL,
UTC cutoff, row/byte/time limits, cancellation, dedup and conflicting-metadata
rejection. Results are discovery-only/unverified; no production transport, caching,
rate budget or archive ingestion yet. See ARCHIVAL_SOURCES.md. Keep full goal active.

Newest activation-wiring checkpoint: HTML_EXTRACTION_ENABLED defaults false;
bootstrap requires private archive and operator bundle/digest/scratch variables,
then runs loadHtmlRuntime before listening. createHtmlExtractionService admits one
parse per process, rejects excess without queueing, forwards request abort, and
stops/drains before DB close. HTTP extract supports opt-in HTML and session actor,
never request runtime options; disabled503, busy429/Retry-After1. Receipt GET has
extractionAvailable; frontend only offers HTML when true. Disconnect cancellation
tested through real HTTP. HTML HTTP→service→archive→manifest integration uses mocked
Linux parser/runtime boundaries, so it is NOT real-parser container proof. Backend
503 tests/55 suites, frontend39/6 and lint-gated build pass. New env examples and
runbook updated. No deploy, live variables, DB migration, paid calls or DNS change.
Next: actual container build/security/full HTTP verification, PDF/OCR and remaining
production plan. Keep one process/replica until cross-process admission exists.

Newest runtime checkpoint: evidence/html-runtime.js provides loadHtmlRuntime;
ops/check-parser-runtime.js is an import-inert non-root release preflight. Checks
zero Linux capabilities, root-owned read-only single-link bundle/trust record,
safe ancestors (root sticky /tmp allowed), disjoint paths and UID-owned0700
scratch, then manifest integrity and an actual synthetic sandbox parse. Root-only
fixture orchestration in test-support/html-runtime-probe.js runs application
checks as UID/GID1000: 12 scenarios passed under WSL, including insecure ownership,
write bits, non-sticky writable ancestor, symlink scratch, hard link, and tampered
digest. Ordinary non-root Linux suite 15/15 passed; backend 491/54 passed again.
The test originally changed scratch ownership before an earlier root-run fixture
parse; moved the new ownership cases to the end to avoid contaminating that test.
This is NOT container verification. Docker still unverified; no production change.
Next: wire validated runtime into opt-in startup and bounded/cancellable editor
HTML extraction service, then frontend capability display. Preflight command is
documented in deployment runbook; it is not yet a startup/API activation path.

Newest HTML intake checkpoint: internal extractFetchHtml shares the atomic receipt→
document→manifest persistence with plain text, invokes the existing fail-closed
sandbox wrapper with operator-only runtime config, records actual source/text
lengths and parser spans/quality, and never approves extraction. Rechecks editor
and cancellation after asynchronous parsing; tampered originals fail before parser
invocation. Same-version changed output rolls back the new snapshot. Backend
491 tests/54 suites pass. Eight added tests use a mocked parser for persistence,
except one real-wrapper missing-config rejection; these are NOT new Linux/container
integration proof. Editor HTTP route remains text/plain only. Next: verify immutable
runtime/container, wire trusted runtime configuration and HTML API intake with
bounded concurrency/cancellation, then remaining production plan. Production is
still schema16; local21. No deployment, migration, paid calls or DNS changes.

Newest UI checkpoint: user explicitly allows redesign in any direction. Continue
the research-first direction (readable evidence, visible provenance, unmistakable
review-vs-verdict boundary), not just preserving prototype visuals. Added
ExtractionReview.jsx in DocumentView: exact manifest selection, readable warnings,
private original download link, no default approval/attestation, notes, stale-save
reload and abort-safe state. Empty history is unverified. Six new tests; frontend
37 tests/6 suites and lint-gated Vite build pass. Real Edge synthetic fixture:
login→queue→fetch→extract→reject→reload preserves rejected status. Desktop reviewed;
mobile exposed URL-heading overflow, fixed with overflow-wrap:anywhere, verified
document width==viewport width (341 CSS px). Updated warning copy visible in final
build. Viewport reset, fixture account logged out, temporary tab closed. No real
claim review or production write. Next: HTML manifest intake/runtime activation
and remaining public/writer/publishing scope; review UI exists but downstream
publication/accuracy gates are not complete.

Newest review checkpoint: local schema 21 adds append-only extraction_review_events.
Editor API exposes bounded extraction summaries on document detail, exact manifest
GET, hash-checked original attachment download (no-store/nosniff/sandbox CSP), and
CSRF-protected version/event-fenced review POST. Actor is session-derived, accepted
requires originalCompared=true, and rejected reviews append without history loss.
Evidence packets expose extraction quality; missing/unreviewed/rejected are gaps,
review changes alter packet hash, and flagged counterevidence is retained.
Backend 483 tests / 54 suites pass including expanded full HTTP intake/review/
download/CSRF/actor/stale/packet assertions and backup-first 16→21 fixture migration.
Production remains 16. No deploy or paid calls. Review UI, downstream writer/
publication enforcement, HTML manifest ingestion, PDF/OCR and other scope remain.
See INGESTION_API.md for endpoint contracts. Next: review UI and HTML intake
integration without weakening original comparison or release safeguards.

Newest checkpoint: local schema is now 20 (production stays 16). Migration 020
adds immutable extraction_manifests with receipt/original/document links, text and
manifest SHA-256, extractor version, UTF-16 source/text spans, quality/review marker
and requesting actor. Plain-text extraction writes this atomically with document
and retrieval records; repeat extraction is idempotent and failed manifest inserts
roll back imports. This is persisted provenance, NOT a completed human-review gate
or HTML/PDF intake. Existing records are not falsely backfilled as reviewed.
Full backend: 483 tests / 54 suites pass, including backup-first 16→20 fixture
migration/account preservation. Production was not migrated or deployed.
One test assertion needed cross-Jest-VM native SQLite error code/message matching;
diagnostics proved rejection occurred (SQLITE_CONSTRAINT_TRIGGER), not rollback
failure. Diagnostic logging removed.

Docker start was attempted and failed authoritatively: backend log 2026-09-23
02:26:26 UTC reports inference-manager socket remove/listen failure at
C:/Users/grifm/AppData/Local/Docker/run/dockerInference. No Docker reset or data
deletion. Only our two hung docker.exe CLI probes were stopped after identifying
their exact PIDs/commands; exec sessions 90151 and 47903 exited 1. No live build.
Next available application work: extraction review/API display and HTML manifest
integration; container verification remains pending Docker repair or another
authorized builder. Do not repeatedly restart Docker without new evidence.

Newest packaging checkpoint: ops/build-parser-bundle.js now builds under Linux
x64 Node 22.23.1, verifies and seals read-only modes, and writes a new external
digest file; refuses preexisting outputs. WSL 15-test suite passes with sealed
release parsing and repeat-build preservation checks; backend 481/54 passes.
ops/Dockerfile.railway and default-deny .dockerignore are candidate files only.
Official Node amd64 image digest verified; Docker info fails because the Desktop
Linux engine pipe is missing. No container build, Railway builder change, migration
or deploy. Candidate uses root-owned bundle and non-root UID1000 service, so live
volume access must be checked before switch. See latest deployment runbook section.
Next available work: runtime activation/config validation and extraction-manifest
persistence while Docker build verification remains unavailable. Do not call this
an immutable deployment merely because same-owner WSL mode checks passed.

Newest local integration checkpoint: extract-html.js now requires Linux x64 and
operator-supplied bundleDirectory/manifestSha256/scratchParent. Verifies bundle,
launches native sandbox with pipes (including discarded stderr), creates private
scratch and cleans only after child close. Shared html-process.js retains 5-second
deadline, 8 MiB output limit and abort fencing. Result shape/review marker/offsets
validated. No unrestricted production fallback; portable fidelity tests moved to
test-support/html-worker-harness.js. WSL 15 tests pass, including eight real wrapper
scenarios (success, missing config, cancel, invalid UTF-8, tamper, invalid result,
deadline, output cap/cleanup); backend 481 tests/54 suites pass. No deployment or
API enablement. Next: immutable runtime build/deployment configuration, extraction
manifest persistence/quality review, release security checks. Older notes below
about missing wrapper integration are superseded, not proof of API readiness.

Latest local checkpoint: backend 481 tests / 54 suites pass. Parser bundle now
has verifyParserBundle requiring an external manifest SHA-256 and checking the
bounded inventory and every file's bytes. Eight additional tests cover valid
verification, modified bytes/manifest, extra/missing files, hardlinks, traversal,
and missing digest/relative root. This is integrity verification only, not binary
authentication or an immutable runtime guarantee. No application activation,
deployment, production migration, or paid provider calls performed. Next: connect
verification to deployment-owned immutable packaging and the fail-closed parent
wrapper; retain the existing HTML intake gate pending release/security checks.

Newest local checkpoint (supersedes CRA notes below): user approved Vite/Vitest
migration AND WSL compiler/libseccomp installation. Vite 8.3.0, Vitest 5.0.1,
React plugin 6.1.1, jsdom 30.1.1; requires Node >=22.22.2. CRA removed. Clean
npm ci --ignore-scripts succeeds; all 31 frontend tests pass plus two Node
config/build smoke tests, production build passes. Both frontend full audit
and backend production audit report zero findings. Public defines are an
explicit two-key allowlist, verified in compiled assets with synthetic secrets.
App.js/index.js/App.test.js renamed to .jsx; test command is now plain npm test.
Preserved build/ directory, Netlify proxy and REACT_APP_ public setting names.
Fixed duplicate sibling list keys and repeated selection clearing saved passage
confirmation; existing regression plus explicit repeated-selection assertion pass.
Edge synthetic build verification passed anonymous redirect/login, lazy research
desk, fetch/refresh/sidebar, extraction/read-only text, desktop layout and logout.
Fixture session 72741 stopped with Ctrl-C (exit 1 on Windows). No production write.
Lint follow-up verified: explicit ESLint JS/React/Hooks/accessibility configuration,
zero-warning prebuild gate and deliberately invalid fixture test all pass. All
31 UI tests, lint-gated build and frontend audit (zero findings) pass. One local
rule exception keeps the overflow document region keyboard-scrollable; no broad
accessibility disable. ESLint 9.39.5 is deprecated/unsupported, pinned because
React 7.37.5 and jsx-a11y 6.10.2 peer ranges stop at 9; follow upstream support.
Remaining tooling follow-up: browser-target coverage review and target-host
install; zero audit findings are not a full security audit.

WSL install completed: GCC 11.4.0, libseccomp-dev 2.5.3-2ubuntu3~22.04.1.
test-support/seccomp-probe.c compiled with -Wall -Wextra -Werror and verified
socket creation fails EPERM while pipe works. Probe executable remains at
/tmp/easy-seccomp-probe-20260922-2112. This is a capability probe, not a sandbox:
full filesystem policy, inherited descriptors, resource limits and actual child
worker integration are still unimplemented/unverified.

Further kernel evidence: landlock-probe.c builds with -Wall -Wextra -Werror;
Landlock ABI 7 denies read AND write to an otherwise accessible synthetic file
in an isolated child, on both WSL and the active Railway container. Parent cleans
its exact mkstemp-created test file. Separate seccomp probe also passes on Railway
(socket EPERM, ordinary pipes available). Remote probes used empty environments,
5-second process deadlines and fresh /tmp dirs removed in finally; no DB reads,
service restart, deployment or persistent settings change. One attempt failed
because a prior WSL /tmp executable was missing; recompiling source fixed it.
Railway runtime observed Node v22.11.0 (do NOT infer it meets frontend's newer
Node minimum just because both say 22). Deployment 037c32b4 remains RUNNING.
Next implementation checkpoint: evidence/native/parser-sandbox.c foundation now
exists, not wired into extract-html.js. Six Linux tests pass in
test-support/sandbox-tests.py with actual Node 22.23.1 HTML parsing included.
Read evidence/native/README.md for limits, runtime contract and remaining gates.
Node archive downloaded through npm to Windows temp/easy-parser-node-22.23.1/
node-linux-x64-22.23.1.tgz; use EASY_PARSER_NODE_ARCHIVE for the WSL test. No WSL
system Node installation. Runtime needs its own empty OpenSSL config; default
system config was correctly denied. RLIMIT_NPROC removed after demonstrating
shared-user thread exhaustion; fork denied via seccomp, threads CPU/AS bounded.
ioctl on verified stdio pipes allowed for libuv, denied on descriptors >2.
Follow-up: 15 local tests now pass, including named/network stdio rejection,
unnamed Unix socketpair acceptance, link escapes, scratch-exec, file/FD limits and
an unsandboxed FD/environment positive control. Node parent stdio is socketpairs,
not FIFOs; launcher validates unnamed AF_UNIX/SOCK_STREAM endpoints explicitly.
Fourteen Railway probe cases now pass under UID 0, including portable Node 22.23.1
read/network/process denial. Parent runtime Node 22.11 uses a confirmed Nix
interpreter outside allowlist and was correctly rejected. Portable runtime
downloaded with npm pack --ignore-scripts, archive SHA-512 matched local fixture,
temporary package/runtime/test files cleaned by probe finally. Full HTML worker
passed entity/active-content, table/footnote, 5,000-paragraph exact text, empty
content and bad UTF-8 fixtures, including source-span bounds/review markers.
Package entities must be 8.1.0 from parse5's nested dependency, NOT unrelated
top-level entities 2.2.0 used by RSS. New parser-bundle.js build factory packages
exact distribution files/licenses with all-file size/SHA-256 manifest; four unit
tests pass. Local 15-test Linux suite now executes the actual generated bundle.
Activation manifest validation, immutable deployment integration, more resource
edge cases, independent review and application wiring remain. The existing
unconstrained HTML wrapper stays unexposed. Native diagnostics
compile flag PARSER_SANDBOX_DIAGNOSTICS reports only code line/errno, not document
data. Remote probe script: test-support/railway-sandbox-probe.js (import-inert).
Use the cached actual Railway executable for payloads beyond npx.cmd's command
length: C:/Users/grifm/AppData/Local/npm-cache/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway.exe.
Compile binaries immediately before reading WSL /tmp; older temp artifacts have
disappeared between calls. Official reference:
https://docs.kernel.org/userspace-api/landlock.html .
Goal UI still reported blocked despite user's resume message; no tool exists
to change blocked to active (only complete/blocked). Continue work when prompted;
do not mark the full goal complete or create a duplicate goal.

Historical verification before Vite migration:

Clean local installation verified: Node 22.23.1/npm 11.4.2, server npm ci
(native SQLite included), frontend npm ci --ignore-scripts, then backend
469/53 and frontend 31/5 tests pass. Fresh production build also passes with
same main.b0481916.js artifact name. CRA warning persists. Compatible frontend
audit-fix dry run offers zero changes; next dependency work needs deliberate
toolchain migration, not repeated audit-fix attempts. Netlify declares Node 22.

Frontend follow-up: react-router-dom pinned 7.18.4; all 31 tests / 5 suites and
production build pass. Added real navigation/login-redirect tests and test-only
CRA Jest export mapping/TextEncoder bridges. Audit now 28 (9 low/5 moderate/14
high), no router entry. Edge browser verification with the production build and
synthetic loopback fixture passed: anonymous /editor redirects to login; local
login returns home; research desk lazy-loads; approved synthetic fetch queues;
refresh updates both record and sidebar to fetched; extraction displays exact
preserved synthetic text and adds the document; logout removes editor access
and redirects to login. No real source download/model call/production data used.
Fixture process stopped (session 10218, Ctrl-C exit 1); no claim of temp-file
cleanup on Windows. No deployment; built assets are not published assets.

Latest local verification (2026-09-22): scoped gaxios/node-cron UUID overrides
to 11.1.1; backend 469 tests / 53 suites pass, production-only audit zero
vulnerabilities. Frontend production build passes including fetch sidebar refresh
fix (historical CRA warning). No redeploy. WSL installation was subsequently
approved and completed as noted above. HTML parser remains unexposed and not an OS sandbox.

- Frontend: https://easy-news-research.netlify.app (Netlify site
  `fdd1496b-3ae0-4977-9473-8e7835660517`). Same-origin `/api` proxies to Railway.
- Backend: https://theeasynews-production.up.railway.app . Latest verified
  deployment `037c32b4-2a54-4c11-8700-94145be75ab9` SUCCESS (2026-09-22);
  readiness returned ready. Direct Node startup and readiness gate preserved.
- Railway project `e8d6fdb7-6468-4b4d-a074-200ba127a827`, environment
  `e3f4d555-96a3-44d9-bf3b-e87fcc7d4947`, service
  `35900e6b-6d99-477a-b104-21cde85264b5`; existing Hobby plan, $10/month target,
  not a configured hard cap. One persistent `/data` volume.
- Effective startup: `node index.js`; healthcheck `/health/ready`, timeout 120s,
  drain 15s. A fresh upload applied these settings; CLI redeploy reused the old
  manifest. No local railway.json is required. Do not repeat ineffective uploads.
- Google login and refresh verified; explicitly approved editor role granted to
  the sole verified Google identity, user 1. Research desk opens with no topics.
- Classification, generation and automatic publication remain false; budgets 0.
- Database `/data/easy-news.db`, schema 16. Integrity-checked snapshot:
  `/data/backups/easy-news-20260920-post-editor.db` (same volume, NOT off-site).
  Preserve separate `/data/data.db`; never overwrite unknown historical data.
- Last full backend test (2026-09-22): 374 tests / 43 suites passed. Public author
  API now allowlists id/name/persona rather than exposing internal prompts;
  regression test also protects future private columns. Backup-only CLI deployed.
  `npm run backup-db --prefix server -- <absolute-source> <absolute-new-snapshot>`.

## Next bounded work

DEPLOYMENT HOLD: local code now requires schema 19 (additive source_fetch_limits,
fetch_jobs and fetch_receipts tables); live Railway is still schema 16. Do not upload this backend until the
backup-first migration and rollback procedure is verified and coordinated.
Persistent per-host reservations are wired into every fetch/redirect hop, with
429/503 Retry-After backoff and validated redirect continuations. Preliminary
MIME/content screening is implemented, not full parsing. Fetch jobs support
editor enqueue, policy snapshots, exclusive leases and bounded expired-lease
retries. Retry release is lease-fenced and rechecks editor access; validated
redirect continuations persist across reopening the DB. Rate/backoff pauses do
not consume failure allowance; download errors do, eventually exhausting jobs.
Claiming requires the live source registry; removed/changed policies or corrupt
snapshots block before leasing, while newer authorized jobs remain eligible.
`discovery/fetch-receipt.js` stores immutable raw retrieval receipts separately
from extracted research documents. Private originals use the existing archive;
metadata-only records omit body storage. Lease, editor and current-policy checks
run before archiving and again before the DB commit. A lost lease may leave a
private orphan object for reconciliation, never a completed job. Headers are
allowlisted; redirect history is validated. Worker/API integration, extraction,
archive reconciliation remain unfinished.
`discovery/fetch-worker.js` now runs one queued job through fetchDocument →
storeFetchReceipt/releaseFetchJob, resuming persisted redirect continuations and
sanitizing errors with bounded retries. Six worker integration tests use real DB,
archive and fetch orchestration with fake DNS/HTTPS transport; 54 focused tests
pass across worker, receipt, jobs and fetch-document suites. No live crawl ran.
Opt-in startup scheduling is now implemented locally: INGESTION_ENABLED defaults
false; enabling requires an archive and nonempty validated SOURCE_POLICIES_JSON
(max 64 KiB / 100 policies). Shutdown aborts/drains ingestion before DB closure.
42 tests passed across bootstrap/config/fetch-worker suites, including active
fetch cancellation and rejected unapproved configuration. Not enabled on Railway.
Real TLS fixture tests now pass: actual HTTPS on loopback with an ephemeral
certificate, injected port/CA only, verifies pinned address plus original SNI,
rejects wrong hostname and untrusted certificate (12 tests including transport
unit suite). Requires OpenSSL, using OPENSSL_PATH, Git for Windows fallback, or
PATH. No production TLS settings changed and no external crawl occurred.
Editor fetch admission/status API now exists: GET/POST
`/api/v1/editor/topics/:id/fetch-jobs` behind existing session/editor/CSRF controls.
POST accepts sourceId/url only (actor is session-derived); source registry is
provided only by operator-configured bootstrap. Missing registry yields 503.
GET uses bounded pagination and explicit fields, never lease token/policy JSON
or continuation. 43 tests pass across editor API, authorization, cookie auth and
bootstrap, including missing CSRF, reader, anonymous and off-policy rejection.
`evidence/extract-fetch.js` now imports privately archived text/plain receipts
with fatal UTF-8 validation, digest verification, 1M character bound, editor check
before/after async reading, original binding and HTTP retrieval provenance.
Repeated extraction reuses the document/retrieval; metadata-only receipts cannot
be extracted. No assessment/verdict created. URL-hash origin grouping is NOT
proof of independent sourcing. 15 receipt/manual-import tests pass. This service
is now exposed by POST `/fetch-jobs/:id/extract`; GET `/fetch-jobs/:id` returns
receipt provenance without original bytes or internal leases. The editor API test
exercises enqueue → real worker orchestration with simulated network → receipt →
extraction → document read, plus CSRF/reader rejection. 42 focused tests pass.
See `docs/INGESTION_API.md` for endpoints and limitations. The local research desk
now includes FetchSourceForm, topic fetch-job listing and receipt inspection with
manual refresh. 17 focused UI tests pass; production frontend build compiled
successfully. Existing React act/CRA dependency warnings persist.
The form retains failed input and rejects credentialed/non-HTTPS URLs locally;
server policy validation remains authoritative. Existing styling was reused;
frontend skill reference output was truncated, so full skill application and
browser visual verification are outstanding. No frontend deployment performed.
The receipt view now offers an explicit plain-text extraction action, hides it
for metadata-only/unsupported formats, and opens the returned document while
refreshing the document list. 22 focused form/receipt/research-desk UI tests pass;
React/CRA warnings remain. Fresh frontend build succeeded; Edge browser verification
used `server/test-support/browser-fixture.js` on localhost:4311 with an in-memory
DB, temporary private archive, synthetic editor and simulated DNS/HTTP. Verified
login → topic → URL submission → receipt refresh → text extraction → document
display, with screenshot inspection. No external crawl or production mutation.
Found stale sidebar state after receipt refresh; fixed list invalidation with a
failing-then-passing regression test (23 focused UI tests now pass). That last
small fix still needs a fresh build/browser recheck. Fixture process was stopped
with Ctrl-C; no running verification server is intentionally left behind.
HTML parser foundation now exists in `evidence/extract-html.js` and
`html-parser-worker.mjs`, pinned parse5 8.0.1. Six real-child-process tests pass:
entities/paragraphs/source UTF-16 spans, table separation/footnotes, skipped active
or explicitly hidden nodes, invalid UTF-8/empty content, oversized output and
pre-cancellation. Limits: 25 MiB input, 1M output characters, 100k nodes/50k spans,
8 MiB serialized output, 128 MiB V8 heap, five-second wall deadline. No JS/page
resources execute, but this is NOT an OS network sandbox or total RSS/CPU cap.
All output requires review, with layout/CSS unverified. Not wired to receipts/API.
Remaining: hard isolation, fidelity fixtures, whitespace/preformatted handling,
timeout/in-flight abort tests, extraction manifest persistence and PDF/OCR.
Fidelity regressions fixed: inline-element whitespace no longer joins names or
amounts, and preformatted text preserves whitespace through nested markup.
Eight real child-process HTML tests pass. Source offsets still reference UTF-16
HTML character ranges, not byte offsets or rendered-page locations.
Latest parser verification: 10 tests pass, including in-flight cancellation and
a real deliberately stalled child killed by the five-second deadline. Fixed an
early-settlement bug: cancellation now waits for child close before rejecting;
sending a kill signal alone no longer counts as completed cleanup.
Read-only Railway isolation probe: `/bin/unshare` and `/bin/prlimit` exist;
`bwrap` is unavailable. `unshare --net -- true` fails with Operation not permitted.
Thus network namespace isolation cannot simply be enabled in the existing runtime.
Further read-only probe: cc/gcc/python3 are unavailable; libseccomp.so.2 is
installed at /lib/x86_64-linux-gnu/libseccomp.so.2. A native launcher would need
a build-stage toolchain and explicit deployment verification, not runtime compilation.
Local isolation-test tooling investigation: Docker CLI/Desktop are installed, but
the Linux engine was stopped. Starting Desktop failed in its inference manager:
the Docker/run/dockerInference socket could not be accessed (confirmed host log,
2026-09-23T00:40Z). Do not factory-reset or delete Docker data. The pending
docker-version probe was cancelled; no container test ran. Ubuntu-22.04 WSL is
installed but has no cc/node, and unshare --net is also denied there. Asked user
asynchronously for approval to install a compiler/libseccomp headers in that WSL
environment; approval is not yet received. Independent app work may continue.
Keep HTML intake gated while evaluating a constrained launcher or separate worker;
do not claim heap/time limits constitute a network sandbox.
Dependency audit reports three moderate findings in gaxios/node-cron/uuid; no
parse5 finding. Do not apply blind major-version audit fixes.
Next: complete extraction safety/fidelity before enabling HTML. Runbook integration
and full security/release checks remain outstanding; this is not a public release.
No production policy is seeded. Do not mislabel raw
HTML/PDF as extracted text, verified claims, or manual_import retrievals.
Latest full backend run: 448 tests / 51 suites passed on 2026-09-22, including
backup-first 16→19 identity/role preservation with an intact v16 snapshot.
These are local fixtures, not a performed production migration. Railway deployment
037c32b4-2a54-4c11-8700-94145be75ab9 still reports SUCCESS and /health/ready
returned ready during this check. No deployment or paid model calls occurred.

Local, not deployed: `server/discovery/` now contains source registry, conservative
public-address validation and pinned DNS lookup, HTTPS request primitive, bounded
gzip/deflate/Brotli body decoding, and redirect-aware `fetchDocument`. Network
unit tests use fake DNS/transport/streams; no live crawling occurred. One
15-second overall fetch deadline, max three redirects, per-hop policy and DNS
validation, TLS hostname verification, no ambient credentials/pooling, and 25 MiB
wire/decompressed limits are implemented. They are NOT a completed ingestion
feature: real TLS integration fixtures, conditional retrieval, durable fetch provenance, extraction,
and editor-only job integration remain. No production source policies are seeded.
Source policy review flags are operator configuration, not robots.txt enforcement.

1. Resolve proxy/rate-limit configuration safely. `server/app.js` uses default
   trust proxy false; deployed logs show ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
   Inspect actual Netlify/Railway forwarding and spoof resistance before trusting
   any hop/header. Warning is caught/logged by the installed limiter, not fatal.
   Focused documentation check: Railway documents X-Real-IP as the remote client
   address (https://docs.railway.com/networking/public-networking/specs-and-limits).
   With Netlify in front, that alone may identify the proxy rather than the reader.
   Netlify documents signed proxy redirects using an x-nf-sign HS256 JWS and a
   runtime secret (https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/).
   These facts do NOT establish that arbitrary forwarded-IP headers are signed
   or sanitized. Verify actual header provenance before implementing trust;
   do not merely set trust proxy=true or suppress the warning.
2. Independent encrypted backups, retention and restore rehearsal remain absent.
   Existing snapshot does not protect against volume/account loss.
   Partial recovery evidence on 2026-09-22: copied the saved snapshot through
   backup-only into a new private temporary directory on the Railway container,
   then started the actual backend bound to loopback/ephemeral port with all
   model flags false and budgets zero. Startup succeeded, schema was 16, one
   editor was preserved, integrity was ok, and clean stop closed DB and listener.
   Live DB was untouched. This is NOT a separate-host/off-site restore or a
   measured RPO/RTO pass; originals and publication manifests were not exercised.
3. Continue the controlling `PRODUCTION_PLAN.md` and its implementation checklist:
   safe non-RSS/PDF/archive connectors, real corpus and independent evaluation,
   grounded drafting, publication/corrections and public rendering remain major
   gaps. Do not mistake passing unit tests for accuracy or public-release approval.
4. Domain theeasy.news has not been attached/cut over. No DNS changes performed.

## Incident evidence and cautions

Owner received two Railway crash emails. Replaced deployments logged npm SIGTERM
at shutdown during our redeployments; correlation with the emails is plausible,
not proven. Current deployment was healthy. Isolated direct-node Linux probe
exited code 0 on SIGTERM, motivating the verified startup change. Do not claim
all alerts are benign or repeatedly request the same screenshot.

Many changes are uncommitted on codex/accuracy-production. Preserve user work,
especially docs/REVIEW-2026-06-09.md. Older AGENTS/map/plan baseline descriptions
are stale; inspect relevant source before acting. DEPLOYMENT_RUNBOOK.md has
chronological evidence and superseded observations. Never print credentials,
session tokens or raw production DB contents. No provider calls are authorized.

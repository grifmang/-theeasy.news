# Later rebuild: deployment and recovery runbook

Updated 2026-09-20. The research frontend and backend have been deployed;
this is not completion of the production release gates. The owner approved
reuse of paid Netlify and Railway Hobby, a fresh database and persistent volume,
and a $10/month Railway usage target (not an enforced cap).

The authenticated Railway Backups page was checked on 2026-09-30. Creating
backups and enabling PITR require Pro; the current Hobby plan cannot satisfy the
scheduled independent backup gate. No upgrade or backup setting was changed.
Keep the encrypted off-Railway recovery path and implement retention/key custody/
alerts/fresh-host evidence separately within an owner-approved destination.

Windows scheduled encrypted backup now has one verified successful run. The
`EasyNewsEncryptedBackup` task uses the Node script action daily at 03:00 with
`StartWhenAvailable`, `IgnoreNew`, and current-user Interactive/Limited
execution. A Task Scheduler path failure was traced to Codex packaged-app
virtualization mapping the interactive `AppData/Local/EasyNews` alias to the
physical `AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EasyNews`
path; the script now uses the physical recovery and age paths. Run time, status,
artifact SHA-256, retention, and deletion evidence are in [RESUME](RESUME.md).
This is schedule execution evidence for the current Windows profile only. The
DPAPI-protected identity has no fresh-host/key escrow proof, alert delivery is
unverified, and archived originals remain unbacked. Two sidecar-less older
encrypted artifacts are held for manual review. No Railway deployment or
production migration occurred; deployed Railway remains schema21 and local
runtime is schema33.

The unpushed GitHub workflow now contains an exact-image Ubuntu PID 1/SIGTERM
gate matching the local smoke: non-root UID1000 data, no network/capabilities,
no-new-privileges, read-only root, live/ready health, `/proc/1` assertions,
graceful stop state, and post-stop schema33 integrity/foreign-key checks. Its YAML
and shell syntax pass locally. This is preparation, not hosted CI evidence; the
workflow must run successfully from an authorized commit before release.

Local Task17 public reads are now guarded by `PUBLIC_READ_ENABLED`, which
defaults false and is accepted only in staging with the private exporter. The
runtime binds and reconciles the current sink before listening and latches reads
to no-store `503` after sink loss or fatal exporter reconciliation. Do not set
this variable in Railway until the controlled schema33 migration has created the
dedicated UID1000 sink and the private-staging release evidence is ready. It is
not a production public-cutover flag.

## Current release — 2026-09-23 UTC

The Docker backend and updated frontend are now deployed. The authoritative
artifact IDs, migration/backup evidence, rollback cautions and incomplete gates
are in [the staging report](releases/staging-report.md). This supersedes all older
NOT deployed and schema16-current statements below. Active schema21 database is
`/data/research/easy-news.db`; preserved `/data/easy-news.db` is rollback history.
Use the updated local Windows backup operator, which guards the active path.
Paid processing, automatic ingestion, HTML activation and publication remain off.
theeasy.news DNS is unchanged. Do not equate this workspace release with public
launch or validated fact-checking accuracy.

### Current local release boundary — 2026-09-29

#### Schema33 image artifact checkpoint

A local schema33 release artifact has now been built and verified; this
supersedes only the earlier statement that no schema33 image artifact exists.
The release bundle includes analysis-verification and private publication
runtime. The host orchestrator loads the trusted verifier, captures one bounded
tar `Buffer`, validates and extracts that same buffer, and streams the exact
bytes over stdin to both Docker targets. The Dockerfile is in the archive.
Images carry the manifest digest label and CI uses immutable image IDs. The
retained source tar round-trips against the archive contents.

Manifest: 141 files / 912,247 bytes, digest
`327071bd14ba91264ef4715bb74be67a3860e183c5321ff04626d6e749cfbaad`. Source
tar: SHA-256
`564a8ff94952b3611d84664f3c8ed3d4eb33e7e25bd177bfd070d9c35f94167b`, 1,085,440
bytes. Runtime image ID:
`sha256:726effb734a9247a701290ddc708340cdd83aba5cf68e4e622190383e105f25b`.
Toolchain image ID:
`sha256:18698ec2b02af34e663b71f7d7323495aa347741aba6b49391c78314452d4f0d`.
Parser/PDF/non-root container/native sandbox/archive smokes passed; relevant
parent tests passed 54, 1 skipped. Astra found no P0–P3 issues and the original
TOCTOU P2 is closed within the trusted-runner boundary.

This image artifact is not yet deployable. Hosted Linux CI has not run. The exact
image has now passed the local PID 1/SIGTERM gate described below. A later
read-only Railway inspection confirmed UID 1000 database access but identified
missing sink/archive write ownership. Prepare those paths during controlled
maintenance and validate export durability; then complete
the fresh backup-first schema21→33 migration, staging E2E/recovery,
and remaining public gates. Railway remains schema21. No deployment or live/
provider call occurred. The trust boundary includes the CI runner, already-loaded
helper/verifier, process memory, Docker and tar; dependency downloads are not
covered by the source manifest. UI approval remains outstanding.

Superseding Task16 checkpoint: local runtime requires schema33; Railway runtime
and active database remain schema21. A local schema33 image artifact is verified,
but is not deployable pending the checks below. The local
global work-admission status now includes analysis-verification queue counts.
Authenticated editor analysis-version/job/permission/report routes and the
Research Desk review panel are implemented locally. Draft/report integrity is
checked, and permission writes use expected-event-ID plus exact-admission-hash
compare-and-set. The parser is capped at 300 KB and rejects inflation. Queueing
does not authorize execution. Its worker path is strict and default-off, all
editors currently have operator authority, and no live call occurred. An
explicit `ANALYSIS_VERIFICATION_ENABLED` path now exists, strictly default-off
and gated to exact staging configuration, validated budgets/token limit, a
fail-closed shared guard, and the audited adapter. It runs one serial worker with
a 30-second lease; shutdown drains before DB close, with no auto-permission or
recovery. Disposable fake-client bootstrap probes and the backend suite passed
(58/58 suites, 545 passed, 1 skipped). No deployment or environment mutation
occurred; runtime remains off. Exact 64,000-token gate and drain-before-close
were confirmed. Astra's final recheck found no remaining P0–P3 findings and no
activation regression. Provider auth/config errors currently make
analysis jobs terminal; existing recovery covers claim jobs only. Isolated
staging resources/credentials and adversarial, accuracy, and rendered-fidelity
gates are required before opt-in. Task15 and production remain incomplete.
Task16's local publication core adds audited owner capability, exact text-only
approval snapshots and dependency invalidations, plus per-target outbox tasks.
The schema33 private filesystem exporter/outbox worker has exact staging-only,
default-off activation. It binds canonical DB/root identity and an exclusive sink
process lock; `head.json` is O(1), with immutable history and installed-generation
proofs. Startup reconciles receipts, artifacts, tasks, and outbox state exactly.
Latest-review and final-pause fences reject stale publication while allowing
invalidation. Interrupted pending/link recovery and replay are covered. Linux
directory fsync failure is fail-closed; production Windows activation is
rejected. DTO/object prewrite occurs outside the final SQLite transaction.
Coverage still blocks actual publish. There are no public routes, public/CDN
purge, real production integration, deployment, or paid/live model calls. See
the current resume checkpoint for disposable probe scope and remaining Task16
gates.
Before any release, build a fresh source-matched image and perform the coordinated backup-first
schema21→33 migration. Retain a verified fresh encrypted off-Railway backup and
a rollback image compatible with that backup; rehearse restore and rollback
before cutover. Do not use schema31-or-earlier release instructions or stale images as current
evidence. Refer to [RESUME](RESUME.md) and [OPERATIONS](OPERATIONS.md).

The exact runtime image subsequently passed a disposable local Linux-volume and
PID 1 smoke. A narrowly privileged setup helper created UID/GID 1000, mode 0700
directories using only `CAP_CHOWN`; initialization and runtime used the image's
non-root user with all capabilities dropped, no-new-privileges, no network, a
read-only root filesystem, and tmpfs. `node index.js` was PID 1 with PPID 0,
zero effective capabilities, and both health endpoints ready. SIGTERM stopped it
cleanly in 211 ms (exit 0, no OOM/error); the schema33 database remained integral
with zero foreign-key violations. This proves local exact-image signal behavior
and the required ownership pattern, not Railway volume permissions or export
durability.

A subsequent read-only console inspection of active successful deployment
`10d63288-d3f0-4601-aa55-d2e7dfdd6402` found `/data` owned by root at mode 0755,
`/data/research` owned by 1000:1000 at 0700, the active database owned by
1000:1000 at 0600, and `/data/originals` owned by root at 0755. An impersonated
UID/GID 1000 probe could read/write the database and write `/data/research`, but
could not write `/data` or `/data/originals`. Because the private exporter rejects
a root overlapping the DB/archive/budget/frontend/build paths, controlled
maintenance must pre-create a separate private sibling such as
`/data/publication-export` with owner 1000:1000 and mode 0700 before activation.
Prepare `/data/originals` for UID 1000 separately before enabling archive writes.
Do not broaden `/data` itself. No production path was changed by the inspection;
Railway export durability remains unverified.

The Sep23 encrypted artifact described below is historical. The current manual
pre-migration recovery point is the encrypted 2026-09-30 snapshot recorded in
the latest RESUME checkpoint. Synthetic and real encrypted artifact rehearsals
both passed in fresh local containers through schema21→33 with integrity/FK
checks, account preservation, and production source preservation. The real run
used a security-reviewed host-only restore runner excluded from future release
bundles; its networkless, unmounted, credential-free container and post-run
cleanup evidence are recorded in RESUME. This remains a same-host rehearsal:
the DPAPI identity depends on the current Windows user/profile, and local Docker
trust, immutable base64 transport, swap/dump exposure, and production-volume
permissions/export durability are not proven. Task22 still lacks independent
scheduled encrypted backups,
7-daily/4-weekly retention, portable key custody, delivered alerts, a fresh-host
restore with measured RPO/RTO, originals backup/reconciliation, and Task16
publication/outbox/invalidation restore checks.

### Superseded local release boundary — 2026-09-26

Superseding Task12 checkpoint: local runtime requires schema28; Railway runtime
and active database remain schema21. Migration028 and durable claim-job/provider
recovery are local only. Classification and default paid flags remain off with
zero budgets. Paid flags require private shared persistent
`BUDGET_FAIL_CLOSED_PATH`. Missing provider key fails startup; runtime invalid
key durably pauses the queue. No provider calls or production changes occurred.
No schema28 release image exists. Workspace schema28 probes were disposable and
no retained database files are present. If an independently retained database
was created from an earlier migration028 draft, recreate it or explicitly migrate
it; never assume it has the consolidated schema.

Any future release must build and verify a fresh image matching the intended
source, then take a consistent, independently retained backup of the active
schema21 database before stopping writers and migrating through schema28. Verify
the migrated database and application readiness before resuming writers. Retain
the pre-migration backup and a rollback image compatible with that backup; do not
roll new code back against an incompatible migrated database. Rehearse both
forward migration and restore/rollback before production cutover. Keep the shared
budget guard private, persistent and writable by every backend instance before
enabling any paid flag. The provider recovery UI is required before classification
can be enabled, but is not a blocker for deploying the backend with classification
disabled. See `docs/RESUME.md` for verification and review scope.

The superseded Task09 checkpoint below recorded schema25; current local runtime
requires schema27. Railway runtime and active database remain at schema21. The
previously staged schema23 image
`sha256:fdfd0008f534822d67cf2f275630cd6f028e650a8a5dee59c7ac01428f3daa0d` is
superseded and stale. Do not deploy it. No schema24 or schema25 candidate image
exists. Before any deployment, rebuild and reverify a new image from the intended
source, rehearse the populated backup-first schema21→25 migration and restore
path, then coordinate the production backup, writer stop, migration and
readiness checks. Do not reuse any prior bundle/image digest as evidence for the
new candidate. Production state has not changed as part of Task09.
Task09 adds local deterministic saved-passage retrieval and immutable editor
audit; it makes no network/model calls and does not establish recall. A frozen
labeled corpus, measured macro recall@30, critical-counterevidence retention,
evidence-time cutoff and browser/E2E review remain release gates. Its bounded
search limits report cutoffs and do not prove result completeness.

## Repeatable backend source bundle

### Local CI workflow checkpoint — 2026-09-26

`.github/workflows/ci.yml` defines read-only PR/main/master/manual verification.
It uses commit-pinned actions, Node22.23.1, lockfile installs, dependency advisory
gates, existing regressions, frontend lint/build, verified backend source staging,
Docker preflight/HTTP smoke, and three-day source/image evidence artifacts.
The frontend placeholder OAuth build is a check only, not a deployable frontend.
No production credentials, model calls, remote deployment or registry push occurs.
Owner policy: no new unit tests; E2E authoring follows implementation completion.

Actionlint passed Sep26. A separate clean Linux UID1000 Docker rehearsal on Sep26
passed both locked installs, public-config check, ESLint, Vite build and source
staging (93 files/455684 bytes; manifest SHA256
`67b1b25435206a97ceb92fc71e46ee65e232c1036ae44927c919e488f0427f68`).
Inputs were mounted read-only and copied into disposable container storage;
production data/credentials were not mounted. This is not a hosted GitHub run.
The workflow now installs pinned Gitleaks8.24.3 using the runner Go toolchain,
scans full fetched Git history and checkout before dependency scripts, then scans
the source bundle and generated browser assets before retaining evidence.
All scans use full redaction and ignore inline suppression comments; failures stop
the job. No secret reports are uploaded. Pattern scanning cannot prove absence of
all secrets; config/ignore changes require review and real leaks require rotation,
not an automatic baseline exemption. See the [scanner documentation](https://github.com/gitleaks/gitleaks/blob/v8.24.3/README.md).
Local Sep26 scans of44 commits, the clean CI input snapshot, retained source bundle
and current browser build all reported no leaks; updated actionlint passed.
These are not a hosted whole-checkout scan or a new container-image scan.
The workflow is local/uncommitted. Hosted execution and an
approval-gated release consuming the tested artifact remain incomplete.
CI now invokes the existing native sandbox suite in the compiler-stage container,
UID1000/network-none/cap-drop-all/no-new-privileges with a read-only fixture mount.
Local Sep26 run:14 passed,1 optional Node-archive scenario skipped. The separate
release-image smoke does not substitute for that optional adversarial scenario or
root-ownership scenarios. Updated actionlint passed. Do not declare task21 done.

### Source packaging procedure

Use `server/ops/stage-release.js` instead of uploading the mutable checkout or
assuming .railwayignore matches the remote builder. It is import-inert and never
deploys or calls providers. Supply absolute paths; destination must not exist and
must not overlap the source. It copies explicit source directories/root JS and
package files, includes JSON/MJS/native inputs, and excludes root local data,
dependencies and tests. Unexpected file types/private filenames inside allowed
runtime trees reject rather than silently upload. This is not a general secret
scanner: review source/config contents before release.

```powershell
$releaseOutput = Join-Path $env:TEMP ('easy-news-release-' + [guid]::NewGuid())
node server/ops/stage-release.js stage (Resolve-Path server).Path $releaseOutput
# Retain manifestSha256 printed by stage outside the bundle. Do not recompute
# the expected hash from a potentially altered manifest when verifying later.
node server/ops/stage-release.js verify $releaseOutput <retained-manifestSha256>
docker build --platform linux/amd64 -f "$releaseOutput/server/ops/Dockerfile.railway" -t easy-news:verified-bundle "$releaseOutput/server"
```

Run the existing container smoke against **that tag**, then reverify the retained
manifest digest immediately before explicit `railway up $releaseOutput
--path-as-root` with the known project/service/environment IDs. Railway root stays
`/server`, Dockerfile path `ops/Dockerfile.railway`. No extra ignore file is added
to the assembled bundle. Do not upload only the nested server directory using
--path-as-root while the Railway root remains/server.

Manifest checks exact file hashes/sizes/inventory and reject missing, altered,
extra or linked entries. Source is snapshotted into buffers before output creation;
existing outputs are never replaced, partial failures retained. Linux source modes
are644/755 for non-root image reads, including with umask077; outer output remains
private0700. Hashes prove integrity against the retained digest, not authorship,
application correctness or release approval. Build/test gates still apply.

Verified local93-file bundle on2026-09-23:
`C:/Users/grifm/AppData/Local/Temp/easy-news-release-3b3ef271-160a-4e48-b4ff-14e42bcfb61c`.
Manifest SHA25667b1b25435206a97ceb92fc71e46ee65e232c1036ae44927c919e488f0427f68;
image695dee699c05cb70ccfab153d6f7912988f9facfa25a7f7225756dadd806681e.
Actual HTML HTTP extraction/download/shutdown smoke passed. This tooling-only
candidate was NOT deployed; live image remains the staging-report release.
CI implementation/execution and immutable tested remote-image promotion remain
open parts of Task21, not satisfied merely by this source bundler.

## Candidate Linux image — 2026-09-22, built/tested locally, NOT deployed

The owner restarted Docker successfully (engine29.6.1/Linux x86_64). No targeted
socket repair/reset was performed. Candidate build and non-root parser preflight
now pass. Initial preflight caught Docker COPY changing the top bundle directory
to0755; the final stage now explicitly seals that directory0555.
`server/test-support/container-smoke.js`, mounted read-only, verifies real Linux
SQLite/schema21 startup, authenticated HTTP HTML extraction through the actual
sandbox, original download, unreviewed manifest, scratch cleanup and shutdown.
It runs as UID1000 with network disabled, all capabilities dropped and
no-new-privileges. Its only HTTP is container loopback; inputs/data are synthetic.
Independent release security review, volume permissions, backup/migration and
Railway-host verification remain required. Local Docker success is not a deploy.

`server/ops/Dockerfile.railway` is an explicit opt-in build recipe, not a root
Dockerfile silently changing the current Railway builder. It pins official Node
22.23.1 bookworm-slim linux/amd64 to digest
`sha256:8607a9064d4a571140998ae9e52a3b3fcf9cff361d04642d5971e6cd76d39e27`.
The [official tag metadata](https://hub.docker.com/v2/repositories/library/node/tags/22.23.1-bookworm-slim)
was checked on 2026-09-22. Apt dependencies are not snapshot-pinned, so this is
not a claim of byte-for-byte reproducible images. Audit the final image too.

From the repository root, once Docker is healthy:

```sh
docker build --platform linux/amd64 -f server/ops/Dockerfile.railway -t easy-news:release-candidate server
```

Run the parser preflight inside that image as its default non-root user, before
attaching production data or enabling intake:

```sh
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges easy-news:release-candidate node ops/check-parser-runtime.js /opt/easy-parser /opt/easy-parser.sha256 /tmp/easy-html
```

The same image must pass the PDF/OCR startup gate before PDF activation:

```sh
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges easy-news:release-candidate node ops/check-pdf-runtime.js /opt/easy-pdf /opt/easy-pdf.sha256 /tmp/easy-pdf-scratch
```

Reserved PDF paths are `/opt/easy-pdf`, `/opt/easy-pdf.sha256` and
`/tmp/easy-pdf-scratch`, configured with PDF_PARSER_BUNDLE,
PDF_PARSER_DIGEST_FILE and PDF_PARSER_SCRATCH. PDF_EXTRACTION_ENABLED remains
false until document fidelity, browser review, backup-first schema25 migration
and production-host gates pass. The official Dockerfile must compile the launcher
with `PARSER_SANDBOX_READONLY_SCRATCH`; omitting it reopens aggregate scratch
exhaustion and is not an approved release. Fontconfig uses a sealed bundle cache,
so parser children need no scratch writes.

Historical 2026-09-26 schema23 staged candidate (STALE; DO NOT DEPLOY) used source digest
`5ec49484cf30976d3577b8baea400613f420d9de7f65fc273d4dcc246766147f`
(108 files),
PDF bundle digest
`16339c525fab762d5049f2a70b64c2bb08a99a09fbf2562536ca6b43bb2f2932`
and image
`sha256:fdfd0008f534822d67cf2f275630cd6f028e650a8a5dee59c7ac01428f3daa0d`.
These identify superseded local evidence only, not a deployable, current, or
registry-retained artifact. The candidate predates schema24 and schema25 and
must not be promoted. Rebuild and rerun all applicable gates against fresh schema25 source
and image; separately rehearse the backup-first schema21→25 production migration.

The exact image also passed the local disposable Task07 corpus documented in
`docs/PDF_IMPLEMENTATION_NOTES.md`: multicolumn, table, footnote, redaction and
OCR contents matched their stored renders; encrypted/corrupt/cancelled inputs
failed closed; hostile filename/embedded-JavaScript probes caused no execution;
and scratch returned empty. This does not replace an editor-browser check or a
real-world/multilingual corpus review before public enablement.

This new check rejects root/capability-bearing service processes, non-root-owned
or writable parser files and trust records, unsafe ancestors, links, overlapping
paths, and non-private scratch. It verifies the pinned manifest and performs a
synthetic parse through the installed sandbox, including cleanup. A root-owned
sticky ancestor such as /tmp is allowed; arbitrary writable ancestors are not.
WSL verified 12 positive/negative scenarios using real UID1000 child processes.
The Docker preflight command above has now passed in the local candidate image.
The CLI is import-inert. Opt-in service startup now uses the same runtime loader
before listening; HTML_EXTRACTION_ENABLED remains false by default and in production.

Do not deploy merely because that build succeeds. Verify Linux SQLite, schema-21
fixture startup/shutdown, non-root execution, native sandbox policy, read-only
runtime ownership, scratch cleanup, and the excluded-context rules first. Docker
was initially unavailable but is now recovered; the specific container checks
listed above have passed. Broader adversarial/image-security checks remain. No
Railway builder setting was changed.

The build uses `node ops/build-parser-bundle.js <new-absolute-bundle-directory>
<absolute-compiled-launcher> <new-absolute-digest-file>` under Linux x64 Node
22.23.1. It rejects existing outputs, verifies the bundle, removes write bits,
and writes a separate checksum. Partial failed outputs are retained for inspection.
Verified in WSL: generated read-only bundle parses through the application wrapper,
scratch is cleaned, permissions are read-only, and repeat builds do not overwrite.
These modes alone do not constrain their owning UID. In the image the bundle and
trust record are root-owned; the service runs as `node` (UID 1000), not root.

Reserved image paths: `/opt/easy-parser`, `/opt/easy-parser.sha256`, and private
scratch `/tmp/easy-html`. Configure these through HTML_PARSER_BUNDLE,
HTML_PARSER_DIGEST_FILE and HTML_PARSER_SCRATCH respectively only after image
verification. HTML_EXTRACTION_ENABLED=true requires private ARCHIVE_PATH and
performs preflight before listening. Keep one process/replica: admission is one
active parser per process, with excess requests rejected rather than queued.
Shutdown cancels and drains parsing before database close. Production remains off.
No startup migration, database initialization or recursive live-volume chown is
performed. Before any production switch, verify that UID 1000 can access the
intended `/data` database/archive paths without broadening other permissions;
coordinate the backup-first v16→v21 migration and recovery/rollback plan. Preserve
historical `/data/data.db`. HTML extraction remains API-gated and paid workers off.

Follow-up: Docker Desktop start failed on its inference-manager socket at
`C:/Users/grifm/AppData/Local/Docker/run/dockerInference` (backend log, 2026-09-23
02:26 UTC). No reset or Docker data removal was attempted. Candidate image is
still unbuilt. Local schema 20 adds immutable extraction provenance; backend
483 tests/54 suites pass, including backup-first 16→20 fixture migration and
account preservation. This is not evidence that the live database was migrated.

Latest browser verification: Google sign-in succeeds at
`https://easy-news-research.netlify.app`, and the authenticated session survives
refresh. Opening `/editor` returns the visible message "Editor access is
required. Ask an operator to review your account permissions." Authentication
was verified separately from editor authorization. The owner then explicitly
approved editor access. A read-only production check found exactly one verified
Google identity (user 1) and exactly one active session user (user 1). The
operator provisioning function granted that identity the editor role and
recorded an audit event. Browser refresh of `/editor` then showed the empty
Topics list instead of the access-required error. No model flags were changed.

The entries below are chronological recovery evidence: earlier offline,
pending-approval and failed-upload observations are superseded by subsequent
successful entries. Reconfirm account state before acting on identifiers.

Owner subsequently confirmed an existing Railway Easy News app on the Hobby
plan. Reuse/recover that app; this does not authorize creating a duplicate,
upgrading the plan or deleting/replacing its data. Project/service/volume IDs,
deployment status and backups still require authenticated inspection.

Owner-provided Railway project: `e8d6fdb7-6468-4b4d-a074-200ba127a827`;
environment: `e3f4d555-96a3-44d9-bf3b-e87fcc7d4947`.
Opening that exact project in the available browser shows a Login button and
404 while signed out. This is not evidence that the project was deleted.
Authenticate to the owner's account before interpreting project availability.

Authenticated Edge inspection (2026-09-20) resolved the access blocker:
- Project display name `tranquil-dedication`, environment `production`.
- Existing service `-theeasy.news`, ID `35900e6b-6d99-477a-b104-21cde85264b5`.
- Service is offline with explicitly **no active deployment**. Visible history
  entries are REMOVED, not evidence of a current build failure.
- Latest visible deployment `4da19d72-e2c2-4798-9271-5185f97716fb` dates to
  2025-06-07 21:38 EDT; its details say deployment successful, now Removed.
  Historical source: `grifmang/-theeasy.news`, branch `main`, root `/server`.
- Historical public hostname: `theeasynews-production.up.railway.app`.
- Current settings show `/server`, deprecated Nixpacks builder, no configured
  healthcheck, one replica in US East. No deployment/settings changes made.
- No volume was visible in the inspected architecture/settings. This is not
  proof that backups or detached storage do not exist; recovery is unresolved.
  Do not press Deploy Repo: it would deploy the remote branch, not the local
  uncommitted rebuild, and would not establish safe data persistence.

Subsequent official Railway CLI 5.58.0 login succeeded. Local directory linked
to the exact project/environment/service above; `railway volume list --json`
returned `{"volumes":[]}`. No persistent volume exists in this environment.
This does not rule out separately exported backups. Owner authorizes rebuilding
the backend; a specific new-volume/fresh-database and $10/month usage-target
question is pending. No remote storage, deployment or variables changed yet.

Owner approved fresh database/persistent volume and a $10/month Railway usage
target. Created and verified Ready volume `0cd3b50b-6768-4bca-b17e-587af480cf2a`,
name `-theeasy.news-volume`, mount `/data`, capacity 5000 MB, attached to existing
service. The target is not an enforced billing cap. Initialized a clean local DB
using init-db at `C:/Users/grifm/AppData/Local/Temp/easy-news-init-049cce21-2681-4131-a9dd-25eef15109ff/easy-news.db`.
Upload to volume-relative `/easy-news.db` (without overwrite) failed because
Railway SSH key authentication is not configured. No DB upload or deployment
has succeeded; no old data was deleted. Next: configure scoped deployment SSH
access, upload/verify DB and originals directory, then configure and deploy.

Owner approved dedicated account-level SSH key. Registered public key named
`Easy News deployment`, fingerprint
`SHA256:qx0A8ZoGRF8QdZo+GdAAyPJlqR6CzMPav+2QZPN6I6w`.
Private key remains at `C:/Users/grifm/.ssh/easy-news-railway`, outside the repo;
never copy it into build context or logs. Corrected PowerShell empty-passphrase
quoting on this newly generated key; unattended CLI authentication now succeeds.
Fresh DB uploaded successfully to volume-relative `/easy-news.db` with
`overwritten:false` (runtime path `/data/easy-news.db`). Service-instance ID
returned by uploader: `9779d9af-1052-4175-83b7-665ff79c4dc5`.
Backend code/config deployment and originals-directory setup remain pending.

Post-upload listing verifies `easy-news.db` (299008 bytes) and unexpectedly
also shows `data.db` (40960 bytes, modified 2026-09-20T19:26:43Z). Neither was
overwritten. Inspect current deployment status and safely back up/inspect
`data.db` before choosing runtime DB_PATH; do not assume it is historical data
or disposable. A deployment may have been triggered outside the upload flow.

Confirmed volume attachment triggered remote-main deployment
`d8a36b62-237d-4233-8ffe-591a23184d17` at 19:26:06Z (commit `7a636001`).
It was RUNNING/SUCCESS; previous no-deployment statements are superseded.
Created `/data/originals` through authenticated SSH. Set production DB_PATH to
`/data/easy-news.db`, ARCHIVE_PATH to `/data/originals`, all three model/publication
flags false, both microdollar budgets zero, Node version 22; used skip-deploys.
Uploaded local server rebuild with `railway up <absolute-server-directory>`:
deployment `19c08360-248b-4510-98b7-ef6e1b6ae006`, last observed BUILDING.
Do not assume readiness until deployment and public health checks pass.

Rebuild deployment `19c08360-248b-4510-98b7-ef6e1b6ae006` subsequently reached
SUCCESS. Runtime logs show `node index.js` and port 4000. Public HTTPS
`/health/ready` returned `{"status":"ready"}`; unauthenticated
`/api/v1/editor/topics` returned HTTP 401. Backend deployment is operational,
not full product completion. Frontend, authenticated end-to-end testing, proxy
limits, billing controls, backups, remaining security and editorial/accuracy
release gates are still outstanding. Public backend endpoint is reachable;
do not describe this as hosting-level private staging.

Netlify frontend deployed successfully to `https://easy-news-research.netlify.app`
(site `fdd1496b-3ae0-4977-9473-8e7835660517`, deployment
`6ab03780f09963e5e8fa10f3`). Added forced `/api/*` reverse proxy before SPA
fallback in netlify.toml; browser API base remains same-origin. Frontend build
uses the existing backend Google public client ID, no provider secrets.
Backend ALLOWED_ORIGINS includes exact Netlify origin; redeployed existing
rebuild image as `e110d18a-45c2-403a-a89e-de1a4c259ee1` to apply it.
Verified proxied `/api/articles` returns JSON empty results rather than HTML;
deployed browser login page renders password and Google controls. No published
articles are seeded. Owner Google sign-in, editor provisioning and authenticated
research workflow remain unverified. Domain/DNS unchanged. Public URLs are not
hosting-level private; do not claim private staging or full production readiness.

Deployed Google button check opens Google's `origin_mismatch` error for
`https://easy-news-research.netlify.app`. Existing OAuth client ID:
`582298281161-s3q6jk5af046fqlti8vun9qrf9ro5plk.apps.googleusercontent.com`
(public identifier, not a secret). Requested owner approval to add precisely
that JavaScript origin while preserving existing origins; approval is pending.
No Google account sign-in succeeded, no editor role provisioned, and no Google
Cloud configuration changed. Do not retry authentication until origin approval
and configuration are resolved; do not weaken server audience verification.

Owner approved origin change; applied to the exact configured client in project
`easynews-1749329457844` (project number 582298281161). There is another project
named easynews (`easynews-463600`) with a different client; it was not changed.
Google displayed `OAuth client saved`. Authorized JavaScript origins now include
the existing `https://theeasy.news` and added
`https://easy-news-research.netlify.app`; no redirect URIs/secrets changed.
Fresh deployed browser retry reaches Google's account chooser instead of
origin_mismatch. Account selection/consent and application session verification
remain pending owner sign-in; no editor role has been provisioned.

## Immediate deployment gates

- Reuse the owner's Netlify account. The latest authenticated listing returned
  17 sites, with no matching Easy News name or `theeasy.news` custom domain.
  This does not prove deletion or rule out another account.
- Resolve backend hosting and recoverable data before creating a replacement.
  No local Railway CLI/auth configuration was found. Do not initialize over
  existing data or assume a new hosting subscription is authorized.
- Keep staging access restricted at the hosting layer; editor authorization
  alone does not make the entire deployment private. Verify both frontend and
  direct backend access restrictions, not merely an unadvertised URL.
- Use a same-origin `/api/*` proxy ahead of the Netlify SPA fallback, targeting
  the verified backend. Leave `REACT_APP_API_URL` unset for this topology.
  Current production cookies are `__Host-` scoped, Secure, HttpOnly and
  SameSite=Lax: direct cross-site calls from `netlify.app` to a separate backend
  domain will not provide the intended session transport. Do not weaken cookies
  to work around this. The proxy is not configured yet because its target is
  unknown; verify login, session restoration, logout and CSRF through it.
- Validate trusted proxy/client-IP handling against the actual host topology
  before release. The current Express app does not configure `trust proxy`;
  shared proxy addresses can cause shared rate limits. Never enable blanket
  proxy trust without testing spoofed forwarding headers and direct access.
- Current readiness is a research workspace, not the finished public product.
  Source/archive connectors, grounded writing, publication/corrections controls,
  independent accuracy evaluation, dependency-security triage, restore testing
  and deployed end-to-end verification still need completion. Private staging
  is a milestone, not satisfaction of the complete production plan.

## Evidence and unknowns

Implementation update: classification runtime is now available but remains opt-in.
Keep `CLASSIFICATION_ENABLED=false` during restoration and fixture checks. Enabling
it requires a server-side `TYPESAFE_API_KEY`, positive integer-microdollar
`DAILY_BUDGET_MICROS`/`MONTHLY_BUDGET_MICROS`, current verified price catalog,
migrated database, and editor approval of each job's exact provider input.
The loop processes one job at a time per process. Start with one backend replica;
do not infer an account-wide concurrency limit from a per-process loop.
Shutdown aborts/drains classification before closing the database. Leave
`GENERATION_ENABLED=false` and `AUTO_PUBLISH_ENABLED=false`; no production
accuracy, content or deployment gate has been passed by the fixture tests.

Netlify account inspection showed no listed project matching this repo/domain.
The local repo has no linked Netlify site. Existing DNS zone
`6737d7a74d832f80e18c5207` (`theeasy.news`) has `site_id=null` and only
`_atproto.theeasy.news` TXT. Public apex A lookup returned no address; www CNAME
lookup returned NXDOMAIN; both HTTPS fetches failed. These findings explain
the domain's unavailability. Site deletion is plausible but not proven.

The API listed zone nameservers `dns1.p03.nsone.net` through
`dns4.p03.nsone.net`. A public response named `dns1.p01.nsone.net` as the SOA
primary. These are different kinds of evidence: verify parent NS delegation
and registrar settings rather than inferring delegation from SOA. Preserve the
existing TXT record and any records discovered later.

README describes Netlify frontend plus Railway API. Backend service identity,
URL, data volume, database backups, and scheduler deployment are unknown.
Recover those before creating replacements. Do not seed over recovered data.

## Stage 1: inventory and recovery

1. Use read-only account listings to locate any existing project by repository,
   custom domain, or historical name across accessible accounts. Reuse a
   matching project; record site/service IDs and URLs in an operator inventory.
2. Inspect the existing DNS zone, parent NS delegation, and registrar settings.
   Export records before editing. Do not create a duplicate zone automatically.
3. Locate the backend and volume; take a consistent SQLite backup using a
   backup mechanism that accounts for WAL. A raw live-file copy is insufficient.
   Restore to an isolated environment and verify schema/counts/readability.
4. If no data is recoverable, record that explicitly before initializing a new
   database. Record any data-loss decision with the owner.
5. Inventory secrets by name/presence only. Never paste credentials into docs,
   terminal logs, frontend variables, or model state.

Read-only local checks:

```powershell
git status --short
git remote -v
netlify status
netlify sites:list
Resolve-DnsName theeasy.news -Type NS
Resolve-DnsName theeasy.news -Type A
Resolve-DnsName theeasy.news -Type AAAA
Resolve-DnsName www.theeasy.news -Type CNAME
```

Inspect DNS records via the authenticated provider account; scope output to
this domain rather than retaining unrelated account data. Compare an
authoritative nameserver response with a public resolver when resolving a
delegation discrepancy. Use `fetch_markdown` for web-content HTTP checks.

## Stage 2: build and staging configuration

The existing Netlify configuration assumes base directory `theeasynews`, build
command `npm run build`, publish directory `build`, and Node 22. Confirm those
settings relative to the selected base directory; the root package builds no
frontend. Retain SPA rewrites for direct route refreshes. Reassess the toolchain
during the rebuild before adopting these as permanent production settings.

Existing variables:

| Location | Variable | Requirement |
|---|---|---|
| Backend | `NODE_ENV` | `production` for Secure production session cookies |
| Backend | `DB_PATH` | Required absolute path to an existing migrated DB on persistent storage |
| Backend | `ARCHIVE_PATH` | Existing absolute directory on persistent storage; required for text evidence import |
| Backend | `PORT` | Host-provided port or default 4000 |
| Backend | `CLASSIFICATION_ENABLED` | `false` during staging; no provider calls |
| Backend | `GENERATION_ENABLED` | `false`; generation worker is not implemented |
| Backend | `AUTO_PUBLISH_ENABLED` | `false`; startup rejects automatic publication |
| Backend | `DAILY_BUDGET_MICROS`, `MONTHLY_BUDGET_MICROS` | `0` during staging |
| Backend | `GOOGLE_CLIENT_ID` | OAuth audience when login is enabled |
| Backend | `ALLOWED_ORIGINS` | Comma-separated exact approved frontend origins |
| Frontend build | `REACT_APP_API_URL` | Unset for verified same-origin API proxy; not an unrelated backend origin |
| Frontend build | `REACT_APP_GOOGLE_CLIENT_ID` | Public OAuth client ID, never a client secret |

`TYPESAFE_API_KEY` is implemented but unnecessary with classification disabled;
do not install provider secrets for initial staging. Model/policy versions are
pinned in code. `JEV_MODEL`, `WRITER_MODEL`, `REVIEW_MODEL`, `DECISION_MODE`,
`MAX_JOB_ATTEMPTS`, `DAILY_MODEL_BUDGET_USD`, and `MAX_ARTICLES_PER_CYCLE` are not
supported runtime controls. Do not rely on them to enforce cost or behavior.

Frontend variables are compiled into public JS; changing the API URL requires
a rebuild. Keep provider keys only in backend secret storage. Configure the
Google OAuth allowed origins for staging and production separately.

For an initial SQLite deployment, use one backend service with one persistent
volume. `npm start` launches the API and starts the classification loop only
when explicitly enabled. It does not run ingestion. Keep the separate scheduler
off during initial staging. `npm run schedule` starts
an immediate ingestion-only cycle and requires a migrated absolute DB_PATH.
It queues classification without calling models. Use mocked feeds for tests.
Avoid independent services with separate SQLite disks. If multiple replicas
become necessary, redesign persistence/worker coordination before scaling.

## Stage 3: release prerequisites

Implemented local safeguards include session expiry, editorial authorization,
immutable evidence, leased jobs, bounded classification spend, hidden legacy
articles, readiness/liveness endpoints, graceful shutdown and explicit migration
commands. These do not prove deployed safety or model accuracy. Complete the
immediate deployment gates above and the full production-plan release gates.
Stop writers before migrating a database; validate backup and restoration on
the selected persistent volume before using real research data.

Use isolated staging data and mock providers first. Run the commands in
[../AGENTS.md](../AGENTS.md) for backend/frontend tests and the frontend build.
Then verify the implemented migrations against a restored fixture and test the
entire source → decision → draft → review → publication flow in staging.
Live evaluation requires provider access and a bounded authorized budget.

Acceptance before domain cutover:

- Frontend builds and direct `/articles/:id` refresh works.
- API readiness reports DB/schema availability without requiring model uptime.
- Browser reads return JSON from the correct backend, with approved CORS.
- Login/save operations enforce ownership; editorial writes require a role.
- Unpublished versions cannot be read through public list or detail routes.
- Model outage leaves jobs pending and published content available.
- Backup restoration and worker restart recovery have been demonstrated.
- Shadow evaluation is recorded; automatic publication stays disabled until
  its separate evaluation gate passes.

## Stage 4: authorized public restoration

At the later launch, explicitly confirm publication/DNS scope. Deploy the
verified backend first with jobs disabled; apply tested migrations once; check
readiness. Deploy the frontend with its backend URL and verify on the hosting
preview before attaching `theeasy.news`.

Attach the domain to the selected Netlify site and reuse the existing DNS zone
where possible. Obtain required records from the current provider UI/API;
do not copy historical IP addresses or assume old nameservers remain correct.
Update registrar delegation only if authoritative checks establish it is needed.
Preserve the `_atproto` TXT record. Configure one canonical hostname and redirect
the other, include intended origins in CORS/OAuth, and wait for DNS and TLS
validation. Verify apex/www, HTTPS certificate, redirects, direct routes, API
reads, and authenticated save behavior from the public site.

Enable the single worker with conservative job/spend caps and manual publication
first. Observe retry rates, queue age, token usage, decision distributions,
editorial workload, and errors. Enable automatic publication only for evaluated
decision/risk classes. Record exact release commit, model/policy versions,
environment configuration names, backup reference, and deployed IDs.

## Rollback and recovery

Runtime configuration follow-up: service settings now specify `node index.js`,
healthcheck `/health/ready`, 120-second healthcheck timeout and 15-second drain.
Fresh upload `379e13bc-d330-45e8-977a-5c3f4bf797b0` has these values in its effective
deployment manifest. CLI redeploy reused the prior manifest, so it did not apply
the changed settings; use a fresh upload when changing these settings. An attempted
`server/railway.json` was not detected under the upload layout and was removed
locally; the explicit service settings are authoritative. This change addresses
the npm signal wrapper, not the separate proxy warning or proven email causality.

Follow-up crash investigation: replaced deployments `19c08360-248b-4510-98b7-ef6e1b6ae006`
and `e110d18a-45c2-403a-a89e-de1a4c259ee1` logged npm SIGTERM errors immediately
after Railway's Stopping Container events at 19:44 and 21:14 UTC respectively.
These coincide with replacement deployments, but email-to-event correlation is
not proven. A direct-node subprocess probe on Railway, using a fresh isolated
temporary fixture DB and port 0, reached readiness and exited with code 0 after
SIGTERM. It did not stop the live service or touch its database. This supports
testing a direct `node index.js` deployment start command instead of the npm
wrapper; it does not establish that all crash alerts are benign.
The separate ERR_ERL_UNEXPECTED_X_FORWARDED_FOR warning is caught/logged by
express-rate-limit, not rethrown; trusted-proxy configuration remains unresolved.

Reported crash-email investigation, 2026-09-20: the owner received a Railway
deployment-crash notification. At inspection, latest deployment
`45a5d275-bbe6-4ebc-b8aa-6ea7cdfe9e5c` reported SUCCESS; its runtime logs showed
the server listening on port 4000 and dependency deprecation warnings, not a
crash trace. Backend `/health/ready` returned `{"status":"ready"}` and Netlify
`/api/articles` returned the expected empty JSON collection. No FAILED/CRASHED
entries were present in the returned CLI deployment list (not an exhaustive
historical audit). The email timestamp/deployment link is needed to correlate
the reported event. Cause remains unknown; no restart, rollback, or speculative
fix was performed. Current health does not disprove a prior transient crash.

Backup-only command (deployed 2026-09-20):
`npm run backup-db --prefix server -- <absolute-source-db> <absolute-new-snapshot>`.
Use an existing private operator-controlled destination directory. The command
opens the source read-only, uses SQLite's online backup API (including committed
WAL data), refuses existing destinations, and checks snapshot integrity and
foreign keys. It does not migrate, start jobs, encrypt, upload, or copy originals.
A failed attempt may leave a partial snapshot: never use it after a nonzero exit;
retain it for inspection and retry with a different new filename. Treat snapshots
as sensitive account/session data. This command alone is not off-site recovery.
Targeted backup/storage/migration regression: 18 tests / 3 suites passed locally.
Full backend regression subsequently passed 284 tests / 38 suites. Railway
deployment `45a5d275-bbe6-4ebc-b8aa-6ea7cdfe9e5c` reported SUCCESS. No production
backup was created by the deployment itself; the command requires an explicit
operator invocation and independent storage remains unfinished.

Subsequent operator invocation created and integrity-checked the first live
snapshot at `/data/backups/easy-news-20260920-post-editor.db`; its parent directory
was restricted to mode 0700. The source database was not migrated or replaced.
This same-volume snapshot is not protection against volume/account loss and
does not satisfy the independent encrypted backup or fresh-environment restore
gate. Do not expose or commit it: it contains account/session information.

Recovery verification checkpoint, 2026-09-20: targeted local storage,
migration-guard, initialization, and editor-provisioning suites passed
(34 tests / 5 suites). These include SQLite backup restoration of evidence
and pending jobs. This is fixture-level evidence only, not a production restore
rehearsal. `server/migrate.js` creates a backup and then migrates the source DB;
do not use it as a read-only production backup command. Daily encrypted backup
upload to independent private storage, retention, alerting, and measured
production RPO/RTO remain unimplemented release gates (plan task 22).

On publication-quality or spend regression, disable automatic publication and
new generation immediately while keeping published reads available. Quarantine
affected article versions for review. On model regression, restore the previous
tested model/policy pair or remain in manual review; do not assume another model
is behaviorally compatible.

Restore the prior frontend deployment and a schema-compatible backend release.
For a genuinely new database only, run from the repository root:
`npm run init-db --prefix server -- <absolute-new-database-path>`.
The parent directory must already exist. The command refuses existing files;
do not delete one to make it succeed. If initialization fails, inspect the
retained file. Existing data uses the backup-first migration path instead.
Initialization creates no claims, publications, accounts, or model calls.

Prefer additive migrations so old code remains usable during rollback. If a
database restore is necessary, stop writers, capture a backup of the current
state, restore a verified snapshot, and account for post-backup writes before
resuming. Never silently replace current user data with an old backup.

DNS rollback uses the exported records and the previous known-working host;
this current broken domain configuration is not a useful availability fallback.
Account for resolver TTLs and verify TLS again. Record the incident and recovery
evidence in a short dated worklog entry, without credentials or raw user data.

## Encrypted Windows recovery checkpoint — 2026-09-23 UTC

Owner approved an encrypted copy on this PC. Verified pre-cutover artifact:
`C:/Users/grifm/AppData/Local/EasyNews/recovery/easy-news-2026-09-23T03-17-09-645Z-9df41dd6-d07d-46b2-bec5-90ef70d3a051.db.age`.
Ciphertext SHA256: `912d762863291cd313b2a359ae457bec6d23da71bc44d91cc8680458defc0da6`.
Its `.json` sidecar records successful decrypt/in-memory SQLite integrity/FK checks
and migration16→21 with account/role counts preserved. Live DB was not migrated.
Two earlier encrypted candidates have no verification sidecar; do not promote them.

The recovery directory is outside OneDrive/git, with ACL inheritance removed and
access limited to the current Windows user and SYSTEM. `identity.dpapi` contains
the age private identity protected by Windows DPAPI CurrentUser; `recipient.txt`
is public. No plaintext database or private-key file was written locally.
Recovery depends on retaining this Windows profile. This is not portable key
escrow, scheduled backup retention, or proof of a measured recovery-time target.

Portable age1.3.2 binaries reside under
`C:/Users/grifm/AppData/Local/EasyNews/tools/age-1.3.2/`.
Official Windows amd64 ZIP SHA256 was verified:
`f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7`.
`server/ops/windows-recovery.js` encrypts and restore-checks without logging data
or keys. `server/ops/backup-railway-to-windows.js` is a one-off explicit operator
export. Its current source guard and snapshot destination use
`/data/research/easy-news.db` and `/data/research/backups`; the historical
`/data/easy-news.db` is a preserved schema16 rollback source, not the active DB.
The exporter refuses nonempty `original_objects`, so it does not back up archived
files. Do not treat it as the scheduled independent encrypted backup system,
which remains unimplemented. Never print child output, decrypted data, identity
bytes or credentials during diagnostics.

SQLite backup copies are normalized to DELETE journal mode before export; source
WAL mode is unchanged. This fixes standalone/in-memory reopening of WAL snapshots.
This backup precedes the writer stop; take a final consistent backup during cutover.

Release remains pending: production root owns `/data`0755 and DB0644; new container
UID1000 needs a separately prepared private directory (proposed `/data/research`).
Preserve historical `/data/data.db` and all old snapshots. Do not recursively chown
the volume or copy a live database. Explicit MAINTENANCE_MODE=true starts no DB and
rejects application traffic503; its health200 expressly says maintenance, not ready.
Confirm old writers stopped before the final snapshot/migration. Setting variables
with CLI `--skip-deploys` avoids an accidental old-image restart against new paths;
verify builder/root-directory context before uploading. No such changes made yet.
Rebuilt image `sha256:2c4b03110966e649c984a6108a1f5fa869137cf031ad915eb2336e87f8d5a3b2`
passed actual extraction HTTP and maintenance/no-DB smoke checks as UID1000 with
network none, no capabilities and no-new-privileges. Backend533 tests/57 suites pass.
Models and ingestion remain disabled; this does not satisfy public-release gates.

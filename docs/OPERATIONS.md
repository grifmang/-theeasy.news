# Operations

This page describes the local schema33 operator controls and the recovery work
still required before they can be relied on in production. A schema33 image
artifact has been built and verified locally, but hosted Linux CI and deployment
gates remain open. The deployed Railway runtime and database remain schema21.
See the current release boundary in [DEPLOYMENT_RUNBOOK](DEPLOYMENT_RUNBOOK.md)
and artifact evidence in [RESUME](RESUME.md).

## Work admission status and controls

The editor panel shows whether new claim, fetch, rebuild, and analysis
verification work is admitted, the state version, bounded active-lease and
backlog counts, and operational alerts. Counts are capped at 1,000; a capped
value means at least that many rows, not an exact total. A read-only guard peek
is included. Backup age is
reported as unknown because no current backup-age integration exists.

The editor API is session-authenticated and requires the existing editor role
and CSRF protection on writes. Every editor currently has operator authority.
The actor is taken from the authenticated session; clients cannot choose it.

`GET /api/v1/editor/work-admission` returns `200` with a private, no-store JSON
status object:

```json
{
  "state": "running",
  "version": 4,
  "changedAt": 1790000000000,
  "draining": false,
  "activeLeases": { "claim": 0, "fetch": 0, "rebuild": 0, "analysisVerification": 0, "capped": false },
  "backlog": { "claim": 0, "fetch": 0, "rebuild": 0, "analysisVerification": 0, "capped": false },
  "alerts": [{ "kind": "backup_age_unknown", "severity": "warning" }],
  "backupAge": { "status": "unknown" }
}
```

Pause or resume with `POST /api/v1/editor/work-admission/pause` or
`POST /api/v1/editor/work-admission/resume`. The request requires the version
read from the latest status, an operator reason (1–500 characters), and a
unique request ID (16–128 letters, digits, `_` or `-`). Never include secrets or
personal data in the reason.

```json
{
  "expectedVersion": 4,
  "reason": "Pause new work while investigating elevated provider failures",
  "requestId": "3fd7ce0a-523f-4aa0-a7ad-65f2be9fa3f1"
}
```

A new transition returns `201` and `{ "status": "recorded", "admission": … }`.
An exact retry with the same request ID and payload returns `200` and
`status: "already_recorded"`. A stale version or a request ID reused with a
different payload returns `409`; validation errors return `400`. Read status
again after a conflict and make a fresh decision with a new request ID. The
server stores an immutable audit event and hashes the request ID.

Pausing stops new dispatch. It does not cancel provider calls, fetches, or other
work already in flight. Status reports whether active leases remain and will
show `draining: true` while any are reported. Claim, fetch, and rebuild lease
fences protect ownership; short immediate transactions fence the final
pre-send boundary. Work denied before send is settled `not_billed`. Eligible
claim jobs receive deadline credit for the pause interval. Retry readiness and
backoff remain part of eligibility, and dispatched jobs do not receive pause
credit. Confirm the actual state and active leases before maintenance or
restoration.

## Publication editor API status

Local authenticated editor routes now expose publication state, review,
publish/correct actions, and owner-only retraction. Every request is bound to
the session actor and the editor API's CSRF protection. Responses are
private/no-store and use allowlisted DTOs; they do not expose raw reports,
private evidence, request hashes, or owner lists. Router and pre-router errors
are sanitized. This is an editor control API, not a delivery guarantee. Local
Task17 public reads now exist separately but are default-off and staging-only:
they require `PUBLIC_READ_ENABLED=true`, the private exporter, and a live
reconciled sink. Unavailable or lost sink admission returns `503` with no-store
caching while editor and health routes remain available. This is not public
cutover approval.

- `GET /api/v1/editor/claims/:id/publication-state`
- `GET /api/v1/editor/analysis-versions/:id/publication-state?reportId=:reportId`
- `POST /api/v1/editor/analysis-versions/:id/publication-reviews`
- `POST /api/v1/editor/analysis-versions/:id/publication-actions`
- `POST /api/v1/editor/claims/:id/publication-retraction`

Review writes require exactly `reportId`, `expectedDraftSha256`,
`expectedReportSha256`, `expectedCheckedVersionHash`, `expectedDtoSha256`,
`expectedReviewEventId`, `decision`, `reason`, and `requestKey`. Action writes
require exactly `action` (`publish` or `correct`), `reviewEventId`, those four
expected hashes, `expectedGeneration`, `expectedHeadEventId`, `reason`, and
`requestKey`. Retraction requires exactly `expectedGeneration`,
`expectedHeadEventId`, `reason`, and `requestKey`; it remains available when
claim state independently blocks preview. CAS conflicts and reused keys with
different payloads return sanitized `409`; malformed requests return `400`,
missing records `404`, authorization failures `403`, and publication blockers
`422`. Actual publish remains blocked while coverage is incomplete. There is no
release-desk UI or public route yet.

Use `null` for an absent current review event or manifest head in the matching
expected-ID/generation fields. `requestKey` is 16–120 ASCII letters, digits,
`_`, or `-`; retrying with the same key and payload is idempotent, while
reusing the key with a different payload conflicts. Review `decision` is
`approved` or `rejected`. Successful write requests return `201` with only a
review or event summary.

## Recovery readiness

The global pause is an admission control, not a backup or a process shutdown.
For database maintenance, stop all writers using the deployment's approved
maintenance procedure, then take and independently verify a consistent SQLite
backup. Do not copy a live database file or restore over newer user data without
accounting for writes since the snapshot.

Task22 recovery gates are incomplete: independent scheduled encrypted backups,
retention of 7 daily and 4 weekly snapshots, portable recovery-key custody,
delivered failure/age alerts, a current fresh-host restore, and measured RPO
and RTO. Backups of archived originals and reconciliation are also missing, as
are Task16 publication/outbox/invalidation restore checks. The encrypted Sep23
backup is historical. The encrypted 2026-09-30 schema21 snapshot recorded in
RESUME is the current manual pre-migration recovery point. Synthetic and real
encrypted restores both passed in fresh local containers through schema33; the
real artifact preserved the source and canonical identity tables. This rehearsal
uses the current Windows profile and local Docker, so it does not prove portable
key custody or a measured fresh-host RPO/RTO. See the RESUME checkpoint for
artifact/image/manifest identities and cleanup evidence.

The Windows `EasyNewsEncryptedBackup` scheduled task has now completed a verified
run: daily 03:00 with `StartWhenAvailable`, `IgnoreNew`, and current-user
Interactive/Limited execution. The scheduler previously failed because Codex
packaged-app virtualization mapped the interactive AppData alias to a physical
package-cache path; the operator script now uses the physical recovery and age
paths. The 2026-09-30 artifact and hash, status timestamp, and retention result
are recorded in RESUME. Redundant verified encrypted copies, including the prior
01:35 generation, were removed by retention; the current verified recovery point
remains. Two older sidecar-less Sep23 encrypted files are preserved for manual
review. This proves scheduled execution on this Windows profile only. It does
not establish fresh-host key recovery, key escrow, alert delivery, or archived
originals backup; backup age in the editor status remains unknown.

Railway's authenticated Backups page reports that creating backups and enabling
PITR require the Pro plan. The current Hobby/$10 target therefore does not supply
the independent scheduled backup system; do not count the Railway volume or an
inactive platform control as a second recovery copy. No plan upgrade is approved.

The active production database path is `/data/research/easy-news.db`.
`/data/easy-news.db` is a preserved schema16 rollback source. Local code requires
schema33 while production remains schema21. Any release requires a fresh
matching image and a coordinated backup-first schema21→33 migration, with a
rollback image compatible with the retained pre-migration backup. Authenticated
editor analysis-version/job/permission/report routes and the Research Desk review
UI are implemented locally. Drafts and reports are integrity checked; permission
changes compare the expected event ID and exact admission hash. The parser is
capped at 300 KB and rejects inflation. Queueing does not authorize execution.
An explicit `ANALYSIS_VERIFICATION_ENABLED` bootstrap path now exists but is
strictly off by default and only permits exact staging configuration with
validated budgets, token limit, and fail-closed shared guard. It accepts only
the durable-budgeted adapter and runs one serial worker with a 30-second lease;
there is no automatic permission or recovery. Shutdown drains before database
close. All editors currently have operator authority, no live call has occurred,
and runtime remains off. Provider auth/config failures currently terminal
analysis jobs; existing recovery covers claim jobs only. Task16 adds audited,
owner-gated publication state and a private filesystem exporter/outbox worker
locally. Export activation is exact staging-only and default-off. Canonical DB
and root identity, an exclusive process lock, O(1) head, immutable history,
installed-generation proofs, and exact startup reconciliation protect delivery.
Latest-review and final-pause fences reject stale publication while allowing
invalidation. Interrupted pending/link work can recover and replay; Linux
directory fsync errors fail closed, production Windows activation is rejected,
and DTO/object writes precede the final SQLite transaction. Coverage still
blocks actual publish. The local public read API is fail-closed behind the
staging sink-admission gate; no public/CDN purge or production public activation
exists, and there has been no real production integration, deployment, or
paid/live model call.
Do not opt in before
isolated staging resources and credentials plus adversarial, accuracy, and
rendered-fidelity evaluation. See the
[deployment runbook](DEPLOYMENT_RUNBOOK.md) and latest [resume checkpoint](RESUME.md).

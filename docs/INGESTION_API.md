# Editor ingestion API — local implementation

The local implementation requires schema25; live Railway remains schema21.
All routes below are under `/api/v1/editor` and require an authenticated editor.
POST requests also require the existing allowed Origin and session CSRF token.
No endpoint accepts a client-supplied actor, source policy, lease, extraction text,
or redirect continuation. Responses never include worker lease tokens.

## Claim proposal and research records (local schema24; not deployed)

`POST /claims` accepts an attributed proposal and its initial explicit context.
The server supplies the actor from the authenticated session. Original wording is
stored as submitted; normalized wording is a separate context field and does not
replace it.

```json
{
  "topicId": 12,
  "original": "The exact attributed assertion",
  "attribution": "Named speaker or source",
  "originUrl": "https://example.org/report",
  "qualifiers": {
    "normalizedWording": "A carefully scoped paraphrase",
    "observedAt": null,
    "entities": [],
    "timeframe": null,
    "location": null,
    "reason": "Initial context and normalization rationale"
  }
}
```

All six qualifier keys are required; nullable values must be explicit. A new
proposal returns201 with `{ claim, context, version, state }`. Repeating the exact
proposal by its original actor while its initial context and unreviewed state are
unchanged returns the same logical proposal. A colliding proposal that differs,
or whose state/context has changed, returns409. Invalid fields return400 and an
unknown topic returns404. Proposal creation is atomic; the API does not decide
whether the assertion is true or authorize publication.

Claim detail includes a research projection: active relationships and their
append-only history, per-dimension coverage, recorded search attempts/outcomes,
and evidence-packet gaps. Coverage has six dimensions and is bound to the claim's
current context version; after context changes, old coverage is exposed as stale
and projects as unknown for the new context. `component_of` links are accepted
only when their context-bound constraints hold. Relationship corrections and
revocations append history; they do not rewrite prior events. These records help
editors organize research. They are not findings of truth, completed searches,
or publication approval.

Related routes: GET/POST `/claims/:id/relationships`; POST
`/claims/:id/relationships/:relationshipId/revoke`; POST
`/claims/:id/relationships/:relationshipId/correct`; GET/POST
`/claims/:id/search-attempts`; GET/POST `/claims/:id/coverage-events`; and GET
`/claims/:id/evidence-packet`. Writes require editor authentication and CSRF.
They return201 on append, 400 for invalid fields, 401/403 for auth/role/CSRF
failures, and409 for stale context, stale expected event, or idempotency-key
collision. Request IDs make matching retries idempotent where supported.

## Operations

| Method and path | Input | Result |
| --- | --- | --- |
| POST `/topics/:id/fetch-jobs` | `{ "sourceId": "operator-policy-id", "url": "https://approved-host/document" }` | 201: queued or existing matching job |
| GET `/topics/:id/fetch-jobs?after=123` | Optional positive cursor; omit for first page | Up to 100 jobs in ascending ID order |
| GET `/fetch-jobs/:id` | Job ID | `{ job, receipt, extractionAvailable }`; receipt is null until completed |
| POST `/fetch-jobs/:id/extract` | `{}` | 201: preserved research document; private text/plain or explicitly enabled text/html |
| POST `/documents/:id/source-chain/parents` | `{ "parentId": 123, "reason": "Republishes the parent report" }` | 201: immutable actor-attributed link and bounded ancestry projection |

Submission returns 503 when ingestion is not configured, 404 for missing topics,
and 400 for invalid/unapproved targets. Extraction returns 409 before download
completion, 422 for unsupported MIME or metadata-only retention, and 503 when
original storage is unavailable. Missing jobs return 404. Authentication failures
return 401, and reader/CSRF failures return 403. Disabled/stopping HTML extraction
returns 503; a busy HTML parser returns 429 with Retry-After: 1. No automatic
request queue or retry is created. Client disconnect cancels HTML parsing.

`fetched` means a download receipt was committed, not that extraction, factual
assessment, or publication occurred. Extraction is repeatable without duplicating
the same document/retrieval. It assigns kind `other`; editors must not interpret
that as a substantive evidence classification. URL-based origin grouping does
not establish independent sourcing. No JEV or writer call occurs in this flow.

### Source-chain provenance (local schema23; not deployed)

Document detail includes `sourceChain` with direct parents, transitive ancestors,
roots and immutable audit links. Editors can record a parent document and reason;
the actor always comes from the authenticated session. Self-links, cycles,
conflicting retries and non-editor actors reject. The connected component is
bounded transactionally before commit at1001 documents,2000 links and1MB of
reason text; individual reasons are at most8000 bytes. Evidence packets expose a
deduplicated projection with a separate aggregate reference cap, but continue to
report `source_independence_unverified`. An ancestry link is not evidence that
either document or claim is true.

## Runtime controls

HTML_EXTRACTION_ENABLED defaults to false. Opt-in startup requires ARCHIVE_PATH
and operator-provided HTML_PARSER_BUNDLE, HTML_PARSER_DIGEST_FILE and
HTML_PARSER_SCRATCH. Before listening, the service checks non-root execution,
zero Linux capabilities, root-owned sealed runtime/digest, private scratch,
manifest integrity and an actual sandbox parse. Invalid runtime fails startup.
No request body can override any of these values. The service admits one HTML
extraction at a time per process and aborts/drains it before closing the database.
Keep deployment at one process/replica until cross-process admission exists.

### Extraction quality review (local schema 21, not deployed)

Document detail now includes `extractions`: bounded manifest summaries and current
review status. GET `/extractions/:id` returns the immutable manifest and
`review: {status: 'unreviewed'|'accepted'|'rejected', eventId}`. GET
`/extractions/:id/original` returns hash-verified preserved bytes as a private,
no-store, nosniff attachment with sandbox CSP, never rendered active HTML. These
paths use the same editor-only `/api/v1/editor` prefix. Missing extraction is 404;
missing archive is 503. Editor role is rechecked after asynchronous original read.

POST `/extractions/:id/reviews` requires CSRF and:

```json
{
  "expectedManifestSha256": "<exact 64-character manifest SHA-256>",
  "expectedEventId": null,
  "decision": "accepted",
  "originalCompared": true,
  "reason": "Explain the comparison and any fidelity limitations."
}
```

Supply the current event ID after the first review. Acceptance requires explicit
original-comparison attestation; rejection also requires a reason. Actor comes
from the authenticated session. Invalid inputs return 400, stale event/hash 409,
and new immutable review events 201. Later decisions append rather than erase.
This is a human attestation, not machine proof that comparison occurred. It does
not approve a claim, authorize a provider, or publish anything.

Evidence packets include per-passage extraction quality and manifest/review IDs.
Missing, pending and rejected extraction reviews are explicit coverage gaps.
Review changes change packet identity. Rejected counterevidence remains visible
with its quality warning rather than disappearing. The research document view now
has the extraction review form, original link, warnings and stale-save recovery.
Writer/publication enforcement is still pending; this is not a complete release gate.

### Deterministic claim retrieval (local schema25; not deployed)

`POST /claims/:id/retrieval-runs` searches saved passages for an editor. It
requires an authenticated editor session, allowed Origin and CSRF token. The
request is bound to the claim's current context version;
`expectedContextVersionId` must match. The server supplies the immutable actor
from the session.

```json
{
  "requestId": "a client-generated UUID retained for retry",
  "expectedContextVersionId": 7,
  "queryVariants": ["claim wording", "challenge formulation"],
  "limit": 30
}
```

Use 1–8 non-empty variants, each at most 500 original UTF-8 bytes, 500
normalized characters and 30 tokens; combined original query text is at most
2,000 bytes. `limit` is bounded by the service. An unchanged retry with the
same actor, request ID and payload returns its original immutable run. Reusing
the ID with a different payload returns409. Stale claim context or unavailable
claim returns409; unauthenticated/unauthorized requests return401/403, invalid
requests400, and bounded-resource refusal returns422. A new run returns201.
Retrieval errors do not imply an empty evidence universe.

Success returns `{ run, searchLog, coverage, passages }`. The run identifies
claim/context, actor, request ID, limit and explicit retrieval cutoffs. Each
variant records the submitted and normalized query, outcome, raw/normalized/FTS
scan counts and tier counts. Coverage records search scope, excluded or
unavailable material, cutoffs and resource limits. Passage records include
rank, matched tier and variant, saved quote, neighboring context and source
provenance. Provenance is exact when the chain resolves; otherwise it is null,
never guessed. Database audit rows retain request, actor, variants, selected
passages and provenance immutably.

Search is local and deterministic: bounded exact/phrase/raw and NFKC-normalized
FTS tiers; topic and source-policy filters apply before limits. Audited source
chains are grouped before the candidate-pool cap to reduce duplicate-source
starvation. The implementation bounds scans per index at2048, discovery at32768
and the pool at1000, alongside quote, source and response byte budgets. These
limits can cut off eligible passages; the response reports this, and recall or
completeness is not established. No network, embedding or model call occurs.
Retrieval order is not a truth judgment. A frozen independently labeled corpus,
macro recall@30, critical-counterevidence retention and evidence-time cutoff
remain unverified.

`INGESTION_ENABLED=false` is the default. To enable locally, provide an existing
private `ARCHIVE_PATH` and a nonempty `SOURCE_POLICIES_JSON` registry (at most
64 KiB / 100 entries). Policy entries specify ID, exact approved hosts, supported
MIME types, private or metadata-only retention, requests per minute, and completed
access/robots review flags. Flags document review, not automatic robots enforcement.
Policy changes require a service restart; stale queued policy snapshots block.

The worker handles one job at a time per process. Host admission and leases are
database-backed. Shutdown cancels and drains work before closing SQLite. Storage
and database commits are separate: a lost lease can leave a private unreferenced
object. Reconciliation and independent backups are still required release work.

## Verification and remaining work

The editor API integration test uses real session/CSRF middleware, SQLite, fetch
orchestration and archive storage, with simulated DNS and HTTP response bytes.
Separate loopback TLS tests exercise certificate and hostname validation. Neither
is evidence of a successful live source crawl or factual accuracy.

The editor intake/review UI displays HTML extraction only when the server reports
availability. HTML HTTP/storage integration uses a mocked parser/runtime boundary;
the separate WSL tests exercise the actual parser and installed ownership checks.
Production container and full real-parser HTTP intake verification remain pending.

Remaining: HTML production activation, PDF extraction, source onboarding and access enforcement,
archive reconciliation, release security review, migration rehearsal/cutover and
the broader production plan. Keep paid models and automatic publication disabled.
# PDF intake extension (local schema23; not deployed)

`PDF_EXTRACTION_ENABLED` defaults false. Enabling it requires private archive,
root-owned sealed PDF bundle/digest and private scratch via `PDF_PARSER_BUNDLE`,
`PDF_PARSER_DIGEST_FILE`, `PDF_PARSER_SCRATCH`. Startup runs the sandbox preflight;
shutdown cancels/drains PDF intake before closing SQLite. Single replica required.

The existing editor `POST /api/v1/editor/fetch-jobs/:id/extract` now accepts
privately retained `application/pdf` receipts when enabled. Disabled returns503;
busy returns429 with Retry-After. Actor comes from the authenticated session,
not request body. Results are review-required, not verified claims. Scanned-only
pages use the bounded English OCR fallback and remain mandatory-review.

`GET /api/v1/editor/extractions/:id/renders/:page` returns a stored derived PNG
only to editors. It checks the immutable manifest and object hash, rechecks role,
and sends private/no-store, nosniff and sandbox CSP headers. Missing page is404.
Page numbers come from extraction manifest schema2; render objects are distinct
from originals. Original download and review endpoints remain unchanged.

Local HTTP integration verified anonymous401, session actor (spoofed body ignored),
repeated intake idempotency, authenticated image bytes and private response headers.
No production enablement, public publication, OCR or broad fidelity claim follows.

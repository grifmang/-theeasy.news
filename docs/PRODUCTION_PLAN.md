# Easy News: production plan

Prepared 2026-09-20. This is the controlling launch plan for the claim-centered
research product. It supersedes the original headline-to-news direction where
they conflict. No new hosting, paid calls, deployment, or publication is
authorized merely by writing this plan.

## Recommendation

Accuracy takes priority over the cheapest model or fastest publication cadence.
[ACCURACY_SPEC.md](ACCURACY_SPEC.md) defines the controlling 90%+ objective:
aim for >=95% observed whole-analysis correctness on at least 200 independent
held-out claim families, with a two-sided 95% Wilson lower bound >=90%.
Report automation and human-reviewed workflow separately, require >=70% correct
resolution coverage on resolvable cases, and allow no known critical errors.
These are future acceptance gates, not achieved results or guarantees.

Launch a small, editor-reviewed research publication with an Epstein pilot.
Preserve the current Node/React investment, use SQLite on one persistent backend,
store original evidence privately, and serve reviewed public pages cheaply.
Use Jev for bounded semantic decisions, ordinary code for exact checks, and a
generative model for evidence-grounded drafting. Every launch article receives
human review; model confidence cannot waive that requirement.

Target **$15–35/month in service costs for a modest pilot**, excluding labor,
domain renewal, taxes, and paid source access. Treat this as a workload-dependent
planning range, not a quote or a guaranteed maximum. The detailed assumptions,
rates, alternatives, and budget controls are in [COST_MODEL.md](COST_MODEL.md).
Infrastructure-only operation may cost less; a large corpus or high throughput
can cost substantially more. Spend less by doing fewer, better-supported
analyses when resources are constrained, not by relaxing review standards.

There is no honest zero-tradeoff promise: a single backend has an availability
tradeoff, manual review takes time, and broad automated discovery costs money.
This plan preserves accuracy, attribution, security, accessibility, and recovery
requirements, while accepting a smaller initial corpus and slower publication.

## Scope and success

Initial operating assumptions, chosen for planning rather than supplied by the
owner: English-language pilot, one operator/editor, up to 1,000 documents,
50 researched claims, 10 launch analyses, 10,000 monthly page views, and up to
100 new/revised analyses per month after launch. Document and page limits are
capacity budgets, not targets that justify ingesting irrelevant material.

Reader experience:

- Browse topics and specific attributed claims, not sensational headlines.
- Read a concise analysis with what is supported, what conflicts, what remains
  unknown, the scope of the search, and an explicit as-of date.
- Open citations at exact passages/pages with source identity, dates,
  provenance, document type, and a clear distinction between allegations,
  testimony, mentions, and findings.
- Inspect corrections and historical versions; report a suspected error.
- Search only public approved content; optionally save articles through the
  existing account feature once its authorization/session problems are fixed.

Editor experience:

- Register a topic/claim, review discovered documents, inspect originals and
  extraction quality, and link evidence to claims.
- See Jev recommendations alongside human labels, never masquerading as them.
- Review draft assertions against cited passages and record a publication
  decision tied to the exact version reviewed.
- Stop paid work, inspect failures/budgets, correct/retract publications, and
  restore data using documented controls.

Launch excludes public arbitrary-URL crawling, public uploads, open comments,
chatbots, unsupervised allegations, automated publication, social auto-posting,
subscriptions, video ingestion, and multilingual coverage. These are optional
future product work, not prerequisites for a useful research publication.

## Current implementation and gaps

Baseline locally verified: 24 backend tests across three suites pass. This is
not an end-to-end or security certification. Frontend build, production account
access, real source corpus, and real model behavior remain unverified.

Implemented: immutable source snapshots; atomic source/job ingestion; leases
and retry caps; explicit backup-first migrations; RSS intake without generation;
topics, attributed claims, supplied-text document imports, exact text slices,
and append-only human assessments. No real Epstein corpus has been loaded.

Before adding more automation, repair these concrete gaps:

1. `server/index.js` combines schema, server startup, auth, and routes; imports
   start a server. Extract a testable application factory.
2. Saved reads use a URL user ID rather than session ownership; author/article
   writes lack editor roles. Sessions have no expiry and disappear on restart.
3. `research_claims.status` is frozen by an update trigger; it cannot represent
   review transitions. Add append-only review events and a derived projection.
4. Human assessments currently accept caller-provided reviewer strings. Bind
   authenticated identity server-side. Separate model assessments into their
   own versioned records.
5. `rebuild_jobs` identifies source-only jobs; add claim/document/version jobs,
   claim-specific context, durable result commits, lease renewal, and failure
   routing. Avoid expensive duplicate calls after timeout/crash ambiguity.
6. Text excerpts have checked offsets but page locators and extraction fidelity
   are not validated. Store originals, extraction versions, and page maps.
7. Append-only records lack supersession, retraction, access restrictions, and
   exceptional removal controls. Corrections must not silently rewrite history.
8. Existing source hash includes extracted text/title/date, not original bytes;
   add an original-object hash without changing old immutable IDs.
9. `createTopic` needs strict string validation before its regex; schema version
   requirements must be explicit per command. Add v1→v2 and later upgrade tests.
10. Legacy article routes/generator must not expose unreviewed historical prose
    as verified analysis. Quarantine/import them with explicit legacy status.

## Architecture and hosting decision

```text
RSS / approved URLs / supplied documents / authorized search
                  ↓
fetch log + original object → extraction + page mapping → source/version records
                  ↓
claim registry → local text retrieval → Jev relevance/support assessments
                  ↓
evidence packet → grounded draft → assertion/citation checks → editor decision
                  ↓
versioned publication → public read API + rendered HTML/cache → readers
```

Retain Express and SQLite with WAL, foreign keys, busy timeout, bounded writes,
and one mounted persistent volume. Run API plus an I/O job runner in one service;
execute parsing/OCR in resource-limited child processes so they cannot block the
API event loop. One OCR task at a time, one writer task, two Jev requests maximum
initially. The job queue, not process memory, owns progress. No Redis, vector
database, graph database, Kubernetes, or separate always-on model workers.

Default backend candidate is Railway Hobby, measured before public launch.
Preserve existing Netlify DNS and use the existing frontend account if its
actual legacy plan is economical. If credit limits threaten availability,
prepare Cloudflare static hosting as an explicit cost alternative. Do not
change registrar nameservers while testing. No hosting choice is an excuse to
rewrite the backend into incompatible serverless SQLite semantics.

Public HTML must contain the article and citations for readers/crawlers without
requiring JavaScript. Add a shared rendering layer to produce static public
snapshots from approved versions; private editor UI remains React. Persist the
latest published snapshot and publish an atomic manifest of current versions.
During backend downtime, cached/static articles remain readable; authentication,
search, corrections, and new publication can be briefly unavailable. Do not
cache private responses or drafts. Give corrections and retractions a tested
cache purge/invalidation path. CDN stale serving has a maximum age and cannot
retain retracted content indefinitely.

Railway documents a short redeploy interruption for volume-backed services and
no volume replicas. Therefore this is not high-availability infrastructure.
If uninterrupted writes or a contractual uptime guarantee is required, choose
a different topology/budget before launch, not after promising that property.
[Railway volume limitations](https://docs.railway.com/reference/volumes).

## Research and evidence policy

Discovery channels: curated official/court collections, authorized repository
APIs, reviewed manual imports, reputable reporting with traceable references,
and RSS. Social posts/forums are useful for discovering the original assertion;
repetition does not independently substantiate it. Record source chains rather
than counting copies as multiple witnesses. Do not rank trust solely by domain.

Every claim retains original wording, attribution, originating URL, observed
date, relevant time/place/entity qualifiers, and proposed normalized wording.
Split compound assertions for review without changing their meaning. Preserve
ambiguous identity; a shared name is not an identity match. Distinguish factual
claims, opinions, predictions, and unfalsifiable propositions. Human reviewers
approve normalization/merges during the pilot. Reversed decisions remain visible.

Every source has original URL, fetch timestamp/status, byte hash, content type,
publisher, publication date when known, retrieval method, document version,
extraction metadata, and access/reuse classification. Keep original bytes in a
private object store where retention is permitted; otherwise retain permitted
excerpts and provenance, record the limitation, and do not claim a complete
archive. Link to sources publicly rather than republishing full copyrighted
documents by default. No paywall/authentication bypass. CourtListener API access
must be priced/authorized rather than assumed free.
[CourtListener access documentation](https://www.courtlistener.com/help/api/).

HTML/PDF/text are first-class. Scan PDFs with local OCR only when needed;
quarantine encrypted, malformed, oversized, or low-quality extractions. Humans
check names, numbers, dates, and cited spans against the original. Never infer
redacted content or recover hidden text for public display. Sensitive personal
data and victim/minor identities require editorial screening before publication;
the pilot focuses on evidence about claims, not a public people database.

Fetch an allowlisted URL with timeout, response/decompression limits, redirect
checks, DNS/address validation for every hop, and no cookies or credentials.
Block private, loopback, link-local, metadata, and alternate-encoding address
targets, including IPv6. Pin the validated address for connection while retaining
TLS hostname verification to resist DNS rebinding. Quarantine file attachments;
parse in a constrained subprocess with no shell interpolation/network access.
Imports/URLs are editor-only. This is required for the requested non-RSS intake.

An independent source search must seek counterevidence as well as support.
Record query variants, sources searched, document failures, and cutoff date.
No result means the search found no evidence, not that evidence cannot exist.
No system can exhaust the entire internet; the public analysis states its
coverage and limitations. Unresolved contradictions block an unqualified verdict.

## Retrieval and model policy

Start with SQLite FTS5 lexical search, exact identifiers, reviewed aliases, and
source/time filters; shortlist 30 passages per claim initially. Jev reranks
and assesses claim/passage relationships. Measure recall on known relevant and
contradictory passages before pruning. If lexical recall fails the gate, add
embeddings/hybrid retrieval locally or broaden queries; do not accept missed
evidence to avoid a small expense. The shortlist size is tunable, not a fixed
ceiling on required research. [SQLite FTS5](https://www.sqlite.org/fts5.html).

Jev questions are narrow: claim relevance, supports/contradicts/mentions-only/
insufficient relation, evidence type, duplicate relation, or routing. A relevant
court filing can contain an unsupported allegation. Never convert document kind
or model confidence into a truth verdict. Maintain separate human ground truth.
Use explicit versions and input/question hashes. Cache only identical evaluation
inputs including claim version, source passage, model and policy versions.

Use the existing OpenAI writer as a comparison baseline, not a selected winner.
Benchmark low-cost drafting against a higher-quality available reference on the
same evidence packets. Evaluate factual coverage, citation correctness,
uncertainty, attribution, and human edit time, not fluency alone. The least
expensive model that passes all gates wins. If no inexpensive candidate passes,
use the stronger model or lower throughput. Jev remains the semantic decision
layer; reasoning review supplies analysis, not authority to publish.

Writing output is structured blocks with claim IDs and passage references.
Require a support/contradiction/unknown summary, chronology, search scope,
source limitations, as-of date, and separate factual assertions from inference.
Check every factual sentence, not just a writer-provided claim list. Quotes are
exact span matches; page maps resolve to originals. Allow one bounded revision,
then send unresolved output to an editor. No invented sources or autonomous
"fact checking" by the same writer using its memory.

Historical batch work can use discounted asynchronous generation when available;
fresh corrections stay synchronous or editor-written. This changes the earlier
news-freshness decision against batches: retrospective claim analysis often
tolerates delayed processing. Never apply Batch assumptions to Jev without
provider support. Keep failed/expired batch requests idempotent and budgeted.

## Quality gates and evaluation corpus

Build 50 attributed pilot claims and 100–200 acquired documents (grow only when
needed), then at least 300 adjudicated claim/passage pairs, plus 50 adversarial
and extraction fixtures. Split by claim family/source chain: 60% development,
20% validation, 20% held-out. Retain a separately labeled critical set spanning
contradiction, identity ambiguity, allegations versus findings, and missing data.
This initial set is for development only. Add a separate preregistered 200-family
confirmation set under [ACCURACY_SPEC.md](ACCURACY_SPEC.md); it supersedes the
small pilot as the accuracy release benchmark. Two independent qualified humans
label every reference case; disputed labels require adjudication. High-risk
publications also require two-person review. Missing reviewer capacity keeps
the accuracy-qualified milestone incomplete, even if all unit tests pass.

Gates below are proposed release targets, not measured results:

| Area | Launch gate | Action on failure |
|---|---|---|
| End-to-end accuracy | >=95% observed whole-case pass rate and 95% Wilson lower bound >=90% on >=200 independent held-out families; macro disposition accuracy >=90% | Research/repair/retest on fresh confirmation cases |
| Useful coverage | >=70% correct resolution of reference-resolvable claims; all cases remain in primary denominator | Improve research; never force verdicts |
| Retrieval | ≥95% recall@30 on labeled relevant passages; 100% of known critical counterevidence found in critical set | Expand search/hybrid retrieval or manual supplementation |
| Jev relevance | ≥95% precision at selected automatic-accept threshold, report per-class recall/coverage and sample counts | Keep as recommendation only |
| Semantic duplicate suppression | No distinct/contradictory critical evidence suppressed; merges require editor review | Disable suppression, retain candidates |
| Citation mechanics | 100% referenced IDs/spans resolve; all cited names/numbers visually checked in scanned sources | Block affected draft |
| Meaning/attribution | Zero known fabricated/unsupported assertions or allegation→finding promotions in launch articles | Rewrite/review; do not publish |
| Draft quality | Blind human rubric passes correctness, uncertainty, attribution, completeness; no regression against reference | Stronger model/manual writing |
| Publication | Every article has exact-version human approval, disclosure, sources, as-of date and correction path | Remain draft |
| Security | Ownership/roles/session/SSRF/XSS tests pass; no known exploitable critical/high release finding | Block launch |
| Accessibility | Keyboard paths and screen-reader labels tested; no serious/critical automated violations; WCAG AA contrast target | Fix before launch |
| Recovery | Restore into fresh environment succeeds; targets RPO ≤24h and RTO ≤4h | Block launch |
| Performance | At 20 concurrent readers: cached article p95 <1s, API reads p95 <500ms, error rate <1%; no OCR starvation | Profile/cache/resize before launch |

Report Wilson intervals, confusion matrices, sample counts, and abstention rates;
small samples cannot establish general accuracy. Publication standards apply to
the actual launch corpus, not just aggregate metrics. Jev shadow evaluation can
fail while a separately evaluated human-reviewed workflow passes; that never
establishes automation accuracy. A manual-only release without confirmation is
a separate, explicitly approved unvalidated pilot, not completion of this gate.
Automatic publication is off for the full initial production release.

## Security, corrections, and editorial accountability

Use verified Google identity and server-side role mapping for editors. Never
auto-promote based on client email, an author persona, or model output. Retain
existing reader accounts only with ownership checks, input validation, expiring
revocable sessions, and migration tests. Prefer HttpOnly secure cookies, Origin/
CSRF protection, same-site deployment boundaries, and no tokens in localStorage.
Remove or editor-gate legacy creation routes. Public endpoints expose only the
approved current version; draft detail IDs, search results, exports, and cached
snapshots must not bypass this check.

Add version-bound publication events, supersession links, retraction state,
reason codes, and an audit trail of human actor/time. A new evidence version
marks affected analyses for reassessment. Corrections re-run checks and purge
public caches. A controlled restriction/removal workflow prevents append-only
storage from making harmful publication permanent. Private originals, backups,
search indexes, and public snapshots must follow that workflow consistently.
Obtain specialist advice when a planned publication's circumstances require it;
this plan is operational design, not a legal clearance or liability guarantee.

## Operations and affordability

Application budget is separate from infrastructure budget. Reserve estimated
maximum call cost transactionally before dispatch; account for retries, output
limits, SDK retries, timeouts with unknown charges, OCR, discovery, and concurrent
workers. Budget exhaustion pauses new research/writing, never bypasses checking
and never shuts down already-published reading. Provider account alerts and
limits supplement, not replace, this ledger.

Minimum operational signals: API/readiness errors; queue age and exhausted jobs;
provider latency/429/auth errors; estimated versus reported usage; disk growth;
backup age and restore test result; cache publish failures; citation breakage;
review backlog and pending corrections. Structured logs redact source payloads,
keys, session tokens, and sensitive content. Notify an operator only on actionable
failures; scheduled checks are implemented at deployment, not created now.

Consistent daily SQLite backup to independent private object storage; 7 daily
and 4 weekly snapshots initially, encrypted with documented recovery key access.
Archive original objects by hash; keep referenced originals according to their
retention classification. Test restores monthly and before schema changes.
Snapshot retention has storage/operation cost; include it in monitoring. One
SQLite service only: no second replica sharing a volume. Short-lived staging
uses isolated data/keys and shuts down after checks; account for its usage.

Disable paid processing and automatic publication by default in every new
environment. Use staged release: local mocked flow → private staging → curated
editor review → public read-only pilot → measured expansion. Export DNS before
cutover, retain `_atproto` records, verify registrar delegation and certificates,
and update OAuth origins. Launch is a separate explicit action after evidence
and budget/account requirements are satisfied.

## Execution order and deliverables

The detailed checklist is [the implementation plan](superpowers/plans/2026-09-20-production.md).
Every task has files, interfaces, tests, and a completion gate. Execute in order;
independent UI work may follow stable contracts, but do not create extra agents
unless the user/session authorizes them.

| Phase | Tasks | Deliverable | Dependency |
|---|---|---|---|
| A | 01–04 | Testable backend, safe schema/lifecycle, authenticated editor boundary | Existing foundation |
| B | 05–08 | Original evidence storage, safe HTML/PDF intake, claim registry | A |
| C | 09–13 | Retrieval, cost ledger, Jev shadow worker, labeled pilot/eval report | B |
| D | 14–17 | Grounded drafting, citation checks, editorial review/publication, public API | C |
| D accuracy gate | 13A after 14–16 | Independent end-to-end confirmation and accuracy report | C and reviewed pipeline |
| E | 18–20 | Reader/editor UI, rendered pages, accessible verified experience | D |
| F | 21–24 | CI/container, backups/observability, staging and public release | A–E |

Planning envelope: roughly 25–45 focused engineering days plus 20–50 editorial
hours for a first real corpus, before unknown source-access or remediation
delays. This is a scoping estimate, not a calendar commitment; re-estimate after
A and C. Coding assistant usage and developer labor are separate from hosting.
Avoid buying data subscriptions until the manual pilot demonstrates the gap.

## Historical archive coverage

Include Wayback capture discovery and editor-supplied archive.is snapshots under
[Archival sources](ARCHIVAL_SOURCES.md). Task 06A extends Phase B. Preserve exact
capture dates, original source chains and snapshot limitations; archive copies
are not independent corroboration. Jev can assess passage relevance but cannot
turn preservation into proof. Include timeline and incomplete-capture cases in
the evaluation and show original/archive links in the reader evidence panel.

## Scale triggers

- DB/index reaches 60% of available volume: alert and plan resize/export; never
  wait for full disk. Use object storage for binaries, not SQLite BLOBs.
- Sustained lock contention or p95 read latency breaches the gate after profiling:
  optimize indexes/work scheduling; move to managed Postgres when a measured
  multi-writer/replica need justifies its operational and cash cost.
- Paid research backlog exceeds 24h: increase throughput within budget or reduce
  intake cadence, keeping claim quality gates intact.
- Review backlog exceeds seven days: limit new dossiers and invest in evidence
  presentation; do not auto-publish to clear the queue.
- Provider output or retrieval quality regresses: pin previous tested version,
  pause automated decisions, evaluate the regression on retained fixtures.

## Decisions needed only at their execution boundary

No answers are needed to start local tasks. Before paid evaluation: API access,
explicit spend allowance, and chosen human reviewer. Before staging provision:
hosting account eligibility, measured workload, selected plan and budget. Before
public launch: publisher/editor identity, correction contact, approved articles,
DNS authority, and release approval. Never request raw secrets in chat; enter
them through local secret storage/provider settings.

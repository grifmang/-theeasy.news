# Model architecture for the Easy News rebuild

Status: approved design direction, prepared 2026-09-20; partially implemented.
As of 2026-09-29, the local runtime requires schema33; Railway and its active
database remain schema21. A local schema33 image artifact has been verified,
but hosted Linux CI and deployment gates remain open. Durable global work
admission is implemented locally for authenticated editors, with audited
version-CAS pause/resume and dispatch fences. Status includes
analysis-verification lease/backlog counts. Schema31 adds durable
analysis-verification jobs with editor permission events. Authenticated editor
version/job/permission/report routes and a Research Desk review UI are
implemented locally. Saved drafts and reports are integrity checked; permission
changes compare the expected event ID and exact admission hash. The parser is
capped at 300 KB and rejects inflation. Queueing does not authorize execution.
A durable-budgeted Jev assertion adapter reuses the existing
reservation/settlement/audit ledger. An explicit
`ANALYSIS_VERIFICATION_ENABLED` bootstrap path is implemented, strict and
default-off; it requires exact staging environment, validated budgets/token
limit, fail-closed shared guard, and the audited adapter. One serial worker uses
a 30-second lease; fatal guard failures halt and shutdown drains before DB close.
No permission or recovery is automatic. Runtime remains off, no live call has
occurred, and all editors currently have operator authority. Provider auth/config
failures currently terminal analysis jobs; recovery covers claim jobs only.
Staging isolation and adversarial, accuracy, and rendered-fidelity gates remain
prerequisites to opt-in. Task16 adds a local owner-gated publication core: exact
text-only approved DTOs, immutable audit/snapshot/dependency records, desired
manifest tombstones, and durable per-target outbox tasks. A schema33 private
filesystem exporter and outbox worker have exact staging-only, default-off
activation. They validate canonical database/root identity, hold an exclusive
sink process lock, maintain O(1) `head.json`, immutable history and
installed-generation proofs, and reconcile receipts/artifacts/tasks/outbox
exactly at startup. Latest-review and final-pause fences reject stale publication
while permitting invalidation. Interrupted pending/link operations recover and
replay; Linux directory fsync failures fail closed, production Windows
activation is rejected, and DTO/object prewrite stays outside the final SQLite
transaction. Authenticated, CSRF-protected editor routes now provide publication
state, review, publish/correct actions, and owner-only retraction under
`/api/v1/editor`. Actors come from the session; exact compare-and-set and
idempotency fields guard writes. Responses are sanitized allowlists with
private/no-store headers. Claim state that blocks preview does not prevent owner
retraction. Coverage remains an unsatisfied actual-publish blocker. There is no
release-desk UI, public content route, public/CDN purge, production integration,
or deployment. No paid or live model calls have occurred. Next is the bounded
editor UI, followed by remaining coverage/evaluation/public/E2E/deployment gates.
See the current [resume checkpoint](RESUME.md)
and [operations](OPERATIONS.md).
Pausing does not cancel in-flight work, and the status response reports backup age as
unknown. Recovery gates remain open; see [Operations](OPERATIONS.md) and the
[latest resume checkpoint](RESUME.md). The design below includes both current
behavior and future proposals; “proposed” marks unimplemented work.
Local Jev classification transport, bounded failure/retry handling, and durable
editor recovery exist, but classification and generation remain disabled.
Missing provider key fails startup; runtime invalid-key detection durably pauses
the queue. There are no live-call claims. Frontend provider-recovery UI remains
an enablement prerequisite. Deployment remains deferred. Current implementation is mapped in
[AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) and [RESUME.md](RESUME.md).

## Responsibilities

| Layer | Owns | Must not own |
|---|---|---|
| Deterministic code | Parsing, validation, arithmetic, date ordering, exact dedup, authorization, budgets, state transitions | Semantic conclusions requiring model judgment |
| Jev decision adapter | Categories, relevance, semantic duplicate relations, source adequacy, content risk, generation routing, claim support | Prose generation, database writes, permission grants |
| Writer adapter | Concise source-grounded article and claim/source references | Invented facts, independent publication |
| Reasoning review adapter | Bounded analysis of ambiguous evidence and proposed revisions | Bypassing policy or supplying missing evidence from memory |
| Editorial review | Unresolved or high-risk decisions, corrections, publication approval during rollout | Unlogged overrides |

When classification is enabled, Jev is intended for runtime semantic decisions.
Complex cases can receive
reasoning review, as approved; that review supplies analysis to a subsequent
Jev check or an editor. Code still controls the final action. No automatic
expensive fallback merely because a provider is down.

Use provider adapters so changing a model does not change database or route
contracts. Proposed boundaries (future modules): `sources`, `jobs`,
`models/decisions`, `models/writer`, `models/reviewer`, `policy`, and
`publication`. Keep a modular Node backend initially; separate services and
distributed queues are unnecessary until measured load warrants them.

## Data flow and persistent state

```text
ingested → normalized → classified → ready_to_generate → generated → verified → published
                 any semantic stage → review → resume a specified stage or reject
                 temporary failure → scheduled retry at the same stage
                 exhausted retry → review
```

Store lifecycle state separately from job execution state (`queued`, `leased`,
`retry_wait`, `done`, `exhausted`). An outage does not erase progress or turn an
unverified draft into a published article. Rejected items retain an audit trail.

Proposed logical records:

- `source_items`: feed/source identity, canonical URL, title, published/fetched
  timestamps, snippet, evidence snapshot or permitted extract, content hash.
- `stories` and `story_sources`: grouping and links to all retained sources;
  distinguish exact duplicates from related updates to an ongoing event.
- `article_versions`: draft text, writer ID/version, prompt version, lifecycle
  state, AI disclosure, claim references, creation and publication timestamps.
- `decisions`: article/source IDs, decision kind, schema/policy versions, input
  hash, actual model version, typed answer, probabilities, confidence if
  available, route, usage, latency, correlation ID, failure category.
- `jobs`: stage, idempotency key, attempts, lease owner/expiry, next attempt,
  last error category, completion time.
- `editorial_reviews`: triggering evidence, reviewer, decision, reason,
  timestamps, affected version. Review actions require an authorized role.
- `model_usage`: actual usage and versioned price estimate per call, including
  failed/retried calls when usage is available. Never claim exact provider cost
  where billing information is unavailable.

These are proposed records, not an existing migration. Keep source evidence
separate from generated text; never overwrite the only grounding snippet.
Backfill legacy rows with explicit legacy/unverified status. Do not invent
missing source URLs or promote old content to verified automatically.

Use transactional row claims and unique job keys based on item/version/stage.
Release database transactions before network calls. Lease recovery handles
worker crashes, but without call-key result reconciliation a crash after provider
success can repeat a paid call. The Task15 passage adapter now uses exact-key
cached replay and blocks on unknown settlement; other adapters still need their
own idempotency/reconciliation contract. Do not promise exactly-once external
execution.

## Decision contracts

Send a compact JSON `state` and versioned typed questions. Include only the
evidence needed for the decision; batch independent questions about the same
state. Dependent stages need separate calls: one parallel question cannot read
another question's answer. Filter candidate duplicates in code before Jev
compares pairs. Cache by evidence hash, question version, model version, and
policy version, with expiry/invalidation for mutable evidence.

| Decision | Answer space | Provisional confidence gate |
|---|---|---|
| Category | Versioned taxonomy with `other`/`uncertain` | 0.75 |
| Relevance | relevant / weak / off-topic / spam | 0.80 |
| Duplicate relation | duplicate / related / distinct / insufficient | 0.85 to suppress |
| Generation route | skip / fast / reasoning / human | 0.80 |
| Claim support | supported / contradicted / not-addressed / insufficient | 0.90 to accept support |
| Publication assessment | publish / review / reject | 0.90 to consider publication |

These numbers preserve the approved starting proposal but are evaluation
hypotheses, not validated safety levels. Confidence measures distribution
concentration; 0.90 confidence is not a guarantee of 90% accuracy. A confident
`contradicted` is still a failed claim. Risk-specific policy can require review
at any confidence. Noul has no confidence field: use separately evaluated
probability bands and do not reuse Choice thresholds for Noul.

Publication requires all mandatory checks plus authorization, budget, and
state rules in code. A publication Choice cannot override failed citations,
missing evidence, unresolved claims, or required human review. Sensitive claims
about individuals and high-stakes medical, legal, or financial guidance start
with mandatory editorial review. News reporting about those subjects is
evaluated in context; topic alone does not imply rejection.

The decision adapter returns an application envelope, not a fabricated vendor
schema: decision kind, typed vendor answer, actual returned model ID, usage,
timing, and error classification. Validate response structure, allowed values,
and finite probabilities even when the provider advertises type guarantees.
Persist `confidence=null` for deterministic checks/Noul rather than inventing it.

## Grounding, writing, and review

1. Normalize and retain source identity. Validate URL scheme and fetching
   targets, redirect destinations, response size, and timeout. Prevent access
   to private/internal addresses. Respect source access and content permissions.
2. Exact duplicates are handled in code. Jev distinguishes near-duplicates
   from meaningful updates; preserve every source link even when suppressing
   redundant generation.
3. Jev assesses whether evidence supports an article or only a short summary.
   A headline alone is insufficient for a full article. Fetch failure sends the
   item to retry/review; it must not trigger invented background or quotes.
4. Writer input contains bounded evidence, source IDs/spans, style instructions,
   and the requested output schema. Output contains prose and claim/source
   references; code validates reference IDs and quoted spans.
5. Verify coverage: each factual sentence needs support mapping or review.
   A writer's self-reported claim list alone can omit unsupported statements;
   evaluate sentence coverage separately and include adversarial omission tests.
6. Jev judges semantic support for each claim against the cited passage and
   necessary context. Source agreement is evidence of support, not proof the
   source itself is true. Conflicting sources remain visible to review.
7. Unsupported drafts receive at most one bounded revision in the initial
   policy, then recheck all changed claims. Remaining failures go to review.
8. Published articles show source links, source/publication timestamps, AI
   disclosure, and a correction path. Review states stay out of public APIs,
   including detail-by-ID routes. Corrections create new versions.

All fetched content is untrusted data. Jev screening complements source
allowlists, server-side authorization, schema validation, and restricted model
capabilities. It is not an injection-proof security boundary.

## Cost and failure policy

Start with a bounded background batch; do not introduce paid generation in a
public GET request. Demand-based generation is a later option requiring
deduplicated jobs and abuse limits. Configuration proposals (not yet read by
the app): `JEV_MODEL`, `WRITER_MODEL`, `REVIEW_MODEL`, `DECISION_MODE`,
`GENERATION_ENABLED`, `AUTO_PUBLISH_ENABLED`, `MAX_JOB_ATTEMPTS`,
`DAILY_MODEL_BUDGET_USD`, and `MAX_ARTICLES_PER_CYCLE`.

Initial retry policy: at most three job attempts, finite per-call timeouts,
exponential backoff with jitter, and Retry-After support. Count SDK retries
inside the total provider-call budget; do not multiply hidden SDK retries by
job retries. Authentication/configuration errors halt the affected integration
and alert an operator; 429/temporary network errors schedule bounded retries.
Keep the pending item and source data during outages. Published content remains
servable when model providers are unavailable.

Reserve conservative estimated cost atomically before calls, reconcile usage
afterward, and cap input/output sizes and concurrent jobs. Unknown pricing or
insufficient budget pauses new paid work. Record retry/escalation cost and
measure cost per publishable article, not just cost per successful response.
Choose writer/reviewer models by an evaluation of accuracy, latency, and total
workflow cost at rebuild time. Retain the current model name only as baseline;
do not copy historical pricing/free-tier claims into production policy.

## Evaluation and rollout

### Offline evaluation and gates

The local v2 evaluator lives in `server/evals/run.js` and `server/evals/metrics.js`.
It separates retrieval query snapshots from classification cases and permits at
most one ranked result (within the top 30) per claim/query. Its
`retrievalSnapshotSha256` binds the corpus, document and passage snapshots,
retrieval configuration, and evidence cutoff. Inputs are deeply copied and
frozen before callbacks or asynchronous work. Evaluation pins the exact current
Jev model identifier and digest; mutable aliases are rejected. Manifest checks
detect leakage through claim families, source chains and passage hashes.
Reports bind metrics, provider usage, reviewer time and report content by hash.
Missing results, errors and abstentions fail closed.

The current pilot manifest is deliberately `incomplete` with zero claims,
documents, retrieval pairs or classification cases. It provides no quality
evidence. A real 50-case development corpus, 100–200 held-out cases, a separate
>=300-case publication corpus, double review and paid evaluation remain
outstanding. Task14 writer selection is blocked until a real development
benchmark passes its gate; implementing the evaluator is not completion of the
benchmark. Current verification is offline only: backend 545 passed/1 optional
skip, disposable adversarial probes passed, and scoped Astra review passed after
two rounds. No live Jev call or paid evaluation occurred.

Task12 provider recovery UI now appears inside BudgetPanel. Its recovery flow
uses exact pause-version compare-and-set, an audited operator reason, and
idempotent continuation in bounded pages of at most 100 jobs. Frontend verification passed 18/18 relevant tests,
lint, public-config check and production build; independent Luna review passed.
Classification remains disabled and budgets remain zero. Two minor UI follow-ups
remain: clarify success wording when a cursor is invalid and retry guidance
after a 409 response.

Historical Task12 release boundary (superseded 2026-09-27): local schema28 and
deployed schema21 were distinct. The current local schema is29; production
remains schema21. No schema29 image exists. Follow the current backup-first
schema21→33 release boundary above before deployment.

The controlling accuracy contract is [ACCURACY_SPEC.md](ACCURACY_SPEC.md).
Target >=95% observed end-to-end correctness with a 95% Wilson lower bound
>=90% on >=200 held-out independent claim families. Report raw automation
separately from the human-reviewed workflow; Jev confidence is neither metric.
Require correct resolution coverage, independent reference adjudication, and
zero known critical errors. Existing routing thresholds remain provisional.
Limited automation never means autonomous publication in the initial release.

Build a versioned, human-labeled set covering routine stories, minority classes,
ambiguous categories, related event updates, conflicting evidence, unsupported
claims, omitted claim mappings, prompt injections, missing sources, and
non-English inputs. Keep a held-out set separate from threshold tuning, split
related stories together to prevent leakage, and review label disagreements.

Measure per-class precision/recall, false duplicate suppression, unsupported
publication rate, review workload, coverage at each gate, confidence versus
observed error, p50/p95 latency, and total cost. A small set with zero failures
does not demonstrate zero production risk. Record sample counts and uncertainty.

Rollout sequence: mocked adapter tests → paid, explicitly authorized offline
evaluation → staging shadow mode → editor-approved canary → limited automation.
Shadow mode permits no autonomous publication; the old ungrounded generator is
not a safe authority to publish beside it. Activate each decision independently
only after its evaluation report records acceptable error/coverage targets and
editor approval. Pin the evaluated model and policy together. Reevaluate changes
to model, taxonomy, prompt, or source distribution; retain a switch back to
manual review. No evaluated thresholds or live evaluation results exist yet.

Required implementation checks:

- Unit: typed answers, boundary thresholds, Noul bands, unknown answers,
  deterministic validation, cache invalidation, policy priority.
- Integration with mocks and isolated DB: claims/leases, two-worker collision,
  restart recovery, retry exhaustion, budget races, migration preservation,
  provenance, draft access denial, cross-user authorization, role enforcement.
- Failure injection: timeout, 429, malformed responses, missing keys, writer
  outage, provider success followed by worker crash, DB failure after response.
- Browser/API: loading/empty/error states, source links/disclosure, direct route
  refresh, login/save ownership, review-only content exclusion, corrections.
- Release: frontend build, relevant suites, database restore rehearsal, staging
  end-to-end run, model shadow report, rollback exercise.

## Coding-agent workflow

Use [../AGENTS.md](../AGENTS.md), the compact map, and verified worklog for
progressive disclosure. Routine search and exact checks use tools. Bounded
edits use a lightweight coding model when the environment allows explicit
selection; architecture and ambiguous debugging use a stronger reasoning model.
Jev can later classify task metadata or rank candidate evidence, but only via
an explicitly integrated adapter and a small evaluation set. It cannot switch
the active Codex model by itself or replace tests/security review. No global
Codex configuration changes are part of this milestone.

Suggested rebuild order: isolated test fixtures → source/schema/job migration →
authorization fixes → Jev adapter and offline evaluation → grounded writer and
claim checks → review/publication API → frontend provenance/state handling →
staging deployment and shadow evaluation → separately authorized public launch.
Each mission hands off problem/evidence/files/invariants/change/verification.

## Provider references

Reviewed 2026-09-20; recheck at implementation. TypeSafe currently documents
`@typesafe-ai/sdk` for Node 20+, `TYPESAFE_API_KEY`, and
`POST https://api.typesafe.ai/v1/systemone`. The current documented version is
`jev-1.13.0`; select and pin the version actually evaluated at rebuild time.

- [API quickstart](https://docs.typesafe.ai/introduction/quickstart)
- [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Models and alias behavior](https://docs.typesafe.ai/models)
- [Confidence semantics](https://docs.typesafe.ai/confidence)
- [State and independent questions](https://docs.typesafe.ai/concepts/state)
- [Known limitations and adversarial content](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
- [Citation checking pattern](https://docs.typesafe.ai/cookbooks/citation_check)

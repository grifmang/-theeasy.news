# Development pilot evaluation — incomplete

Status: **EMPTY / INCOMPLETE**. No quality or release gate has passed. This
report is a development scaffold, not a measured claim about retrieval, Jev,
writing, or publication quality.

| Item | Current verified count | Development target |
| --- | ---: | ---: |
| Attributed claims | 0 | 50 |
| Useful documents | 0 | 100–200 estimated; more if needed |
| Independently adjudicated claim-passage pairs | 0 | At least 300 |
| Critical challenge cases | 0 | At least 50 separately for the accuracy specification |
| Model calls / spend | 0 / $0 | Explicit budget before any live run |
| Human review time | 0 minutes recorded | Measure independent review and adjudication |

The checked-in [manifest](../../research/pilot/manifest.json) and
[split](../../evals/splits.json) contain no corpus rows. They intentionally
cannot be evaluated. Restricted originals, claim wording, passages, reviewer
rationales and access credentials belong outside git. When the owner authorizes
source collection, freeze opaque IDs and SHA-256 references to those private
assets, two independent blinded reviews per pair, disagreement/adjudication
records, family and source-chain IDs, and critical flags. A third independent
adjudicator resolves disagreement; unresolved labels remain visible and block
the quality gate.

Freeze the eligibility registry, exclusion log, evidence cutoff, blinded review
protocol, retrieval configuration, manifest/labels hashes and 60/20/20
family/source-chain assignments before inspecting held-out outputs. Exact
duplicate pairs, copied passage hashes and connected family/source-chain groups
must never cross splits. Only pre-registered duplicate/technically invalid
exclusions with in-corpus replacements are accepted; failures cannot be removed
after a run. Use validation for model/policy selection. A failed held-out split
becomes a regression set; confirmation after tuning needs fresh families.

`runEvaluation` in `server/evals/run.js` accepts only frozen offline metadata
and injected cached runners. It rejects live mode. A model descriptor must use
the exact `jev-1.13.0` / `passage-shadow-v1` / `passage-v1` pins exported as
`evaluatorPins`, plus the frozen retrieval configuration hash. Unknown writer
and provider IDs remain unsupported pending their own evaluated registry.
The runner receives `{stage:'retrieval',query,signal}` once per claim and
`{stage:'classification',case,signal}` once per labeled pair. Retrieval output
must bind to the exact query SHA-256 and contain one unique ranked list of at
most 30 passage IDs. The query and cached result also bind to a
`retrievalSnapshotSha256` derived from the frozen corpus hash, sorted document
and passage IDs/hashes, retrieval configuration and evidence cutoff. Reviewer
metadata is outside that snapshot, so changing labels alone does not invalidate
retrieval cache identity. Classification output contains only the three question
choices. Both stages return status, latency and usage; a missing or failed
stage retains its denominator and never receives retrieval credit. The report
separates stage outcomes, recall at 30, critical counterevidence, class metrics,
recorded usage and review minutes, with explicit fail-closed component gates.
The private runner resolves opaque IDs against its authorized local corpus;
this module cannot prove that a caller-supplied function avoids network access.
No provider self-confidence is a reference label.
Missing or thrown runner outputs retain their per-call budget reservation because
their provider cost is unknown; the report separates recorded actual cost from
unreconciled calls. A caller must supply a trusted cache-only runner and audit
the private asset IDs against the actual source-chain graph before freezing.

Local engineering checks on 2026-09-26: disposable probes exercised zero-total
Wilson intervals, 0.5 recall at 30 from one claim query, deterministic report
hashes under callback mutation, missing/error/abstained outputs, budget and live
refusal, copied-passage/family leakage, reviewer disagreement, split ratio,
model pin and hash mismatch. The existing backend suite is rerun after code
changes: 58 suites / 545 passed, one optional skip. These checks do not
measure model quality. Disposable adversarial probes passed, and scoped Astra
review passed after two rounds. The manifest remains empty; no live or paid
provider calls ran. Task14 writer selection remains blocked until a real
development corpus passes its gate; evaluator implementation alone is not that
evidence.

### Offline metadata preflight

Run `node server/evals/validate.js <absolute-manifest.json> <absolute-split.json>`
(or `npm run validate-pilot --prefix server --silent -- <absolute-manifest.json> <absolute-split.json>`)
to check the two metadata files against the evaluator's canonical snapshot,
manifest and split validators. Each file is limited to 8 MiB; the command
rejects symlinks and nonfiles. It reads only those two files and never opens
referenced assets or follows URLs. Output is deterministic and contains only
status, version, SHA-256 hashes and aggregate counts. Exit status 0 means only
that the metadata is structurally valid; an incomplete empty shell is valid
and reports `corpusReady: false`. This is metadata validation only: it does not
verify raw asset hashes, perform human review, establish quality evidence or
run an evaluation.

The pilot is development work. Even a successful 50-claim pilot does not meet
the independent 200-family end-to-end confirmation and critical gates in
[the accuracy specification](../ACCURACY_SPEC.md).

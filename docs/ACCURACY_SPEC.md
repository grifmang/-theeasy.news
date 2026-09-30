# Accuracy-first evaluation and release specification

Status: proposed requirements, not measured performance. Updated 2026-09-26.
This document controls accuracy requirements in the production, model, cost and
implementation plans. The objective is demonstrated 90%+ accuracy within a
declared research scope, not a claim to know the truth of every internet theory.

## What "90% accurate" means

Primary unit: one independently selected claim family, one frozen claim wording,
an as-of date and one complete system analysis. Pass only when independent human
adjudication confirms ALL of: correct disposition, identity/time/scope, materially
complete supporting and challenging evidence, citation meaning and attribution,
and appropriate uncertainty. A material error in any dimension fails the case.
Do not average a wrong conclusion with several correct incidental sentences.

Allowed dispositions: supported, contradicted, mixed (specify the components),
insufficient evidence, or not fact-checkable (opinion/prediction/unfalsifiable).
These describe available evidence within a documented scope, not universal truth.
"No supporting evidence located" cannot become "false"; an allegation in a court
filing cannot become a court finding. A mention or association does not establish
participation, knowledge, wrongdoing or identity.

Primary accuracy = passing cases / ALL eligible preregistered test cases.
A timeout, refused output, missing source or unsupported abstention is a failure
unless the independent reference says insufficient evidence is the proper
disposition AND the delivered analysis explains the evidentiary limitation.
Budget failures do not disappear from the denominator. A genuine not-fact-checkable
reference can pass, but its frequency cannot be inflated after testing.

Report two separate runs: unedited automated research/draft output and the
human-reviewed publication workflow. Human fixes cannot improve the reported
automation score retroactively. The publication workflow's tested review effort
must match actual operations. No published "AI accuracy" claim from human-corrected
results. No observed results exist yet.

## Primary release gates

- At least 200 held-out claim families, sampled before testing from the declared
  eligible claim registry; one randomly selected representative per connected
  family/source-chain group. No shared families/chains across tuning and test.
- Aim for >=95% observed primary pass rate AND a two-sided 95% Wilson lower
  confidence bound >=90%. Both are required; at 190/200 passes the lower bound
  is approximately 91.0%. A 90/100 result is insufficient (lower bound ~82.6%).
- Report observed per-disposition accuracy, macro-average across reference
  dispositions, and scope strata (old/new, primary/secondary, archive, scanned,
  disputed). Macro-average must be >=90%; missing classes are "not evaluated",
  not 100%. Pre-register >=20 examples per in-scope reference disposition; add
  a separate diagnostic challenge set if natural prevalence cannot supply them.
  Macro gate uses that diagnostic set when needed, clearly separate from the
  representative primary estimate. Do not pool oversampled cases into it.
- Correct resolution coverage >=70%: correctly supported/contradicted/mixed
  cases divided by all reference-resolvable cases. Also report all attempted
  resolution precision, raw abstention rate and appropriate-abstention recall.
  This is an initial product usefulness gate, not justification to force a
  conclusion. If it fails, improve evidence/review or reduce advertised scope.
- Zero known critical errors in the critical suite or actual launch content.
  Critical: fabricated evidence, incorrect person linkage, material quote
  reversal, allegation promoted to finding, misleading omission of decisive
  counterevidence, archive-time leakage, or exposed protected identities.
- Every launch article gets exact-version human approval; high-risk allegations
  and all benchmark reference labels get two independent qualified reviewers.
  Disagreements go to a third adjudicator or remain unresolved/research-only.
  A model reviewer is not an independent human reviewer.

The sample supports only its registered distribution. An Epstein-only evaluation
does not substantiate accuracy across all conspiracy theories or future events.
A repeated source set may leave dependence even after grouping; document it.
If groups cannot reasonably be treated as independent, do not apply a naive
binomial interval to 200 correlated claims. Expand independent groups or have a
statistical reviewer approve a cluster-aware analysis before claiming the gate.

Wilson computation uses z=1.959963984540054:
lower = (p + z*z/(2*n) - z*sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n).
For n=0 return null and "insufficient evidence"; reject invalid counts.
[NIST confidence-interval reference](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
These are project acceptance thresholds, not provider performance promises.

## Corpus, labels and leakage controls

The original 50-claim/300-pair pilot is DEVELOPMENT work, not proof of 90%.
Keep its grouped 60/20/20 split for initial debugging, but collect the 200-family
confirmation set separately; do not count its tiny original holdout as sufficient.
The 100–200-document estimate is not a cap: acquire enough evidence for each
case, including inaccessible-source logs and contradictions.

Before seeing model output, reviewers independently research each reference,
record label, rationale, exact passages, document versions, decisive contrary
evidence, scope and cutoff. Record disagreement and unresolved reference rate.
Freeze eligibility rules before sampling; ambiguous facts normally receive an
insufficient-evidence reference, not exclusion. Technically invalid or duplicate
cases may be excluded only by frozen rules with a complete exclusion log and
replacement drawn without inspecting output. No deleting failures after the run.

Freeze dataset hashes, grouping, labels, prompts, model versions, thresholds,
retrieval settings, evidence cutoff, review protocol and budget before the test.
Use validation only for threshold/model selection. A failed held-out set becomes
a regression set once inspected; confirmation after tuning requires fresh held-out
families. Keep versions of every report; no best-of-many silent retries.
Reference reviewers must be independent of draft authors/publication reviewers
and blinded to model identity/output while establishing labels.

Build a separate >=50-case critical challenge suite covering identity collisions,
negation, quote context, allegations/testimony/findings, retractions, outdated
evidence, absent/redacted text, OCR names/numbers, source copying, archive cutoff,
prompt injection and missing documents. Use synthetic identities for fabricated
adversarial allegations, not new invented accusations about real people.
Human labels are evidence-based judgments, not infallible ground truth; correct
label errors transparently and recompute all affected candidate scores.

## Accuracy interventions in the pipeline

1. Normalize claims without changing quantifiers, identities or timeframe; split
   compound claims and preserve links. Human review approves normalization.
2. Retrieve both support and counterevidence; log source scope and unavailable
   materials. Expand beyond top 30 when recall fails. Keep a random sample of
   Jev-rejected candidates for false-negative auditing; do not prune uncertain
   contradictions. Retrieval >=95% macro recall@30 over labeled claims and all
   critical counterevidence retained; also measure recall after Jev filtering.
   Local Task09 now implements deterministic saved-passage retrieval and audit
   with explicit bounded-search cutoffs. This implementation is not a recall
   result: the frozen independently labeled evaluation corpus, evidence-time
   cutoff, measured macro recall@30 and critical-counterevidence retention are
   still open. Do not infer completeness from unit, integration or resource
   bound probes; report cutoffs and broaden/manual-supplement when needed.
3. Check original bytes/pages, OCR and neighboring context. Dates and identity
   need corroboration appropriate to the claim; do not require an arbitrary
   two-source rule when copies are dependent or one original is decisive.
4. Jev classifies relevance, relation and evidence type separately. Evaluate
   each task's confusion matrix and class balance; calibrate thresholds on
   validation data. Model probability is not demonstrated factual accuracy.
   Relevance automatic-accept precision remains >=95%, with counts/intervals;
   automated discard needs >=95% relevant recall and zero critical suppression.
   Failed or underpowered components remain advisory with human review.
5. Writer cites evidence packets, not model memory. Reviewer actively searches
   for contradictory interpretation; multiple models agreeing is not independent
   evidence. Use a stronger model or manual drafting if the cheap path fails.
6. Verify every factual assertion and material omission, not just valid quote
   offsets. Report assertion support precision >=98% on independently reviewed
   assertions, with article-level grouping and uncertainty; this diagnostic never
   overrides a failed whole-case gate. Exact citation resolution stays 100%.
7. Review final headlines, summaries, search snippets and metadata as well as
   body text; a cautious body cannot rescue an accusatory headline.

## Accuracy monitoring and failure response

First month: independent post-publication audit of every article when volume
is <=30/month; otherwise preregister a random 30 plus all high-risk publications.
Report that random sample separately from targeted high-risk checks. Continue
monthly and after model/prompt/parser/retrieval changes; refresh benchmark with
new claim families and time-separated cases. Audit corrections and stale sources.
Report counts, intervals, critical errors, resolution coverage and review minutes,
not a dashboard number without its denominator.

A critical error immediately pauses the affected automated route, flags related
publications for review, and triggers correction/retraction and cache invalidation.
A primary gate or coverage regression pauses expansion and routes affected work
to manual research. Do not present a small rolling sample as fresh proof of 90%.
Re-enable only after root-cause repair, regression tests and a fresh confirmation
appropriate to the changed component. Preserve pre-correction performance records.

## Cost and release consequences

The $15–35/month service scenario is not an accuracy guarantee. Independent labels,
second review, more source acquisition, stronger models and expanded testing may
cost more. Rebudget from measured tokens and reviewer minutes after the first
20 development cases. The previous $10 live evaluation allowance buys only an
initial batch, not certification; a partial run cannot satisfy the gate.

When funds are limited, reduce publication cadence and reuse validated originals,
not evidence scope, independent review or failed-test denominators. Manual
publication can proceed only under its own approved editorial release scope;
without this benchmark it must be labeled unvalidated and cannot be represented
as completing the accuracy-qualified production milestone.

## Implementation mapping

- Tasks 02/08: versioned claims, dispositions, reference-label and adjudication
  records; actor separation and unresolved states.
- Tasks 06A/07/09: time-aware archive/extraction/retrieval critical tests and
  candidate rejection audit.
- Tasks 10/11/12: cost capture, validation-only thresholds and immutable runs.
- Task 13: development corpus and reference schema; NEW task 13A below in the
  production implementation plan adds confirmatory evaluation AFTER 14–16.
- Tasks 14–16/18–19: full-assertion checks, two-person high-risk review,
  exact-version approvals, headline/metadata review and safe insufficient state.
- Tasks 20/22–24: confirmatory gate, regression monitoring, staging evidence and
  launch status. No accuracy claim from unit tests or benchmark plans alone.

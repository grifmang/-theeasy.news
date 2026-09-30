# Production cost model

Rates checked 2026-09-20 from the primary sources below. USD, before tax.
These are estimates for explicit workloads, not a promise of free production.
Recheck rates, account-specific terms, credits, regional taxes, and availability
before purchasing anything. Free allowances are often shared with other projects.

## Recommended operating budget

Accuracy-first amendment: [ACCURACY_SPEC.md](ACCURACY_SPEC.md) takes precedence
over throughput/cost targets. The service scenario below does not price or prove
the 200-family independently labeled confirmation study. Reforecast after 20
development cases using measured source, token and reviewer costs. The $10
evaluation proposal covers an initial batch only; independent reviewers and
high-risk second review require separate capacity/funding. If unaffordable,
slow intake rather than relax the release gate or claim unmeasured accuracy.

Plan for $15–35/month in services for a small curated pilot, with an owner-set
ceiling before provisioning. Separate the bills into infrastructure, models,
discovery/OCR, and optional licensed sources. Domain renewal and editorial work
are additional. The starting production design uses one small persistent Node
service, static frontend hosting, private object storage, Jev, and an evaluated
writer/reviewer. A $0 month is not the reliability target.

Suggested initial control settings (proposals, not spending authorization):

- Infrastructure: $10–15 forecast target; alerts at 70% and 90% of the agreed
  monthly allowance. Do not use a low hard hosting stop that takes readers offline.
- Model work: $10/month, $1/day application reservation cap; model/provider
  ceilings enabled as a second defense. Raise only after measuring useful work.
- Discovery/OCR: $5/month optional reserve, no subscription without approval.
- Evaluation: up to $10 one-time allowance requested when the labeled set and
  candidate list are ready; default live evaluation is disabled.
- Human review: explicitly scheduled and costed separately. If capacity is
  exhausted, pause publication; do not weaken evidence standards.

These category limits may exceed a selected combined ceiling. The budget ledger
enforces both category and total allowances; unused categories are not permission
to exceed the total. High-growth scenarios require revisiting the ceiling.

## Verified rates and limits

| Service | Observed pricing | Consequence |
|---|---|---|
| Railway Hobby | $5 minimum/month includes $5 usage; published resource rates about $10/GB RAM-month, $20/vCPU-month, $0.15/GB volume-month, $0.05/GB egress | Bill is roughly max($5, resources), not $5 plus all resources |
| Railway Pro | $20 minimum including $20 usage | Select only for actual account/team needs; it does not remove SQLite single-volume limits |
| Netlify current Free | 300 credits/month; production deploy 15, bandwidth 20/GB, requests 2/10k | Several deploys plus modest bandwidth can consume free allowance |
| Netlify Personal | $9/month with 1,000 credits | Alternative if retaining Netlify costs less than migrating |
| Cloudflare Workers static assets | Static asset requests free/unlimited; Worker invocations separately metered | Candidate for static public pages; do not assume dynamic API/SSR is free |
| Cloudflare R2 Standard | $0.015/GB-month; 10 GB-month free; 1M Class A and 10M Class B free monthly; excess A $4.50/M, B $0.36/M; egress free | Small evidence/backups archive may fit free allowance; operations and retention still matter |
| Jev 1.13 | $0.042 per million input tokens; output free | Cheap passage judgments; large repeated context still costs money and can reduce accuracy |
| GPT-4o mini baseline | $0.15/M input, $0.60/M output | Existing low-cost writer baseline, not an evaluated production choice |
| GPT-4.1 comparison | $2/M input, $8/M output | Illustrative higher-cost non-reasoning comparator, not claimed to be best/current frontier |

Sources: [Railway pricing plans](https://docs.railway.com/reference/pricing/plans),
[Railway pricing](https://railway.com/pricing),
[Netlify pricing](https://www.netlify.com/pricing/),
[Cloudflare static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Jev models](https://docs.typesafe.ai/models),
[GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini),
[GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1).

Railway marketing per-second rates and monthly approximations differ slightly;
use the billing dashboard for reconciliation, not rounded estimates. Your
Netlify account may retain pre-September-2025 terms: inspect the actual plan
before applying the current credit table or changing providers. Cloudflare Pages
is another static option, with a documented 500 free builds/month; static Workers
pricing is not evidence that Pages Functions are unmetered.
[Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

## Reproducible workload calculation

Assume each researched claim evaluates 40 claim/passage pairs averaging 1,800
billed input tokens each, including question text. One analysis uses 8,000 writer
input and 2,000 writer output tokens. For conservative comparison, add one
12,000-input/3,000-output higher-cost review per analysis. A review may be
unnecessary in some workflows, but do not remove it until evaluation justifies it.

```text
Jev = claims × 40 × 1,800 / 1,000,000 × $0.042
baseline drafting = analyses × (8,000 × $0.15 + 2,000 × $0.60) / 1,000,000
comparison review = analyses × (12,000 × $2 + 3,000 × $8) / 1,000,000
```

| Monthly workload | Jev | Baseline writing | Comparison review | Model subtotal | With 50% retry/revision/eval contingency |
|---|---:|---:|---:|---:|---:|
| 25 claims / 25 analyses | $0.0756 | $0.06 | $1.20 | $1.3356 | $2.00 |
| 100 claims / 100 analyses | $0.3024 | $0.24 | $4.80 | $5.3424 | $8.01 |
| 1,000 claims / 1,000 analyses | $3.024 | $2.40 | $48.00 | $53.424 | $80.14 |

These are illustrative token workloads, not measured system bills. A real
analysis can contain several claims and require more passages, deeper review,
additional queries, or a stronger model. Recalculate with actual usage before
raising throughput. Reasoning-token charges, tools, images, OCR, embeddings,
search subscriptions, and human time are not included in these model subtotals.
Cached/batch discounts are excluded from the base estimate deliberately.

Example backend resources: average 0.5 GB RAM + 0.05 vCPU + 1 GB volume + 2 GB
egress ≈ $5 + $1 + $0.15 + $0.10 = $6.25/month on the published monthly rates.
At 1 GB RAM, 0.1 vCPU, 2 GB volume, 10 GB egress, estimate $12.80/month.
These are measured-average requirements to validate, not limits imposed on the
runtime. OCR bursts, builds, temporary staging, and log/backup retention add cost.

For 100 analyses/month, $6.25–12.80 backend + $0 static hosting within allowance
+ $0–2 storage allowance + $8.01 model scenario + $0–5 optional discovery/OCR
≈ **$14.26–27.81/month**, before uncertainty/headroom. Round to the $15–35 planning
range. Netlify Personal would add $9 if needed; paid source subscriptions or a
stronger required model can move the project beyond that range.

Example current Netlify credit calculation: 4 production deploys + 5 GB served
+ 100,000 requests = 60 + 100 + 20 = 180 credits. At 20 GB served the bandwidth
alone is 400 credits. Page views are not requests: scripts/images/citations add
requests and bytes. Do not equate 10,000 readers with a fixed bandwidth bill.

## The larger cost: editorial work

100 analyses at 20 minutes of review each is 33.3 hours/month before source
acquisition and difficult cases. At an illustrative $25/hour, that is about
$833 in labor. This is arithmetic, not a market-rate estimate. Owner labor
can reduce cash outlay but not the time requirement. Complex allegations can
take far longer. Record review minutes and correction rates per accepted article.

For 10 launch analyses, the earlier 20–50 hours is only a preliminary development
allowance, not a budget for the expanded accuracy study. For illustration,
200 cases × two reference reviewers × 30 minutes = 200 reviewer-hours before
adjudication, source acquisition, final-output grading or publication review.
Actual time may be higher; measure and re-estimate after 20 development cases.
Do not budget an expert researcher as free just because model tokens are cheap.

## Cost reductions that preserve the quality bar

1. Hash/store once; reuse a document across claims and a passage across analyses.
2. Conditional fetching and change-based reanalysis rather than hourly rewrites.
3. FTS shortlist plus measured Jev filtering; expand when recall is inadequate.
4. Batch independent Jev questions with shared state; don't send whole corpora.
5. Cache exact decisions by all input/version hashes, never just article URL.
6. Evaluate smaller writers; retain a stronger path when the same rubric fails.
7. Use local PDF extraction before OCR and OCR only relevant poor-text pages.
8. Serve precomputed public pages; readers never trigger paid generation.
9. Keep one persistent backend and a DB-backed queue; no idle auxiliary clusters.
10. Run nonurgent historical writing/evaluation in supported provider batches
    after implementing result reconciliation. OpenAI documents 50% lower cost
    and a 24-hour completion window; eligibility must be checked per endpoint.
    [Batch guide](https://developers.openai.com/api/docs/guides/batch).
11. Keep article text/evidence quality intact; reduce intake/publication volume
    when spending or editorial capacity is exhausted.

Avoid savings that create hidden costs: free trial dependency, replacing human
review with an unvalidated confidence threshold, browser-side API keys, cheap
SSRF-prone scraping proxies, untested OCR, repeated full-document prompts,
buying vector infrastructure before recall measurement, or using an always-on
GPU for a low-volume workload.

## Alternatives and decision rules

- Retain Netlify + Railway: lowest migration effort; preferred if actual legacy
  account usage fits available allowance and public rendering/cache tests pass.
- Cloudflare static assets + Railway: default alternative if Netlify traffic
  credits cost more; move only after comparing actual bills and migration effort.
- Serve frontend on Railway too: fewer vendors; acceptable if edge caching,
  HTML rendering, egress, and outage tests meet targets. Not automatically cheaper
  once bandwidth and availability are counted.
- Low-cost VPS: potentially cheaper invoice, but operator owns patching, TLS,
  restore, monitoring, and incidents. Do not select without accounting for labor.
- Fully serverless rewrite: revisit only if measured scale/cost makes it worthwhile;
  it replaces native SQLite/worker assumptions and increases near-term build cost.

## Release budget worksheet

Before provisioning, record actual frontend plan, backend measured RAM/CPU,
storage/backup size and retention, request/egress forecast, provider model IDs,
per-token/tool prices, approved source licenses, and owner-set caps in the
release record. Populate from evidence gathered in the implementation tasks;
missing fields prevent paid activation rather than silently defaulting to infinity.

Do not include the existing domain as free forever: verify its registrar renewal
price and expiry. Confirm whether other projects share credits and alerts.
CI minutes/build storage and coding-assistant subscription/usage are additional
development expenses; inspect the actual accounts before assuming included tiers.
# Archive intake budget note

Wayback lookup and supplied archive.is snapshot support do not assume a paid
subscription. Provider access/limits must be verified before automation. Cache
snapshots and limit discovery to claim-linked URLs; extraction, private storage,
model review and editorial time remain real costs within the existing budget.
See [Archival sources](ARCHIVAL_SOURCES.md); no unlimited availability assumption.

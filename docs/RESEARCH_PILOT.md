# Claim-centered research pilot

The product now targets evidence-based analysis of disputed claims, old and
new. RSS is one discovery channel. Topics organize claims; documents supply
passages; assessments describe the relationship between a passage and a claim.
An eventual article will synthesize these assessments with citations and dates.

The initial collection is `epstein` / `Jeffrey Epstein research`. No real claims
or documents have been populated by this implementation. Tests contain clearly
synthetic evidence only. Creating the collection asserts nothing about anyone.

## Implemented local intake

Run the existing backup-first migration on an isolated database to install
version 2. The migration preserves version 1 source snapshots and jobs and adds
topics, attributed claims, documents, topic/document links, exact passages, and
append-only human assessments. API/publication integration remains pending.

Prepare a JSON package with this shape (replace example content with reviewed
source text; this is illustrative, not an Epstein source):

```json
{
  "topic": { "slug": "epstein", "title": "Jeffrey Epstein research" },
  "documents": [{
    "source": "Source organization or publisher",
    "url": "https://example.com/document",
    "title": "Document title",
    "content": "Exact supplied text or reviewed extraction",
    "publishedAt": null,
    "kind": "court_filing",
    "originChain": "Original docket/document identifier",
    "extractionMethod": "Manual transcription checked against original"
  }]
}
```

Set absolute `DB_PATH` and run `npm run import-research --prefix server --
<absolute-package-path>` on one line. Input is bounded to 5 MB/100 documents;
each document is bounded to one million characters. The entire import rolls
back on invalid metadata. Reimporting identical data is idempotent. A changed
document creates a separate snapshot. An empty document list creates only a
topic. This command reads supplied text: it does not fetch URLs, parse PDFs,
call models, publish content, or queue the legacy generator.

Supported document kinds: web_page, court_filing, official_release, transcript,
report, social_post, other. Kind labels describe form, not credibility.
`originChain` identifies the underlying source so copies need not count as
independent corroboration; it is currently supplied by the operator, not inferred.

`server/research.js` exposes local operations to add attributed claims, import
documents, select exact passages, and record human assessments. Passage offsets
are JavaScript UTF-16 offsets into the retained extracted text. `locator` holds
a human-readable page/paragraph reference, which requires review against the
original. Offsets validate the text slice, not the accuracy of a page number.
Claims retain original wording, attribution, and origin URL and start unreviewed.
Relevance and relation are distinct fields; recording an assessment never
promotes a claim or article automatically. Corrections currently append records;
supersession and editorial review workflows are future work.

## First real research collection

Select a small set of explicitly worded, attributable claims and collect both
supporting and challenging documents. Prioritize original court records,
official documents, testimony, and source-linked reporting. Preserve dates,
document identity, and surrounding context. A name in a record, an allegation,
testimony, and a judicial finding must remain distinguishable. An absence in
the collected documents is not proof that an event did not occur.

Manually label passage relevance and its relationship to each claim. Include
irrelevant pages, mentions without support, conflicting sources, duplicated
reporting, and missing context. This becomes the held-out evaluation material
for Jev; do not use real unreviewed allegations as synthetic test fixtures.

## Next Jev work

Build a bounded adapter evaluating claim + passage + attribution/context.
Use separate Choice questions for relevance and support relation. Document
type cannot override the evidentiary meaning of a passage. Record model/question
versions, distributions, and confidence separately from human labels. Keep
Jev in shadow mode until measured against reviewed examples. Relevance is a
retrieval aid, not a truth verdict. Reasoning/writing and editorial review remain
necessary for a complete analysis.

Automated discovery, safe remote fetching, PDF/OCR extraction, document binary
archival, Jev requests, claim-specific worker queues, and public analyses are
not yet implemented. Existing RSS jobs still classify source items, not claims.

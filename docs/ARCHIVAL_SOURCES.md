# Historical web archives

Production design, 2026-09-20; updated implementation checkpoint 2026-09-22.
The bounded Wayback discovery core exists locally; production connectors and
archive discovery is not enabled in production. Local Wayback receipt intake now
requires fixed replay URLs and matching Memento capture metadata.

## Local implementation and live compatibility check

`server/discovery/wayback.js` implements lookupCaptures with an explicit transport
adapter, not unrestricted built-in networking. It requests at most 100 CDX rows,
limits decoded response bytes to 1 MiB, has a ten-second deadline/cancellation,
enforces an inclusive UTC cutoff locally, validates exact original URLs/calendar
timestamps and fixed snapshot URLs, deduplicates identical records, and rejects
conflicting metadata. HTTP/HTTPS and www aliases are not silently merged. Missing
captures are an empty discovery result, not a claim of deletion or censorship.
Captures carry contentVerified=false, requiresReview=true and captureTimeSource=
cdx_index. The archive's digest is not our original-byte SHA-256. Replay ingestion
must independently verify actual capture, redirects, bytes and completeness.

Read-only compatibility checks against official endpoints on 2026-09-22 succeeded:
the availability query for example.com near 20200101 returned 20200101231047,
after a midnight cutoff. A two-row CDX query with a to cutoff returned bounded
JSON records. This confirms endpoint shape, not uptime or access authorization
for other URLs. No Save Page Now request or source-content crawl was performed.
Implementation follows the [official CDX contract](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server).

Wayback receipt validation rejects missing/mismatched Memento-Datetime, changed
captures, nested archives and live-fallback redirects before preserving bytes.
Extraction rechecks immutable receipt metadata, records original/archive URLs and
capture/retrieval times in the manifest, and groups copies with their original
source URL. Agreement of provider metadata does not authenticate the page or its
claims; replay completeness remains unverified and explicitly requires review.
The archive.is FAQ returned HTTP429 on the next check; no retry/bypass was made.
archive.is/archive.today intake is held for reviewed metadata rather than silently
treating those copies as unrelated ordinary pages.

Still required: approved CDX transport, shared rate/daily budgets,
cache/backoff, archive.is snapshot metadata, deeper replay contamination checks,
UI and release verification. The discovery module
has no public endpoint and cannot make requests without an injected adapter.

## Recommendation

Include Wayback Machine as the first historical discovery connector and accept
editor-supplied archive.is/archive.today snapshot links. Archives are a capture
and preservation layer, not a separate credibility category. A preserved rumor
is useful evidence of the rumor's wording, not proof of its underlying allegation.

Wayback documents availability lookup, CDX capture discovery and Memento support.
Its availability endpoint returns the closest capture, which can fall AFTER a
requested date. Validate actual capture time before using it in an as-of account.
The documentation is longstanding; validate current endpoint behavior before
enabling automation. [Official API documentation](https://archive.org/help/wayback_api.php).

Archive.is documents Memento support, but this plan has not validated its current
automation limits or reliability. Start with exact snapshot links; never use a
mutable newest/oldest link as the citation identifier. Its FAQ says PDFs, video
and audio are not captured; retrieve those through separate authorized document
sources. [Official FAQ](https://archive.is/faq).

## Evidence and data contract

Record original URL, exact archive URL, provider, actual capture timestamp,
retrieval timestamp, claimed publication date separately, content hash, MIME,
extraction version, source chain, access policy, and completeness/review flags.
Preserve requested discovery date separately from the actual capture date.
Document versions can share a source chain without sharing identical content.
Store original bytes privately where permitted; publication rights are separate.

An original plus two archive copies remains ONE originating source. An archive
capture date is neither proof of first publication nor proof that a claim was
known before that capture. Missing captures do not establish deletion, censorship,
or that a page never existed. A visible change warrants contextual examination,
not an automatic allegation of concealment.

Wayback warns of incomplete captures and navigation that may use another capture
or the live web. Inspect the actual page and capture dates; do not silently treat
linked resources as contemporaneous. [Wayback help](https://help.archive.org/help/using-the-wayback-machine/).

## Jev's role

Evaluate whether the captured passage concerns the particular claim, whether it
provides direct evidence or repeats an assertion, and whether the apparent change
is material. Provide original context, date and provenance to these decisions.
Deterministic code enforces date bounds, hashes, access and deduplication; Jev
does not authenticate snapshots or decide truth from archival availability.
Ambiguous or incomplete extracts require human review. All launch publication
still requires editorial approval under the main production plan.

## Safe, inexpensive intake

1. Editor supplies a claim and original URL or exact archive snapshot.
2. Perform bounded capture discovery when needed; cache positive lookup results
   seven days and negative results 24 hours as initial local policy.
3. Start with one request/second and 200 lookups/day, reducing to comply with
   provider instructions. These are OUR limits, not promises of provider quota.
4. Fetch the selected exact snapshot through the same SSRF, size, timeout and
   redirect checks as other sources. Never execute archived scripts or load live
   subresources as part of extraction. Challenge/error pages are not evidence.
5. Hash, extract, link to the originating source chain, retrieve passages, and
   run bounded relevance checks only on new or changed evidence.
6. Show original and archive links plus capture date and limitations to readers.

Do not bypass access restrictions or CAPTCHA. Review current access terms before
bulk use; an available snapshot is not blanket redistribution permission. No
automatic Save Page Now submissions: publishing a URL to a third-party archive
is a separate disclosure, especially for private or token-bearing URLs.

## Acceptance and cost

Implementation task 06A covers cutoff errors, missing captures, multiple archive
copies, changed content, live fallback, malicious replay content and restrictions.
Include archive examples in the held-out relevance/citation evaluation and UI
review. Keep provider failure nonfatal: an inaccessible source becomes a stated
coverage gap, not fabricated evidence.

No archive subscription is assumed in the base budget. This is not a guarantee
of unlimited free service. Fetching, storage, extraction and human verification
consume the existing ingestion budget; reforecast if historical research raises
volume. Cache by snapshot/hash and prioritize claim-linked URLs over bulk crawls.

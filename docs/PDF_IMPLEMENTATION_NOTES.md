# PDF implementation boundary — 2026-09-26

Task07 continuation notes, not implemented PDF support or a release approval.
The controlling production plan already requires native text first, local OCR,
rendered citation checks and bounded network-isolated execution.

## Verified current constraints

- `server/evidence/extract-fetch.js` unconditionally decodes original bytes as
  fatal UTF-8 before choosing HTML/plain extraction. PDF dispatch must occur before
  that decode. Do not label PDF byte offsets as HTML UTF-16 source offsets.
- Its immutable manifest currently records `sourceLength` as decoded characters.
  A PDF manifest needs explicit byte-length and page-coordinate semantics; existing
  manifests must remain unchanged and old readers must remain supported.
- `html-process.js` assumes JSON stdout, a five-second deadline and 8MiB output.
  Poppler stdout is not that JSON contract. Do not route it through this helper or
  loosen the existing HTML limits merely to make a PDF work.
- `native/parser-bundle.js` packages a specific Node/parse5 runtime and verifies
  those dependencies. PDF tools need a distinct sealed/versioned bundle with
  required libraries, font data and licenses, not a mutable system executable
  selected by a request.
- The native launcher accepts operator-owned executable arguments and document
  stdin, denies new processes/network and limits address space to512MiB. Native
  text, rendering and OCR must each be launched independently by the supervisor;
  an in-sandbox process cannot launch the next tool.
- Existing passage locators are editor-provided strings. A typed page/box locator
  must bind the original hash, extraction version and immutable text range before
  it can support rendered citation verification.

## Tool evaluation

Official Debian [pdftotext documentation](https://manpages.debian.org/bookworm/poppler-utils/pdftotext.1.en.html)
confirms stdin/stdout support, page-range selection, UTF-8 output, word/line/block
bounding-box output and distinct error exit codes. It warns that some font
encodings cannot be extracted without OCR. Layout extraction is best-effort, not
proof of reading order or fidelity. The documented package version is not a
security-approved runtime pin; resolve and audit the actual build packages first.

Selected direction within task07: evaluate Poppler native text plus coordinate
output, independently rendered originals, then local OCR only for pages that lack
usable native text. Do not silently accept truncated documents, encrypted inputs,
blank OCR, scrambled tables, hidden/redacted text or missing font resources.
No model-based text repair. Every extraction remains review-required.

## Next implementation sequence

1. Build a separate pinned PDF tool bundle in a disposable Linux environment;
   verify actual text, metadata and renderer operation under the existing launcher.
   Check encryption and page count before bounded per-page work. Prove cleanup,
   cancellation and failure behavior without weakening HTML isolation.
2. Add a PDF-specific supervised process adapter with bounded stdout/stderr,
   deadlines, concurrency admission and abort-to-close fencing. Use fixed argument
   arrays, generated scratch names and original bytes; never source filenames.
3. Introduce page/box mapping and immutable PDF extraction metadata, then wire
   receipt integrity/auth checks and editor API/UI behind a disabled runtime flag.
4. Add bounded local OCR and explicit uncertainty; compare critical names, dates,
   amounts, footnotes, tables and redactions to rendered pages before acceptance.
5. Follow owner policy: no new unit tests; use build/integration checks now and
   write E2E coverage after implementation. Existing accuracy/security gates remain.

## Disposable Linux compatibility evidence

Sep26 installed `poppler-utils=22.12.0-2+deb12u3` in a local Docker probe only
(Debian security candidate, not a completed security approval). Image:
`sha256:8e6b1d638d1e412e2d9c8c1581e9caf143d13eff2a8aafe7749069f23e1b4c99`.
Probe source outside the repository:
`C:/Users/grifm/AppData/Local/Temp/easy-pdf-probe-ff4f7ba5-cdd1-44c9-8ab7-84d508dc8540`.

UID1000/network-none/cap-drop-all/no-new-privileges, existing native launcher,
synthetic one-page PDF through stdin:
- `pdfinfo`: exit0, one page,306 output bytes, no diagnostics.
- `pdftotext -bbox-layout`: exit0, retained synthetic123.45 amount,894 bytes,
  no diagnostics. Basic compatibility, not fidelity proof.
- `pdftoppm`: exit0 and PNG signature, but rendering NOT accepted: unreadable
  `/etc/fonts/fonts.conf` and missing Helvetica diagnostics. A543-byte PNG and
  successful exit do not establish that text is visibly rendered.

Next: bundle restricted font/config resources and verify visible names/numbers;
do not broaden access to `/etc` or equate exit0 with a fidelity pass. No application
code/new unit tests/production activation/data access/model calls. Task07 incomplete.

### Font-resource follow-up

The same disposable probe now packages DejaVuSans.ttf and a minimal fonts.conf
inside `/opt/pdf-probe`. A tiny root-owned compiled renderer wrapper, executed
inside the sandbox, supplies only fixed LANG/FONTCONFIG_FILE and XDG_CACHE_HOME
derived from the launcher's private scratch cwd, then execs the packaged renderer.
Fontconfig cache writes stay under scratch; no `/etc` or general font-directory
access was added. This wrapper remains experimental, not application code.

Final probe image
`sha256:1c79b9b7483c70de5e99782458534045a2ed8ba3948dff6e7b6d25f39bc8b3e6`:
metadata/text/render all exited0 with zero diagnostic bytes. Rendering emitted
9514 PNG bytes at1200-pixel height. Viewed `render.png` in the probe directory:
"Evidence 2026 amount 123.45" is visibly intact. Earlier PNG-signature-only
evidence remains insufficient; this visual observation covers this fixture only.
Substitution with one font is not adequate for production font/Unicode/math/table
coverage. Next: turn this feasibility result into separately sealed/pinned PDF
packaging and supervised bounded extraction, then broader fidelity/denial checks.

## Internal process adapter implemented

`server/evidence/pdf-process.js` now accepts bounded PDF bytes and only three
fixed operations (metadata, one-page bbox text, one-page1600px rendering). It
rejects unsupported platforms/invalid pages, uses no shell/environment/filename
input, caps output at8MiB, limits wall time to5s, rejects diagnostics/nonzero exit
and fences settlement on child close after cancellation. Errors do not contain
document diagnostics. This is NOT bundle verification or API authorization;
trusted packaging verification, concurrency and scratch ownership are explicitly
caller responsibilities and have not yet been wired for PDF.

Syntax check passed. Actual UID1000/network-none/cap-drop-all/no-new-privileges
probe mounted the application adapter read-only and ran metadata/text/render:
306/894/13622 output bytes, respectively, all accepted without diagnostics.
The probe retained synthetic text/amount and PNG signature checks. Cancellation,
timeout and output-overflow rejection paths still require integration evidence.
No new unit tests, API route, production dependency or activation added.

### Failure lifecycle integration — verified follow-up

Disposable image `sha256:0960abb34e0df56c7ce5e3b84c0715445967cdad70d70aba9f06fdc755bb8489`
ran the actual application adapter with real sandboxed native processes (no spawn
mocks). Corrupt PDF rejected11ms; nonexistent launcher3ms; cancellation of a
deliberately stalled process103ms; timeout5001ms; >8MiB stdout overflow11ms.
Every rejection exposed only the generic error and `/proc` showed no remaining
child at settlement. Successful metadata/text/render operations passed afterward.
These checks supersede the missing failure-lifecycle evidence above. The stall
and overflow binaries exist only in the disposable probe, never release inputs.
Encryption, fidelity, production bundle validation, full document limits and
concurrent service admission remain separate unfinished requirements.

## Page mapping implementation

`server/evidence/pdf-page.mjs` maps one bounded bbox-layout output to exact UTF16
word ranges and top-left PDF-point boxes with page dimensions. It bounds nodes,
depth, words, text, dimensions and coordinates, rejects invalid structures and
requires review for reading order/rendered fidelity. No-native-text pages flag OCR.
Verified against actual saved Poppler output:4 words,612x792 page, exact synthetic
sentence and123.45 quote span. Poppler's XHTML Transitional doctype causes the
HTML5 `non-conforming-doctype` diagnostic; that diagnostic alone is tolerated
(parse5 does not resolve DTDs). Other parse errors reject. No HTTP wiring yet;
the mapper must be packaged into the isolated PDF worker before accepting remote
documents. This check used the synthetic fixture, not untrusted production bytes.

### Isolated mapping worker

`pdf-map-worker.mjs` now reads bounded bbox bytes, validates the supervisor-supplied
page ordinal and emits bounded JSON only after complete mapping. Errors emit no
source/stack/partial result. Syntax check passed. The actual worker and mapper were
mounted read-only into the disposable Node runtime and run through the native
launcher with jitless/96MiB heap, network-none and capabilities dropped. Real
Poppler output mapped to the expected sentence/four words/page1. This proves
worker compatibility, not a sealed bundle: the mounted files were deliberately
outside the old HTML manifest. Never use that manifest to attest these additions.
Next package a distinct PDF runtime manifest with these files, tools/fonts and
licenses before exposing a service/API path. HTML bundle remains unchanged.

## Separate PDF build implemented

`server/ops/build-pdf-bundle.js` creates a new bundle only, using the existing
Node/parse5 packaging as its base (including its unused HTML worker), then adds
PDF tools, mapper/worker, renderer wrapper, font/config and copyright files.
It checks installed Poppler/libpoppler22.12.0-2+deb12u3 and DejaVu2.37-6, hashes
all89 files, verifies the inventory, seals read-only and writes an external digest.
`native/pdf-render.c` derives fixed config/renderer paths from its own absolute
executable path and cache from the sandbox cwd; no ambient environment survives.
Fonts.conf pins the runtime directory, so this bundle is not relocatable.

Actual root Linux build in the disposable image compiled with Wall/Wextra/Werror
and succeeded: manifest
`4a3b9600631747780368116204b17aed836fc81b022b2de83a821e57fc50e52c`,89 files.
The disposable container was removed; this digest is evidence, not a retained
release artifact. Source syntax check passed. No production Dockerfile changes.
System shared libraries still come from the image, so the final image digest and
dependency review remain required. One fallback font is not full fidelity support.
Next: PDF-specific runtime validation (kind/package/required-file/root ownership,
external digest and actual extraction preflight), retained candidate image and
API integration. Do not treat the generic inventory verifier as an activation gate.

## PDF startup gate implemented and exercised

`pdf-runtime.js` now reuses the full root-owned/sealed-file/ancestor/capability/
external-digest/private-scratch HTML-base gate, then verifies PDF manifest kind,
fixed package versions, installed path and required files/executable permissions.
It runs synthetic metadata, native text, isolated mapping and rendering; all
children close before fresh scratch cleanup. PNG checks establish availability,
not arbitrary-document rendering fidelity. The JSON lifecycle helper is reused
only for the mapping worker, not native tool output.

Actual disposable Linux rebuild reproduced manifest4a3b9600...e52c. Startup gate
ran as UID1000, reported ready/pdf-native-v1 and empty scratch afterward. Syntax
check passed. Build ran as root, service probe as1000; no production changes or
new unit tests. Tamper/ownership failure cases for this PDF-specific composition,
encrypted-document handling, global page/work limits, service admission and API
integration are still outstanding. Full task07 remains incomplete.

## Document-level native extraction

`extract-pdf.js` now accepts only a runtime identity returned by the completed
startup gate (in-process WeakSet, frozen configuration). It rejects ambiguous or
encrypted metadata, caps200 pages/25MiB input/1M UTF16 text/50k words/64MiB rendered
bytes/60s total time, runs per-page native extraction→isolated mapping→render and
retains page maps, word boxes, rendered bytes/hashes and original hash. Individual
process limits still apply. Form-feed separators are not attributed to a page.
All results require review; pages without native text explicitly require OCR.
No claims of OCR completion, fidelity acceptance or publication eligibility.

Actual Linux rebuilt-bundle UID1000 integration passed: exact synthetic sentence,
1 page,4 words,1 render13622 bytes, scratch empty afterward. Syntax check passed.
Document-wide limit/encryption/adversarial cases are implemented guards but not
yet individually verified; do not extrapolate from the one-page integration.
No API/persistence/service-admission wiring or production deployment yet.

## Internal service admission implemented

`pdf-service.js` validates the runtime at creation, admits one extraction without
queueing, takes an owned copy of admitted input, rejects concurrent requests and
stops admission before cancelling/draining active work. Real UID1000 sandbox
integration passed successful1-page extraction, busy rejection, stop cancellation,
post-stop rejection and empty scratch. This internal byte service is not an
authenticated receipt endpoint. A combined HTML/PDF resource budget must be
considered before enabling both; single-instance/single-replica assumption remains.

Storage inspection: current `archiveOriginal` can store bounded private PNG bytes,
but `original_objects`/`document_originals` represent originals. Derived renders
must get explicit extraction/page/hash provenance, not be mislabeled as originals.
Plan a backup-first schema change for render records and private retrieval before
persisting API results; do not silently discard rendered verification evidence.

## Local schema22

Migration022 now adds immutable `extraction_renders`, keyed by extraction/page,
with content-addressed PNG key/hash, size, dimensions and renderer version.
Original provenance is reached through the extraction foreign key, not duplicated
or mislabeled in original_objects. Local app requires22; production stays21.
Repeat migration/in-memory integrity/FK checks passed. Existing migration/storage
checks27/4 suites passed after version expectations and legacy16 fixture teardown
were maintained; no new cases added. No actual production migration performed.
Persistence helpers/private retrieval/intake wiring remain next. A fresh backup-
first21→22 cutover is mandatory before deploying this local application state.

## Internal receipt persistence verified

`extractFetchPdf` now verifies editor role/receipt/original bytes, dispatches binary
PDF without UTF8 decoding, stages private rendered bytes and commits schema2
extraction metadata plus immutable render records in the same SQLite transaction.
`pdf-renders.js` checks PNG/hash/dimensions/budgets and keeps derived records out of
original_objects. Rechecks authorization/cancellation before DB commit. Byte store
and SQLite are not atomic: failed commits retain orphan bytes for reconciliation.
Fully scanned PDFs with no native text still cannot import until OCR is implemented.

Actual isolated UID1000/schema22 integration with real Poppler: repeated receipt
intake returned the same document,1 extraction/1 original/1 derived render13622
bytes, verified stored hash and no FK violations. Initial probe correctly rejected
a service-owned scratch ancestor; fixture relocated scratch directly under root-
owned /tmp, without weakening runtime checks. Existing text/HTML suites30 checks
passed; no new unit tests. Source bundle103 files/484408 bytes, digest
`474c32ee32b7976dc46ecdde658b4c12360e5b4b0824517dd8d36608e77dd12f`
retained at the disposable probe directory's `intake-source` child.
Next bootstrap/API/private render retrieval/editor UI. Admission currently bounds
parsing, not the complete receipt persistence phase; resolve before API exposure.

Full receipt admission is now implemented: `pdf-service.extractReceipt` holds the
same slot across authorization, original read, parsing, rendered-byte staging and
transaction commit. It calls the internal parser directly rather than reacquiring
its own slot; byte extraction and receipt intake share admission. Stop cancels and
drains this entire operation before a caller can close the DB. Verified in the
actual UID1000/schema22 intake probe: concurrent receipt refused as pdf_busy,
first succeeds, subsequent repeat stays idempotent with one extraction/render.
No API/bootstrap wiring or remote change yet.

## Editor comparison UI

`PdfPageReview.jsx` displays one private rendered page beside its exact extracted
text range; selectable read-only text, labeled page selection, OCR warning,
image-load failure and full-size link. Layout uses existing desk tokens and
stacks on mobile. ExtractionReview passes source evidence through, and PDF intake
is shown only when the API declares extraction available. No new unit/E2E tests.
Existing review/intake12 checks passed; lint/build passed after replacing an
inaccessible focusable pre with a read-only textarea. Browser/visual review of
the new comparison flow remains pending; build is not proof of UI correctness.

## OCR compatibility probe

Disposable Debian candidate: tesseract-ocr5.3.0-2 and English data1:4.1.0-2,
copied into the read-only probe runtime; no host/production dependency install.
Image `sha256:b498caa68ec92704abd08758e02e23581b6e81903d19cbca21c5bd8a1945e6d9`.
Native launcher, UID1000/network-none/cap-drop-all/no-new-privileges, PNG stdin,
fixed eng/150dpi/psm3/TSV options: exit0,378 output bytes,no diagnostics, exact
synthetic sentence and123.45 value recovered. Scratch cleaned afterward.
This is English compatibility only, not scanned-document accuracy or a production
pin/security approval. Next sealed OCR data/tool packaging, bounded TSV mapping,
per-page native/OCR provenance and explicit review uncertainty; no automatic
acceptance from confidence. OCR is not yet in the application extraction path.

OCR mapping is now implemented in `ocr-page.mjs`/`ocr-map-worker.mjs`: bounded TSV,
strict header/rows/dimensions/confidence, UTF16 word spans, image-to-PDF-point boxes,
English/OCR provenance, low-confidence count and mandatory review. Actual sandbox
integration fed real Tesseract output into the isolated mapping worker:4 words,
exact synthetic sentence/amount, OCR-derived and review-required. No new tests.
The files were read-only probe mounts, not yet included in a sealed OCR manifest.
Next high-resolution OCR raster operation, sealed Tesseract/data/licenses and
document fallback integration; real scanned-page fidelity remains unmeasured.

## OCR document fallback integrated

`extract-pdf.js` now keeps native extraction as the first choice and invokes the
4096px raster, fixed English Tesseract TSV and isolated OCR mapper only when the
native mapper reports zero words. Combined text and UTF-16 span budgets still
apply. Each page and span records native/OCR provenance; OCR pages retain
low-confidence counts and mandatory review. Pages on which OCR finds no text are
explicitly listed as unresolved rather than treated as evidence of absence. The
stored comparison rendering remains the separate bounded 1600px image.

The extractor version is now
`poppler-22.12.0-deb12u3-tesseract-5.3.0-eng-v1`. Existing records therefore do
not collide with the earlier native-only output. Editor copy distinguishes an
OCR-derived page from one still unreadable and states the English-only limit.

Disposable real integration rebuilt the sealed95-file bundle (digest
`322b37fd363a5a18efb269c7c8e84f48eed0437fc616f01ace3e42788912b59e`), then ran
an image-only PDF through the actual runtime/extractor as UID1000 with no network.
It recovered `Evidence 2026 amount 123.45` as four OCR spans, retained mandatory
review and the ordinary render, and left scratch empty. A blank image-only PDF
was explicitly unresolved. Backend affected regressions passed50/50; frontend
affected regressions passed12/12; lint and production build passed. No new unit
or E2E tests were added. This is not a general fidelity evaluation: multilingual,
multicolumn, tables, footnotes, redactions, encrypted/adversarial inputs and
browser comparison remain release gates. Nothing was deployed or enabled.

## Production image packaging and focused security closure

The staged production Dockerfile now installs the pinned Poppler, DejaVu,
Fontconfig and English Tesseract build inputs, builds the separate PDF/OCR bundle,
copies its external digest into the final image and creates the private PDF
scratch parent. CI now executes `check-pdf-runtime.js` beside the HTML runtime
gate. The feature remains opt-in and disabled.

Security review demonstrated two P1 escapes in the earlier common launcher: a
sandboxed process could use queued-signal syscalls against the same-UID API parent
and could change permissions outside scratch because Landlock does not mediate
filesystem metadata. The launcher now denies both queued-signal calls plus
permission, ownership, timestamp and xattr mutation, explicitly including the
x86-64 `fchmodat2` number. Harmless disposable regression probes showed signals
blocked and an outside0600 sentinel unchanged. Existing native sandbox checks
passed14 applicable,1 optional skipped.

The review also identified aggregate scratch exhaustion. Production launchers now
compile with `PARSER_SANDBOX_READONLY_SCRATCH`, denying all file creation/write in
scratch. To retain rendering, build-pdf-bundle creates a deterministic Fontconfig
cache against the final absolute font path and includes it in the sealed manifest;
the runtime rejects bundles without a manifest-covered cache. A second clean build
reproduced the same PDF bundle digest. Direct file creation through the final
launcher was denied, while HTML/PDF startup, rendering and OCR still passed.

Exact local candidate evidence:

- staged source:106 files, digest
  `797fecbb95d94f430e26084093afab76077c888e621b01427ba8803d0cad1837`;
- PDF/OCR bundle:97 files, digest
  `16339c525fab762d5049f2a70b64c2bb08a99a09fbf2562536ca6b43bb2f2932`;
- image:
  `sha256:e0e63fce14cb5e95fc8965c6005db059b4b6b693a48da38295e902afbff7a380`,
  default user `node`.

As UID1000 with network disabled, all capabilities dropped and no-new-privileges,
the exact image passed both runtime preflights. Its real image-only PDF recovered
the exact sentence/amount as four OCR spans; the blank page stayed explicitly
unresolved; scratch was empty. A focused Astra re-review closed the two P1s and
scratch P2 for this image, but not for alternate builds lacking the read-only
flag. Production-host enforcement, broader fidelity/adversarial documents,
browser review, hosted CI, schema23 migration and deploy remain unverified.

## Synthetic fidelity and adversarial corpus

The exact candidate image then processed a disposable offline corpus generated
outside the repository. Native fixtures covered two-column reading order, a
ruled table, a bottom-of-page footnote and a visibly redacted value. An image-only
fixture exercised OCR. Extracted names, dates, counts and currency amounts all
matched the source, while every extraction stayed mandatory-review and OCR kept
its derived/English-only warnings. The rendered comparison PNGs for these five
layouts were exported from the extraction result and visually inspected against
the expected content; no hidden numeric value appeared for the redaction.

Encrypted and malformed files rejected. A live `AbortSignal` stopped an 80-page
document, leaving scratch empty. An option-like filename containing shell syntax
was never passed to a child tool and created no sentinel. A PDF document-level
JavaScript action was not executed; extraction returned only page content. No
case was accepted based on OCR confidence alone.

This is synthetic release evidence, not a claim of arbitrary-document fidelity.
The retained disposable corpus, JSON log and exact PNG renders are under
`C:\Users\grifm\AppData\Local\Temp\easy-pdf-fidelity-20260926`. Actual editor
browser comparison, multilingual and varied real-world documents,
production-host enforcement, hosted CI, migration and deployment remain open.

The corpus was rerun unchanged against the later schema23 candidate image
`sha256:fdfd0008f534822d67cf2f275630cd6f028e650a8a5dee59c7ac01428f3daa0d`;
all cases remained ready with empty scratch. The PDF bundle digest remained
`16339c525fab762d5049f2a70b64c2bb08a99a09fbf2562536ca6b43bb2f2932`.

## Task15 citation projection

Evidence packets now derive a bounded page-map projection from the latest
accepted Poppler manifest whose text hash matches the immutable document. Only
the passage-overlapping page ranges, allowlisted word boxes, render hashes and
dimensions are projected; private render keys are not. The projection binds the
passage text and UTF-16 offsets and derives the canonical page locator. Task15
blocks a PDF assertion when the stored locator conflicts, mapped non-whitespace
characters are missing, hashes or render metadata disagree, or the current
trusted database packet no longer matches the draft. This connects preserved
extraction evidence to mechanical citation checking; it does not replace human
rendered-original comparison or establish general PDF/OCR fidelity.

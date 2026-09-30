# Production dependency triage — 2026-09-20

## Vite migration — 2026-09-22 (local only, latest)

User-approved CRA removal replaces build/test tooling with Vite 8.3.0,
Vitest 5.0.1, @vitejs/plugin-react 6.1.1 and jsdom 30.1.1. Exact lockfile
resolved in clean temporary directory, then installed with npm ci --ignore-scripts
in the frontend; no forced peer resolution. Full frontend audit now reports
zero findings (139 packages audited vs 1371 previously). Backend production
audit also reports zero. All 31 frontend tests plus public-config and compiled
asset smoke tests pass; Vite build and synthetic Edge intake workflow pass.
Updated Testing Library removed old act deprecation noise. Corrected duplicate
list keys and repeat-selection erasing saved status exposed by newer jsdom.
Legacy CRA dependency findings below are historical, not retained exceptions.
Explicit lint replacement is now verified: ESLint JS/React/Hooks/accessibility
with zero warnings required before build; invalid-fixture enforcement test passes.
31 UI tests and lint-gated build pass. ESLint 9.39.5 is unsupported upstream,
but is the newest major accepted by the chosen React and accessibility plugins;
this is a documented development-tool maintenance risk, not a runtime waiver.
Audit after adding lint dependencies still reports zero findings.
No release clearance implied: browser support target review, Linux-host install
and other full-plan security gates remain.

## Backend UUID remediation — 2026-09-22 (local only)

Scoped npm overrides pin gaxios and node-cron's UUID dependency to 11.1.1,
which retains CommonJS support. Their installed call sites use v4; the reported
GHSA-w5hq-g745-h8pq vulnerability concerns buffer handling in v3/v5/v6.
No parent-library major upgrade or forced audit fix was used.

Verification: tests first detected the old UUID versions, then passed with the
override. Real stopped cron task creation/execution and gaxios multipart body
creation pass without network access. Full backend: 469 tests / 53 suites pass.
Both install audit and production-only audit report zero vulnerabilities.
This is local lockfile evidence, not target-host installation verification or
full release clearance. Frontend advisories and deployment security gates below
remain separate. Revisit these overrides when upgrading the parent libraries.

## Frontend compatible update checkpoint

Follow-up 2026-09-22 (local only): upgraded react-router-dom from installed
6.30.6 to exact 7.18.4, removing the router advisory entries. React 18 satisfies
its peer requirement; package requires Node >=20 (local verification uses 22).
All 31 frontend tests / 5 suites pass and production build passes. Added real
router navigation and anonymous editor-to-login redirect coverage. CRA Jest 27
needs a moduleNameMapper for react-router/dom to the package's declared CommonJS
export and TextEncoder/TextDecoder globals in jsdom; these are test-only bridges,
not mocked routing. Revisit when replacing CRA. Browser verification of this
major upgrade passed in Edge using synthetic local data (login/redirect, lazy
research desk, intake/extraction, logout); target-host build verification remains
pending. Not deployed.
Current audit: 28 findings (9 low, 5 moderate, 14 high), listed under CRA build,
test, and development dependencies. This does not waive build-chain exposure.

Ran `npm audit fix --prefix theeasynews --ignore-scripts`, without force.
It changed 95 packages, added 19 and removed 18 within manifest constraints.
The resulting audit reports 30 findings: 9 low, 7 moderate, 14 high, zero
critical. Full frontend tests pass: 19 tests / 3 suites. This is not clearance
for release: react-router is among the findings, alongside CRA build/test
dependencies (SVGO, PostCSS, serialization, jsdom, dev-server and others).
Do not accept npm's proposed react-scripts@0.0.0 downgrade as remediation.
Review runtime routing separately from build-only exposure and migrate or
patch the affected toolchain deliberately. Do not expose the development server
as production hosting or build untrusted supplied code/assets with secrets.

## Compatible update checkpoint

Ran `npm audit fix --prefix server --ignore-scripts` without `--force`.
Updated the backend lockfile within existing manifest ranges (42 changed,
7 added, 3 removed packages). No lifecycle scripts were executed by this update.
The command exits 1 because advisories remain, not because updates were skipped.

Fresh `npm audit --omit=dev --prefix server` reports **3 moderate, zero high,
zero critical** findings: uuid and its dependent gaxios/node-cron packages.
Full backend suite after updating: **281 tests / 37 suites passed**.
Installed versions include body-parser 2.3.0, express-rate-limit 8.7.0,
node-cron 3.0.3 and rss-parser 3.13.0. Native SQLite remains 11.10.0.

Installed source inspection found uuid.v4() calls in node-cron's scheduling,
storage and background-task code and gaxios's multipart boundary creation.
The remaining advisory concerns v3/v5/v6 with an output buffer. This narrows
observed applicability but is not a blanket waiver or a complete transitive
call-graph review. A clean target-host install, frontend audit and deployed
security checks remain pending. The initial findings below are historical.

Read-only check: `npm audit --omit=dev --json --prefix server` exited 1:
11 vulnerable packages (1 critical, 5 high, 5 moderate). These are package
advisories, not proof that every vulnerability is exploitable in this app.
No dependencies were changed by this check. Public release remains gated.

## Priorities and observed dependency paths

- `express-rate-limit@8.2.1` is on the API/auth request path and has a high
  IPv4-mapped IPv6 rate-limit bypass advisory. It pins `ip-address@10.0.1`,
  also flagged. Upgrade to a patched compatible release; retest real proxy
  topology and spoofed forwarding headers, not only mock requests.
- `path-to-regexp` is flagged for routing denial of service. Resolve through
  compatible dependency updates and rerun API routing/error tests.
- `body-parser` and `qs` are flagged. The current API uses bounded JSON parsing,
  not URL-encoded parsing, which limits applicability of some advisories but
  does not justify keeping outdated dependencies.
- `form-data@4.0.3` is the critical finding, reached through
  `openai@4.104.0 → @types/node-fetch@2.6.12`. This dependency path alone does
  not establish runtime use of vulnerable multipart code. Current JEV transport
  sends JSON and generation is disabled; update the dependency nonetheless.
- `jws@4.0.0` is reached through `google-auth-library@9.15.1` and `gtoken`.
  Audit flags HMAC verification; this is not evidence that Google ID-token
  verification is bypassable. Update and retain Google identity/audience tests.
- `tar-fs@2.1.3` is reached through `better-sqlite3 → prebuild-install`.
  This is an installation/supply-chain exposure, not evidence that the API
  extracts user tarballs. Update and verify a clean native dependency install.
- `uuid` advisories propagate through `gaxios` and `node-cron`. npm proposes
  a major `node-cron` upgrade; do not apply `audit fix --force` blindly.
  Inspect actual vulnerable API usage and test scheduler behavior before choosing
  an upgrade or documenting a narrowly justified exception.

## Required closure evidence

2026-09-22 local reproducibility check: Node 22.23.1/npm 11.4.2;
`npm ci --prefix server` succeeds including native SQLite installation, and
469 backend tests / 53 suites pass afterward. `npm ci --prefix theeasynews
--ignore-scripts` succeeds and all 31 frontend tests / 5 suites pass afterward.
A compatible-only frontend audit-fix dry run proposes zero package changes.
Fresh frontend production build also succeeds (main.b0481916.js); CRA's
undeclared Babel dependency warning persists. Netlify config declares Node 22.
This does not verify a fresh Linux host install.

1. Review and apply compatible updates first; inspect manifest/lockfile diff.
2. Perform a clean install, full backend tests and a production-only audit.
3. Resolve remaining findings individually; record applicability and mitigation
   for any retained advisory. Also audit frontend build dependencies separately.
4. Verify auth, rate limiting and startup on the selected hosting topology.

This is initial prioritization, not a completed security audit or launch approval.

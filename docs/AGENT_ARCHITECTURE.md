# Easy News: compact repository map

Verified from source on 2026-09-20. This describes the existing prototype.
The future design is in [MODEL_ARCHITECTURE.md](MODEL_ARCHITECTURE.md).

| Location | Responsibility / entry point |
|---|---|
| Root `package.json` | Installs backend through postinstall; starts backend |
| `server/index.js` | Express API, inline SQLite schema/migrations, auth and in-memory sessions |
| `server/storage.js` | Rebuild source snapshots, atomic ingestion, durable leased jobs; explicit initialization |
| `server/migrate.js` | Explicit existing-database backup, integrity check, additive migration |
| `server/scrape.js` | Injected RSS ingestion into source/job store; explicit DB; ten items/feed; one retry |
| `server/seed-authors.js` | Seeds three author personas |
| `server/generate.js` | Selects RSS rows, calls OpenAI, overwrites content and author |
| `server/scheduler.js` | Import-safe immediate/hourly ingestion; overlap guard and shutdown draining |
| `server/__tests__/scrape.test.js` | Mock RSS ingestion test with temporary SQLite |
| `theeasynews/src/index.js` | React mount, styles, Google OAuth provider |
| `theeasynews/src/App.js` | Routes and localStorage login state |
| `theeasynews/src/components/` | Feed, categories, article, authors, login, saved stories, navigation |
| `theeasynews/src/zerohedge.css` | Main site styling |
| `theeasynews/src/App.test.js` | Mock-fetch home-page smoke test |
| `theeasynews/netlify.toml` | Static build, Node 22, SPA rewrite |

Rebuild flow: RSS → immutable source snapshots + queued classification jobs.
No classification/writing/publication worker is connected yet.
Legacy flow: old SQLite `articles` (`author='RSS'`) → manual generation
script → same row with generated content/persona name → Express `/api` → React.
The generator sends only a headline and persona instructions to `gpt-4o-mini`.
It does not use the RSS snippet as grounding, record token usage, or limit
attempts. Jev is absent. The API's list endpoint hides RSS rows, but the detail
endpoint does not enforce that filter.

Legacy SQLite tables: `users`, `authors`, `articles`, `saved_articles`. The opt-in
rebuild migration adds `source_items`, `rebuild_jobs`, and `rebuild_migrations`.
The scraper uses these tables; the legacy generator does not. No decision audit table exists. Sessions
are an in-memory Map. All backend entry points use `DB_PATH` or relative
`data.db`, except ingestion/scheduling require an existing absolute DB_PATH and
prior explicit migration. Root start does not start the scheduler, which runs
an initial ingestion cycle and hourly thereafter.

Frontend API calls use `REACT_APP_API_URL || ''`. An unset value sends requests
to the frontend origin. On Netlify, the SPA fallback can then return HTML for
API requests. Browser routes include `/`, `/category/:name`, `/articles/:id`,
`/authors`, `/about`, `/login`, and `/saved`.

High-coupling areas: schema/HTTP/auth in `server/index.js`; model/DB/process
initialization mixed in `generate.js`; duplicated frontend fetch/auth logic.
Read only the relevant entry point and its direct consumers for a task.

Deployment intent in README: Netlify frontend and Railway backend with a
persistent SQLite volume. Neither backend availability nor a recoverable
production database has been verified. See [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).

Known source-backed release blockers: saved-article reads trust the URL user ID
rather than the authenticated ID; article/author creation has no admin role
check; generation has no durable claim/retry budget or source grounding;
sessions have no expiry. Resolve and test these before a public rebuild.
The historical June review contains additional claims that need independent
verification; its prices, feed availability, and proposed fixes are not facts
about the current deployment.

Build/test commands and context rules live in [../AGENTS.md](../AGENTS.md).
The older [ARCHITECTURE.md](ARCHITECTURE.md) mixes implemented and aspirational
behavior; use this map for current facts.

# The Easy News

This repository contains a small prototype for **The Easy News**, a web application that generates AI-written news articles.

## Rebuild preparation

The product direction is now claim-centered research, including non-RSS
documents and passage-level evidence. See the [research pilot](docs/RESEARCH_PILOT.md)
for the Epstein collection design and local document-import workflow.

The Jev-based rebuild has a local storage/job foundation; Jev and the new
pipeline are not yet integrated or deployed.
Start with [agent instructions](AGENTS.md) and the
[current repository map](docs/AGENT_ARCHITECTURE.md). The approved direction is
captured in [model architecture](docs/MODEL_ARCHITECTURE.md), with a
[deployment and recovery runbook](docs/DEPLOYMENT_RUNBOOK.md) for the later launch.
[Verified state](docs/AGENT_WORKLOG.md) records the deployment investigation and
implementation handoff. The sections below describe the existing prototype.

The opt-in storage foundation is in `server/storage.js`. To migrate an existing
isolated database, stop all writers and run `npm run migrate --prefix server --
<absolute-database-path> <absolute-existing-backup-directory>` (one line, quote
paths containing spaces). It creates a unique SQLite backup, verifies its
integrity, then adds the rebuild tables transactionally. It preserves legacy
tables and does not infer source evidence from old generated articles. The
RSS ingestion now uses these tables; the legacy API and generator remain
independent. Newly ingested sources are not public articles yet.

## Structure

- `theeasynews/` – React frontend created with Create React App.
- `server/` – Node.js/Express backend with a SQLite database.

## Development

1. Install dependencies for the frontend:
   ```bash
   cd theeasynews
   npm install
   ```

2. Install backend dependencies:
   ```bash
   cd ../server
   npm install
   ```

3. Start the backend server:
   ```bash
   npm start
   ```
   The server listens on port `4000` by default. Set `DB_PATH` if you need the
   SQLite file in a specific location.

4. In another terminal, start the React development server:
   ```bash
   cd ../theeasynews
   npm start
   ```
   Set `REACT_APP_API_URL` in a `.env` file to the URL of your backend.
   Set `REACT_APP_GOOGLE_CLIENT_ID` to your Google OAuth client ID if you want
   to enable Google SSO in the frontend.

The frontend is served at `http://localhost:3000` and communicates with the
backend API using that `REACT_APP_API_URL` value.

The site now provides a simple login system, article listing with share buttons, and a page for viewing saved articles. New users can register from the login page. Articles can be saved after logging in and shared to social networks including Facebook, X/Twitter, Telegram and LinkedIn. User passwords are hashed with `bcryptjs` before being stored in the database.

### Site navigation

Pages include Home, automatically generated category links, Authors, About,
Saved Articles and Login/Logout. Categories are loaded from the database so new
topics show up as soon as articles are created.

### Scraping news

To fetch headlines from several major outlets into the local database run:

```bash
cd server
npm run scrape
```

Set `DB_PATH` to an existing absolute database path and apply the backup-first
migration before running this command. It stores source URLs, dates, titles,
and RSS evidence, then queues classification jobs. Repeated items are
idempotent; changed evidence creates a new snapshot. Invalid items are rejected
individually. The retained CNN/AP/Fox/NPR feed configuration needs live
availability verification before deployment. No model calls occur here.

### Seeding author personas

Before generating articles, add some AI authors with their personas and prompts:

```bash
cd server
npm run seed-authors
```

This populates the `authors` table so the generator can pick from them.

### Legacy article generation (disabled)

The legacy generator only processes old `articles` rows with author `RSS`;
it does not consume evidence packets or the rebuild queue and must not be used
for normal production drafting. It is retained only for an explicitly approved
recovery run. The command fails closed unless `LEGACY_GENERATION_ENABLED=true`,
`GENERATION_ENABLED=true`, an absolute `DB_PATH`, and `OPENAI_API_KEY` are all
present. If that exceptional recovery run is approved, run:

```bash
cd server
npm run generate:legacy
```

Each run directly updates legacy rows, incurs provider cost, and does not meet
the grounded-writing or publication requirements. It must never be used as a
substitute for the reviewed Task 14–16 pipeline.

### Scheduled ingestion

With an absolute `DB_PATH` and the rebuild migration applied, ingest hourly:

```bash
cd server
npm run schedule
```

This job ingests immediately and hourly, skips overlapping ticks, and waits for
active ingestion on shutdown. It does not import the legacy generator or need
an OpenAI key. Classification workers are not implemented yet.

### Running tests

Inside `theeasynews/` run:

```bash
npm test
```

React Router is used in the frontend tests so dependencies must be installed with `npm install` first.

## Deployment

### Backend on Railway

1. Create a new Node.js service in Railway and connect this repository.
2. Set environment variables:
   - `PORT` (if different from `4000`)
   - `DB_PATH` – path to the SQLite file (e.g. `/data/data.db` on a persistent volume)
   - `OPENAI_API_KEY` for article generation
   - `GOOGLE_CLIENT_ID` for verifying Google sign-in tokens
3. Railway runs `npm start` from the repository root. The root `package.json`
   installs dependencies under `server/` and launches the Express app.

### Frontend on Netlify

1. In Netlify, create a new site from this repository and configure the build directory `theeasynews`.
2. Set the build command to `npm run build` and publish directory to `build` (already defined in `netlify.toml`).
3. Add environment variables `REACT_APP_API_URL` and `REACT_APP_GOOGLE_CLIENT_ID`
   pointing to the Railway backend URL and your Google OAuth client ID.
4. Deploy – Netlify will build the React app and serve the static files.

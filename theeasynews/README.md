# The Easy News Frontend

This directory contains the React frontend for The Easy News, built with Vite
and tested with Vitest. Use Node 22.22.2 or newer on the Node 22 line.

## Setup

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Set `REACT_APP_API_URL` and `REACT_APP_GOOGLE_CLIENT_ID` in `.env` when
   needed. These are public build settings, never secrets. Only those two keys
   are exposed. Production uses an empty API URL for Netlify's same-origin proxy.

## Development server

Start the development server with:
```bash
npm start
```
Visit http://127.0.0.1:5173 to view the app. The backend must explicitly allow
that development origin when using a separate API URL. For same-origin integration
tests, build then run `node server/test-support/browser-fixture.js` from the
repository root; this uses synthetic data and no external ingestion/model calls.

## Running tests

Run the test suite with:
```bash
npm test
npm run test:config
npm run test:build
npm run test:lint
npm run lint
```

Use `npm run test:watch` for watch mode. CRA/Jest flags such as `--watchAll`
and `--runInBand` no longer apply. Existing React Testing Library assertions
are retained; mocking uses Vitest's `vi` helpers.

## Building for production

Create an optimized build in the `build` folder:
```bash
npm run build
```

Builds run ESLint first and reject any warnings. The explicit gate checks JS,
React, Hooks and JSX accessibility. A single documented exception retains
keyboard scrolling in the preserved-document region. ESLint 9 is currently
required by the React/accessibility plugins' peer ranges and is marked unsupported
upstream; track their ESLint 10 support rather than force incompatible peers.

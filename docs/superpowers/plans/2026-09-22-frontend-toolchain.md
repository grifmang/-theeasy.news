# Frontend Toolchain Implementation Plan

> Use executing-plans inline; preserve the existing dirty workspace and do not commit or deploy this package independently.

**Goal:** Replace CRA with Vite/Vitest without changing site behavior or hosting.
**Architecture:** Retain React 18, React Router 7, the static build directory and Netlify API proxy. Explicitly expose only the two existing public settings; never serialize all process environment variables.
**Tech Stack:** Node 22.23.1, Vite 8.3.0, Vitest 5.0.1, React plugin 6.1.1, jsdom 30.1.1.
**Spec:** User-approved in-chat design: preserve UI, routes, hosting, public configuration, all 31 frontend tests, and browser workflows; no added hosting cost.

## Global constraints

- No production deployment, paid calls, credentials in bundles, or unrelated application changes.
- Keep output `build` and Netlify Node 22; require Node >=22.22.2 for the selected jsdom.
- Preserve all existing assertions; do not mock routing or remove failing tests.

## Task 1: Replace build and test tooling

Files: package.json/lock, vite.config.mjs, index.html, src/App.jsx,
src/index.jsx, src/App.test.jsx, src/setupTests.js, five test files.

- [ ] Add a Node test for the public-config boundary: the returned define map contains only API URL and Google client ID; a secret input never occurs in serialized config. Confirm missing helper fails.
- [ ] Implement an independent `public-env.mjs` helper returning literal replacements with JSON.stringify and empty defaults. Use it from Vite's config after loading only REACT_APP_ values.
- [ ] Rename JSX-bearing .js files to .jsx, move HTML entry out of public, replace PUBLIC_URL placeholders with root asset paths and add module entry script.
- [ ] Replace CRA with exact tool versions, test globals/jsdom/setupFiles, build.outDir build. Keep dev listener loopback and strict host handling.
- [ ] Convert jest mock helpers to explicitly imported vi; keep all assertions and use jest-dom's Vitest entry with explicit cleanup.
- [ ] Run node contract test, npm install, npm test, npm run build and npm audit. Diagnose failures; do not force major transitive overrides.

## Task 2: Verify integration and document commands

- [ ] Run clean npm ci, all tests and build; inspect generated HTML references and confirm configured public values but no synthetic secret appear in output.
- [ ] Use synthetic loopback fixture to verify anonymous redirect, login, research desk, fetch/extraction and logout in browser with the new build.
- [ ] Update README/AGENTS commands, dependency triage and resume checkpoint. Record exact remaining findings and any missing verification. Keep Railway migration/deployment hold.

Separate approved task: install build-essential/libseccomp-dev in existing Ubuntu WSL. Installation alone does not establish a parser sandbox.

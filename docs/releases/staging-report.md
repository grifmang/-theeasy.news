# Research workspace deployment evidence — 2026-09-23 UTC

Status: deployed private editorial workspace, NOT an approved public fact-checking
launch. The public shell has zero articles. The full production plan remains open.

## Deployed artifacts

- Railway project e8d6fdb7-6468-4b4d-a074-200ba127a827, production environment
  e3f4d555-96a3-44d9-bf3b-e87fcc7d4947, service35900e6b-6d99-477a-b104-21cde85264b5.
- Successful deployment10d63288-d3f0-4601-aa55-d2e7dfdd6402, image
  sha256:f27bd88b6436361c79029618892da065957db7a586d70f13855493de1f233e73.
- Netlify site fdd1496b-3ae0-4977-9473-8e7835660517, deployment
  6ab3489533e4b1c99d146908: https://easy-news-research.netlify.app.
- Uploaded an explicitly assembled source bundle, not a committed CI artifact.
  No git commit/push occurred. Reproducible CI artifact provenance remains a gap.
- Reused existing Railway Hobby and Netlify accounts. $10/month Railway target
  remains a target, not a verified forecast or an enforced cap. No new service.

## Verification actually performed

- Backend533 tests/57 suites; frontend39 tests/6 suites; lint-gated Vite build;
  public-environment boundary and isolated production-build smoke tests pass.
- Exact clean bundle built locally as imagef92ec8a5df70cc2bb12b630fd736d1143eaa756d2f9c57f1b8273abdf969b670;
  synthetic real HTTP HTML extraction→immutable manifest→download→shutdown passed
  as UID1000, with networknone/cap-dropALL/no-new-privileges. Railway builds its own
  image; local and remote image digests differ and byte reproducibility is not claimed.
- Railway API reports SUCCESS/RUNNING; public /health/ready returns ready.
- Main PID1 UID/GID1000; effective and permitted Linux capabilities zero.
  Main NoNewPrivs=0 on Railway; native parser launcher applies its own restrictions.
- Actual parser preflight on Railway passed as UID1000. Railway SSH itself starts
  as root, so a direct root preflight correctly rejects; spawn the check as1000.
- Netlify home/login render, same-origin /api/articles returns empty publication
  list, /api/v1/editor/topics returns401 without authentication.
- Google button/account chooser renders for existing approved editor identity.
  Popup automation could not select it; post-release authenticated UI/session
  persistence verification is pending. No fabricated session used as a substitute.
- All generation/classification/auto-publication/ingestion/HTML flagsfalse,
  daily/monthly budgets0. No paid model calls or automatic source crawl.

## Data preservation and recovery

Stopped former writer via explicit health-only maintenance deployment
8cf174e8-1cb9-4fc1-a6cd-ccab3c218c4a; verified maintenance/writesEnabled=false.
Original schema16 `/data/easy-news.db` and historical `/data/data.db` remain intact.
Copied using SQLite backup into new private `/data/research/easy-news.db`, not a
live-file copy. Chowned only new directory/file paths to1000, then migrated copy
16→21 in a spawned UID1000 process. Integrity/FKs and account/role counts preserved;
startup rehearsal passed. Backup before migration:
`/data/research/backups/easy-news-backup-LQicm3/data.db`.

Windows encrypted recovery directory:
`C:/Users/grifm/AppData/Local/EasyNews/recovery` (private ACL, outside OneDrive/git).

- Final post-writer-stop schema16 snapshot:
  `easy-news-2026-09-23T03-30-40-912Z-4b2e3165-71b5-47fb-8ebf-35b3d2bb178c.db.age`;
  SHA256751d75ada419609840ff0496b224c723ccc0b67bf1cbb95a06fd0c79d3366947.
- Post-release active schema21 snapshot:
  `easy-news-2026-09-23T03-35-06-526Z-7788b036-a091-4665-b624-62a5fbdcebd6.db.age`;
  SHA2563a429eb530c5b9b704ba2e9879239f6cc6e4b9a1ea2c19021924fdfed2b0e36f.

Both decrypted/rehearsed successfully in memory; originals count0. Local
backup-railway-to-windows.js now targets active/data/research and refuses runtime
DB_PATH mismatch or nonempty original_objects. Its productionMigrated=false output
means the backup operation does not migrate production, not that cutover never ran.
Key is DPAPI CurrentUser protected: retain the Windows profile. Portable key
escrow, archival-file backups, scheduling/retention and measured RPO/RTO remain open.

## Rollback cautions and unresolved gates

Do not point old schema16 code at the new schema21 DB. Stop writers, capture current
state, reconcile all post-cutover writes, then choose a schema-compatible restore.
The preserved old database is not a current backup after users resume writing.
New restore should normally retain schema21 and use this successful Docker release.

Initial Nixpacks attempts failed due generated.nixpacks exclusion, then missing
prices.json; corrected repository ignore checks did not prove remote packaging.
A clean source bundle without Docker ignore succeeded for temporary maintenance.
Final Docker upload restored its tested Docker ignore and uses explicit COPYs.
Future releases must inspect/test the actual assembled bundle before upload.

Outstanding: proxy header provenance/rate limiter warning; CI/security/full release
gates; authenticated UI check; PDF/OCR; reviewed archival transport/cache/robots;
independently labelled corpus and quality gates; grounded writer/publication and
corrections; qualified independent editorial reviews; operational alerting,
retention/key escrow and measured costs. No accuracy claim or public approval.
theeasy.news DNS has NOT been changed or attached.

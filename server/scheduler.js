const cron = require('node-cron');
const { scrapeFeeds, openIngestionStore } = require('./scrape');

function createCycle({ db, scrape = scrapeFeeds, logger = console }) {
  let running = false;
  return async () => {
    if (running) return { skipped: true };
    running = true;
    try { return await scrape({ db, logger }); }
    finally { running = false; }
  };
}

function startScheduler({ db, logger = console, scrape = scrapeFeeds } = {}) {
  if (!db) throw new Error('Explicit database connection is required');
  const cycle = createCycle({ db, logger, scrape });
  let active = null;
  let stopping = false;
  const tick = () => {
    if (stopping || active) return;
    active = cycle().catch(() => logger.error('RSS cycle failed'))
      .finally(() => { active = null; });
  };
  const task = cron.schedule('0 * * * *', tick);
  tick();
  return async () => {
    stopping = true;
    task.stop();
    if (active) await active;
  };
}

module.exports = { createCycle, startScheduler };
if (require.main === module) {
  try {
    const db = openIngestionStore();
    const stop = startScheduler({ db });
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      await stop();
      db.close();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    console.error('Scheduler startup failed; check DB_PATH and migration');
    process.exitCode = 1;
  }
}

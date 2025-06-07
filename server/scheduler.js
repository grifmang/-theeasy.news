const cron = require('node-cron');
const { scrapeFeeds } = require('./scrape');
const { generateArticles } = require('./generate');

async function runCycle() {
  await scrapeFeeds();
  await generateArticles();
}

cron.schedule('0 * * * *', () => {
  runCycle().catch(err => console.error('cycle failed', err));
});

runCycle().catch(err => console.error('initial run failed', err));

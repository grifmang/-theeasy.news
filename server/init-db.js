const fs = require('fs');
const path = require('path');
const { openStore, migrate } = require('./storage');

function initializeDatabase(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) {
    throw new Error('Provide an absolute path for a new database');
  }
  // Atomic exclusive creation prevents accidental overwrite of existing data.
  const handle = fs.openSync(filename, 'wx', 0o600);
  fs.closeSync(handle);
  const db = openStore(filename);
  try {
    migrate(db);
    require('./legacy-schema').migrateLegacy(db);
    if (db.pragma('integrity_check', { simple:true }) !== 'ok') throw new Error('Database integrity check failed');
  } finally { db.close(); }
  // On failure retain the new file for diagnosis; never guess that deletion is safe.
  return filename;
}

module.exports = { initializeDatabase };
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node init-db.js <absolute-new-database-path>');
    initializeDatabase(process.argv[2]);
    console.log('Database initialized; no source data or accounts were seeded.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

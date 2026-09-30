const fs = require('fs');
const path = require('path');
const { openStore, migrate } = require('./storage');

async function backupAndMigrate(filename, backupRoot) {
  if (!filename || !backupRoot || !path.isAbsolute(filename) || !path.isAbsolute(backupRoot)) {
    throw new Error('Provide absolute database and backup-directory paths');
  }
  if (!fs.statSync(filename).isFile() || !fs.statSync(backupRoot).isDirectory()) {
    throw new Error('Database must exist and backup directory must be a directory');
  }
  const db = openStore(filename);
  try {
    // Each invocation gets a new directory, so no previous backup is overwritten.
    const backupDirectory = fs.mkdtempSync(path.join(backupRoot, 'easy-news-backup-'));
    const backupPath = path.join(backupDirectory, 'data.db');
    await db.backup(backupPath);
    const restored = openStore(backupPath);
    try {
      if (restored.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new Error('Backup integrity check failed; migration not applied');
      }
    } finally {
      restored.close();
    }
    db.transaction(() => {
      migrate(db);
      require('./legacy-schema').migrateLegacy(db);
    }).immediate();
    return backupPath;
  } finally {
    db.close();
  }
}

module.exports = { backupAndMigrate };

if (require.main === module) {
  const [filename, backupRoot] = process.argv.slice(2);
  backupAndMigrate(filename, backupRoot)
    .then(backupPath => console.log(`Migration complete. Backup: ${backupPath}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

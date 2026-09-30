const fs = require('fs');
const path = require('path');
const { openIngestionStore } = require('./scrape');
const { createTopic, importDocument } = require('./research');

function importPackage(db, input) {
  if (!input || !Array.isArray(input.documents) || input.documents.length > 100) {
    throw new Error('Expected at most 100 documents');
  }
  return db.transaction(() => {
    const topic = createTopic(db, input.topic?.slug, input.topic?.title);
    const documents = input.documents.map(document => importDocument(db, { ...document, topicId: topic.id }));
    return { topicId: topic.id, documentIds: documents.map(document => document.id) };
  }).immediate();
}
module.exports = { importPackage };

if (require.main === module) {
  let db;
  try {
    const filename = process.argv[2];
    if (!filename || !path.isAbsolute(filename)) throw new Error('Absolute input path required');
    if (fs.statSync(filename).size > 5000000) throw new Error('Input exceeds 5 MB');
    const input = JSON.parse(fs.readFileSync(filename, 'utf8'));
    db = openIngestionStore();
    console.log(importPackage(db, input));
  } catch {
    console.error('Research import failed; verify input package, absolute DB_PATH, and migration version 2');
    process.exitCode = 1;
  } finally { if (db) db.close(); }
}

const { openStore, migrate } = require('../storage');
const { createTopic } = require('../research');

test('refuses newer schemas without writing migration tables or data', () => {
  const db = openStore(':memory:');
  try {
    db.exec('CREATE TABLE rebuild_migrations(version INTEGER PRIMARY KEY); INSERT INTO rebuild_migrations VALUES(999)');
    expect(() => migrate(db)).toThrow(/newer/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='source_items'").get()).toBeUndefined();
  } finally { db.close(); }
});
test.each([null, undefined, 123, ['topic'], {toString:()=> 'topic'}])('rejects coerced topic slugs', slug => {
  const db = openStore(':memory:');
  try {
    migrate(db);
    expect(() => createTopic(db, slug, 'Title')).toThrow('Invalid slug');
    expect(db.prepare('SELECT COUNT(*) AS n FROM research_topics').get().n).toBe(0);
  } finally { db.close(); }
});

function migrateResearch(db) {
  if (db.prepare('SELECT 1 FROM rebuild_migrations WHERE version=2').get()) return;
  db.exec(`
    CREATE TABLE research_topics (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL
    );
    CREATE TABLE research_claims (
      id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL REFERENCES research_topics(id),
      wording TEXT NOT NULL, attribution TEXT NOT NULL, origin_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(status IN ('unreviewed','reviewed')),
      UNIQUE(topic_id, wording, attribution, origin_url)
    );
    CREATE TABLE research_documents (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES source_items(id),
      kind TEXT NOT NULL CHECK(kind IN ('web_page','court_filing','official_release','transcript','report','social_post','other')),
      origin_chain TEXT NOT NULL, extraction_method TEXT NOT NULL,
      UNIQUE(source_id, kind, origin_chain, extraction_method)
    );
    CREATE TABLE research_topic_documents (
      topic_id INTEGER NOT NULL REFERENCES research_topics(id),
      document_id INTEGER NOT NULL REFERENCES research_documents(id),
      PRIMARY KEY(topic_id, document_id)
    );
    CREATE TABLE research_passages (
      id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES research_documents(id),
      start_offset INTEGER NOT NULL CHECK(start_offset>=0),
      end_offset INTEGER NOT NULL CHECK(end_offset>start_offset),
      locator TEXT NOT NULL, quote TEXT NOT NULL,
      UNIQUE(document_id,start_offset,end_offset,locator)
    );
    CREATE TABLE research_assessments (
      id INTEGER PRIMARY KEY, claim_id INTEGER NOT NULL REFERENCES research_claims(id),
      passage_id INTEGER NOT NULL REFERENCES research_passages(id),
      relevance TEXT NOT NULL CHECK(relevance IN ('direct','background','unrelated','uncertain')),
      relation TEXT NOT NULL CHECK(relation IN ('supports','contradicts','mentions_only','insufficient')),
      evidence_type TEXT NOT NULL CHECK(evidence_type IN ('mention','allegation','testimony','finding','other','uncertain')),
      reviewer TEXT NOT NULL, rationale TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO rebuild_migrations(version) VALUES(2);
  `);
  for (const table of ['research_claims','research_documents','research_passages','research_assessments']) {
    for (const operation of ['UPDATE','DELETE']) {
      db.exec(`CREATE TRIGGER ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table}
        BEGIN SELECT RAISE(ABORT, 'research evidence is append-only'); END;`);
    }
  }
}
module.exports = { migrateResearch };

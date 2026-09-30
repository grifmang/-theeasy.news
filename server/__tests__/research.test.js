const { openStore, migrate } = require('../storage');
const { createTopic, addClaim, importDocument, addPassage, assessPassage } = require('../research');
let db, topic;
const documentInput = { source: 'Synthetic fixture', url: 'https://example.com/filing', title: 'Test filing',
  content: 'A witness alleges an event occurred. The court has not made a finding.',
  kind: 'court_filing', originChain: 'fixture-docket-1', extractionMethod: 'manually supplied text' };
beforeEach(() => { db = openStore(':memory:'); migrate(db); topic = createTopic(db, 'epstein', 'Jeffrey Epstein research'); });
afterEach(() => db.close());
test('topic creation seeds no claims or facts', () => {
  expect(createTopic(db, 'epstein', 'Jeffrey Epstein research').id).toBe(topic.id);
  expect(db.prepare('SELECT COUNT(*) n FROM research_claims').get().n).toBe(0);
});
test('imports non-RSS text idempotently and retains revised versions', () => {
  const original = importDocument(db, { ...documentInput, topicId: topic.id });
  expect(importDocument(db, { ...documentInput, topicId: topic.id }).id).toBe(original.id);
  expect(importDocument(db, { ...documentInput, topicId: topic.id, content: 'Revised document' }).id).not.toBe(original.id);
  expect(db.prepare('SELECT COUNT(*) n FROM rebuild_jobs').get().n).toBe(0);
});
test('invalid metadata rolls back source insertion', () => {
  expect(() => importDocument(db, { ...documentInput, topicId: topic.id, kind: 'invalid' })).toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM source_items').get().n).toBe(0);
});

test('a bad document rolls back the whole package including the topic', () => {
  const { importPackage } = require('../import-research');
  expect(() => importPackage(db, { topic: { slug: 'new-topic', title: 'New' },
    documents: [documentInput, { ...documentInput, content: '' }] })).toThrow();
  expect(db.prepare("SELECT id FROM research_topics WHERE slug='new-topic'").get()).toBeUndefined();
  expect(db.prepare('SELECT COUNT(*) n FROM source_items').get().n).toBe(0);
});
test('passages are exact slices and assessments preserve allegation versus finding', () => {
  const document = importDocument(db, { ...documentInput, topicId: topic.id });
  const claim = addClaim(db, { topicId: topic.id, wording: 'An event occurred', attribution: 'Synthetic witness', originUrl: documentInput.url });
  const passage = addPassage(db, { documentId: document.id, start: 0, end: 35, locator: 'paragraph 1' });
  expect(passage.quote).toBe(documentInput.content.slice(0, 35));
  expect(() => addPassage(db, { documentId: document.id, start: 0, end: 9999, locator: 'page 1' })).toThrow();
  const assessment = assessPassage(db, { claimId: claim.id, passageId: passage.id, relevance: 'direct', relation: 'mentions_only', evidenceType: 'allegation', reviewer: 'fixture reviewer', rationale: 'Records a statement, not an adjudicated fact.' });
  expect(assessment.evidence_type).toBe('allegation');
  expect(db.prepare('SELECT status FROM research_claims').get().status).toBe('unreviewed');
  expect(() => db.prepare('UPDATE research_passages SET quote=?').run('invented')).toThrow('append-only');
});
test('one document links to multiple topics and passages can assess multiple claims', () => {
  const first = importDocument(db, { ...documentInput, topicId: topic.id });
  const other = createTopic(db, 'other', 'Other research');
  expect(importDocument(db, { ...documentInput, topicId: other.id }).id).toBe(first.id);
  expect(db.prepare('SELECT COUNT(*) n FROM research_topic_documents').get().n).toBe(2);
});

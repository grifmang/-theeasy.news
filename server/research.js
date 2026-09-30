const { saveSource } = require('./storage');
const { appendClaimContext, getClaimContext } = require('./claim-context');
const { getClaimState } = require('./research-lifecycle');

function text(value, field, limit = 32000) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}
function publicUrl(value) {
  let url;
  try { url = new URL(text(value, 'URL', 8000)); }
  catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
  return url.href;
}

// The original assertion is immutable; interpretation begins in the audited
// context stream. A repeated proposal may only reuse its identical first version.
function proposeClaim(db, { topicId, original, attribution, originUrl, qualifiers, actorId }) {
  if (!Number.isSafeInteger(topicId) || topicId <= 0) throw new Error('Invalid topic');
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new Error('Invalid actor');
  text(original, 'original', 4000);
  text(attribution, 'attribution', 1000);
  const url = publicUrl(originUrl);
  const fields = ['normalizedWording', 'observedAt', 'entities', 'timeframe', 'location', 'reason'];
  if (!qualifiers || typeof qualifiers !== 'object' || Array.isArray(qualifiers) ||
      Object.getPrototypeOf(qualifiers) !== Object.prototype ||
      Object.keys(qualifiers).length !== fields.length ||
      fields.some(field => !Object.hasOwn(qualifiers, field))) throw new Error('Invalid qualifiers');

  return db.transaction(() => {
    if (!db.prepare('SELECT id FROM research_topics WHERE id=?').get(topicId)) throw new Error('Unknown topic');
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(actorId)) throw new Error('Unknown actor');
    const identity = [topicId, original, attribution, url];
    let claim = db.prepare(`SELECT * FROM research_claims
      WHERE topic_id=? AND wording=? AND attribution=? AND origin_url=?`).get(...identity);
    if (!claim) {
      const result = db.prepare(`INSERT INTO research_claims(topic_id,wording,attribution,origin_url)
        VALUES(?,?,?,?)`).run(...identity);
      claim = db.prepare('SELECT * FROM research_claims WHERE id=?').get(result.lastInsertRowid);
      const context = appendClaimContext(db, { claimId: claim.id, actorId, expectedVersionId: null, ...qualifiers });
      return { claim, context, version: context, state: getClaimState(db, claim.id) };
    }

    const context = getClaimContext(db, claim.id);
    const first = db.prepare('SELECT id FROM claim_context_versions WHERE claim_id=? ORDER BY id LIMIT 1').get(claim.id);
    const state = getClaimState(db, claim.id);
    const event = db.prepare('SELECT id,actor_id,type FROM claim_events WHERE claim_id=? ORDER BY id LIMIT 1').get(claim.id);
    const identical = context && first?.id === context.id && context.actorId === actorId &&
      context.normalizedWording === qualifiers.normalizedWording &&
      context.observedAt === qualifiers.observedAt &&
      JSON.stringify(context.entities) === JSON.stringify(qualifiers.entities) &&
      context.timeframe === qualifiers.timeframe && context.location === qualifiers.location &&
      context.reason === qualifiers.reason && state.status === 'unreviewed' && !state.restricted &&
      event?.id === state.eventId && event.actor_id === actorId && event.type === 'unreviewed';
    if (!identical) {
      const error = new Error('Claim proposal conflicts with an existing claim');
      error.code = 'claim_proposal_conflict';
      throw error;
    }
    return { claim, context, version: context, state };
  }).immediate();
}

function createTopic(db, slug, title) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Invalid slug');
  text(title, 'title', 500);
  db.prepare('INSERT INTO research_topics(slug,title) VALUES(?,?) ON CONFLICT(slug) DO NOTHING').run(slug, title);
  return db.prepare('SELECT * FROM research_topics WHERE slug=?').get(slug);
}

function addClaim(db, { topicId, wording, attribution, originUrl }) {
  text(wording, 'wording', 4000); text(attribution, 'attribution', 1000);
  const url = publicUrl(originUrl);
  db.prepare(`INSERT INTO research_claims(topic_id,wording,attribution,origin_url) VALUES(?,?,?,?)
    ON CONFLICT(topic_id,wording,attribution,origin_url) DO NOTHING`).run(topicId, wording, attribution, url);
  return db.prepare('SELECT * FROM research_claims WHERE topic_id=? AND wording=? AND attribution=? AND origin_url=?')
    .get(topicId, wording, attribution, url);
}

// Import supplied text only. No network fetch, PDF parsing, or model invocation.
function importDocument(db, { topicId, source, url, title, content, publishedAt,
  kind, originChain, extractionMethod }) {
  text(content, 'content', 1000000); text(originChain, 'originChain', 1000);
  text(extractionMethod, 'extractionMethod', 500);
  const checkedUrl = publicUrl(url);
  return db.transaction(() => {
    const snapshot = saveSource(db, { source, url: checkedUrl, title, evidence: content, publishedAt });
    db.prepare(`INSERT INTO research_documents(source_id,kind,origin_chain,extraction_method) VALUES(?,?,?,?)
      ON CONFLICT(source_id,kind,origin_chain,extraction_method) DO NOTHING`)
      .run(snapshot.id, kind, originChain, extractionMethod);
    const document = db.prepare(`SELECT * FROM research_documents
      WHERE source_id=? AND kind=? AND origin_chain=? AND extraction_method=?`)
      .get(snapshot.id, kind, originChain, extractionMethod);
    db.prepare('INSERT INTO research_topic_documents VALUES(?,?) ON CONFLICT DO NOTHING').run(topicId, document.id);
    return document;
  }).immediate();
}

function addPassage(db, { documentId, start, end, locator }) {
  text(locator, 'locator', 1000);
  const row = db.prepare(`SELECT s.evidence FROM research_documents d
    JOIN source_items s ON s.id=d.source_id WHERE d.id=?`).get(documentId);
  if (!row || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > row.evidence.length) {
    throw new Error('Invalid passage range');
  }
  const quote = row.evidence.slice(start, end);
  db.prepare(`INSERT INTO research_passages(document_id,start_offset,end_offset,locator,quote) VALUES(?,?,?,?,?)
    ON CONFLICT(document_id,start_offset,end_offset,locator) DO NOTHING`).run(documentId, start, end, locator, quote);
  return db.prepare('SELECT * FROM research_passages WHERE document_id=? AND start_offset=? AND end_offset=? AND locator=?')
    .get(documentId, start, end, locator);
}

function assessPassage(db, { claimId, passageId, relevance, relation, evidenceType, reviewer, rationale }) {
  text(reviewer, 'reviewer', 500); text(rationale, 'rationale', 8000);
  // A relevance label or a court filing alone cannot establish a claim's truth.
  const result = db.prepare(`INSERT INTO research_assessments
    (claim_id,passage_id,relevance,relation,evidence_type,reviewer,rationale) VALUES(?,?,?,?,?,?,?)`)
    .run(claimId, passageId, relevance, relation, evidenceType, reviewer, rationale);
  return db.prepare('SELECT * FROM research_assessments WHERE id=?').get(result.lastInsertRowid);
}

module.exports = { createTopic, addClaim, proposeClaim, importDocument, addPassage, assessPassage };

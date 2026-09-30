const TYPES = new Set(['reviewed','unreviewed','restricted','restored','superseded']);

function getClaimState(db, claimId) {
  const claim = db.prepare('SELECT id FROM research_claims WHERE id=?').get(claimId);
  if (!claim) throw new Error('Unknown claim');
  // Legacy status was not authenticated: it is never imported as an approval.
  const state = { status:'unreviewed', restricted:false, eventId:null, replacementId:null };
  for (const row of db.prepare('SELECT * FROM claim_events WHERE claim_id=? ORDER BY id').all(claimId)) {
    state.eventId = row.id;
    if (row.type === 'restricted') state.restricted = true;
    else if (row.type === 'restored') state.restricted = false;
    else {
      state.status = row.type;
      state.replacementId = row.replacement_id;
    }
  }
  return state;
}

// Internal storage boundary. HTTP callers must bind actorId from authenticated
// editor identity; actor existence here is NOT an authorization decision.
function appendClaimEvent(db, {claimId, actorId, type, reason, expectedEventId, supersedesId = null}) {
  if (!TYPES.has(type)) throw new Error('Invalid event type');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 8000) throw new Error('Invalid reason');
  if (!Number.isSafeInteger(claimId) || claimId <= 0) throw new Error('Invalid claim');
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new Error('Invalid actor');
  if (expectedEventId !== null && (!Number.isSafeInteger(expectedEventId) || expectedEventId <= 0)) throw new Error('Invalid expected event');
  return db.transaction(() => {
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(actorId)) throw new Error('Unknown actor');
    if (type==='restricted'||type==='restored')
      require('./publication/owner-authority').requirePublicationOwner(db,actorId);
    const state = getClaimState(db, claimId);
    if (state.eventId !== expectedEventId) throw new Error('Claim changed since review');
    if (state.status === 'superseded' && !['restricted','restored'].includes(type)) throw new Error('Claim already superseded');
    if (type === 'superseded') {
      if (!Number.isSafeInteger(supersedesId) || supersedesId <= 0 || supersedesId === claimId) throw new Error('Invalid replacement');
      const original = db.prepare('SELECT topic_id FROM research_claims WHERE id=?').get(claimId);
      const replacement = db.prepare('SELECT topic_id FROM research_claims WHERE id=?').get(supersedesId);
      if (!replacement || replacement.topic_id !== original.topic_id || getClaimState(db, supersedesId).status === 'superseded') throw new Error('Invalid replacement');
    } else if (supersedesId !== null) throw new Error('Unexpected replacement');
    if (type === 'restored' && !state.restricted) throw new Error('Claim is not restricted');
    const result = db.prepare('INSERT INTO claim_events(claim_id,actor_id,type,reason,replacement_id) VALUES(?,?,?,?,?)')
      .run(claimId, actorId, type, reason, supersedesId);
    if(type!=='restored')require('./publication/service').invalidateClaimForChange(db,
      {claimId,actorId,reason,restricted:type==='restricted'});
    return db.prepare('SELECT * FROM claim_events WHERE id=?').get(result.lastInsertRowid);
  }).immediate();
}
module.exports = { appendClaimEvent, getClaimState };

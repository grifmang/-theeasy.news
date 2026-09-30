const { getClaimState, appendClaimEvent } = require('./research-lifecycle');

function bounded(value, name, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${name}`);
  return value;
}
function getClaimContext(db, claimId) {
  const state = getClaimState(db, claimId);
  const row = db.prepare('SELECT * FROM claim_context_versions WHERE claim_id=? ORDER BY id DESC LIMIT 1').get(claimId);
  if (!row) return null;
  return {id:row.id,claimId:row.claim_id,actorId:row.actor_id,normalizedWording:row.normalized_wording,
    observedAt:row.observed_at,entities:JSON.parse(row.entities_json),timeframe:row.timeframe,
    location:row.location,reason:row.reason,createdAt:row.created_at,status:state.status};
}

// Internal service only; editor authorization belongs at the API boundary.
function appendClaimContext(db, input) {
  const {claimId,actorId,expectedVersionId,normalizedWording,observedAt,entities,timeframe,location,reason} = input;
  if (!Number.isSafeInteger(claimId) || claimId <= 0) throw new Error('Invalid claim');
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new Error('Invalid actor');
  if (expectedVersionId !== null && (!Number.isSafeInteger(expectedVersionId) || expectedVersionId <= 0)) throw new Error('Invalid expected version');
  bounded(normalizedWording,'normalizedWording',4000);
  bounded(timeframe,'timeframe',1000); bounded(location,'location',1000); bounded(reason,'reason',8000);
  if (observedAt !== null && (typeof observedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt) ||
      !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt)) throw new Error('Invalid observedAt');
  if (!Array.isArray(entities) || entities.length > 50) throw new Error('Invalid entities');
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity) ||
        Object.keys(entity).some(key => !['name','identifier'].includes(key))) throw new Error('Invalid entities');
    bounded(entity.name,'entities.name',500);
    if (entity.identifier !== null) bounded(entity.identifier,'entities.identifier',1000);
  }
  return db.transaction(() => {
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(actorId)) throw new Error('Unknown actor');
    const current = getClaimContext(db,claimId);
    if ((current ? current.id : null) !== expectedVersionId) throw new Error('Claim context changed');
    const state = getClaimState(db,claimId);
    if (state.status === 'superseded') throw new Error('Claim already superseded');
    db.prepare(`INSERT INTO claim_context_versions
      (claim_id,actor_id,normalized_wording,observed_at,entities_json,timeframe,location,reason)
      VALUES(?,?,?,?,?,?,?,?)`).run(claimId,actorId,normalizedWording,observedAt,JSON.stringify(entities),timeframe,location,reason);
    // A wording/context change always invalidates prior review, preserving restrictions.
    appendClaimEvent(db,{claimId,actorId,type:'unreviewed',reason:'Claim context changed',expectedEventId:state.eventId});
    return getClaimContext(db,claimId);
  }).immediate();
}
module.exports = { appendClaimContext, getClaimContext };

const DIMENSIONS=['origin','context','support','counterevidence','source_independence','identity'];
const STATES=new Set(['unknown','needs_work','reviewed','disputed','inaccessible','deferred']);
const OUTCOMES=new Set(['results','no_results','inaccessible','deferred']);
const RELATIONS=new Set(['related','duplicate','component_of']);
const {getClaimState}=require('./research-lifecycle');

function positive(value,name) {
  if(!Number.isSafeInteger(value)||value<1)throw new Error(`Invalid ${name}`);
  return value;
}
function bounded(value,name,maxBytes) {
  if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>maxBytes)throw new Error(`Invalid ${name}`);
  return value.trim();
}
function request(value) {
  if(typeof value!=='string'||!/(?:^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$)/.test(value))throw new Error('Invalid requestId');
  return value;
}
function editor(db,actorId) {
  positive(actorId,'actor');
  if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(actorId)?.role!=='editor')throw new Error('Invalid actor');
}
function claim(db,claimId) {
  const row=db.prepare('SELECT id,topic_id FROM research_claims WHERE id=?').get(positive(claimId,'claim'));
  if(!row)throw new Error('Unknown claim');
  return row;
}
function contextVersion(db,claimId) {
  return db.prepare('SELECT id FROM claim_context_versions WHERE claim_id=? ORDER BY id DESC LIMIT 1')
    .get(claimId)?.id??null;
}
function savedRequest(db,table,actorId,requestId,fields) {
  const prior=db.prepare(`SELECT * FROM ${table} WHERE actor_id=? AND request_id=?`).get(actorId,requestId);
  if(!prior)return null;
  if(fields.some(([key,value])=>prior[key]!==value))throw new Error('Invalid requestId reuse');
  return prior;
}
function assertRelationshipBounds(db,claimId) {
  const stats=db.prepare(`SELECT COUNT(*) AS count,
    COALESCE(SUM(length(CAST(r.reason AS BLOB))+COALESCE(length(CAST(v.reason AS BLOB)),0)),0) AS bytes
    FROM claim_relationships r LEFT JOIN claim_relationship_revocations v ON v.relationship_id=r.id
    WHERE r.claim_id=? OR r.other_claim_id=?`).get(claimId,claimId);
  if(stats.count>1000||stats.bytes>1000000)throw new Error('Invalid relationship projection size');
}
function relationshipHistory(db,claimId,after=0,limit=100) {
  return db.prepare(`SELECT r.*,v.id AS revocation_id,v.actor_id AS revocation_actor_id,
    v.action AS revocation_action,v.reason AS revocation_reason,v.request_id AS revocation_request_id,
    v.created_at AS revoked_at FROM claim_relationships r
    LEFT JOIN claim_relationship_revocations v ON v.relationship_id=r.id
    WHERE (r.claim_id=? OR r.other_claim_id=?) AND r.id>? ORDER BY r.id LIMIT ?`)
    .all(claimId,claimId,after,limit);
}
function decorateRelationships(db,rows) {
  const contexts=new Map(),statuses=new Map();
  function currentContext(id) {
    if(!contexts.has(id))contexts.set(id,contextVersion(db,id));
    return contexts.get(id);
  }
  function currentStatus(id) {
    if(!statuses.has(id))statuses.set(id,getClaimState(db,id).status);
    return statuses.get(id);
  }
  return rows.map(row=>{
    let inactiveReason=null;
    if(row.revocation_id!==null)inactiveReason=row.revocation_action;
    else if(row.type==='component_of'&&
      (row.claim_context_version_id!==currentContext(row.claim_id)||
       row.other_context_version_id!==currentContext(row.other_claim_id)||
       currentStatus(row.claim_id)!=='reviewed'||currentStatus(row.other_claim_id)!=='reviewed'))
      inactiveReason='stale_review';
    return {...row,active:inactiveReason===null,inactiveReason};
  });
}
function insertRelationship(db,{claimId,otherClaimId,type,actorId,reason,requestId},allowCorrectionKey=false) {
  if(!RELATIONS.has(type))throw new Error('Invalid relationship type');
  const why=bounded(reason,'reason',8000),key=request(requestId);
  positive(claimId,'claim');positive(otherClaimId,'other claim');
  if(claimId===otherClaimId)throw new Error('Invalid self relationship');
  const first=type==='component_of'?claimId:Math.min(claimId,otherClaimId);
  const second=type==='component_of'?otherClaimId:Math.max(claimId,otherClaimId);
  editor(db,actorId);
  if(claim(db,first).topic_id!==claim(db,second).topic_id)throw new Error('Invalid cross-topic relationship');
  if(!allowCorrectionKey&&db.prepare(`SELECT id FROM claim_relationship_revocations
    WHERE actor_id=? AND request_id=?`).get(actorId,key))throw new Error('Invalid requestId reuse');
  const fields=[['claim_id',first],['other_claim_id',second],['type',type],['reason',why]];
  const prior=savedRequest(db,'claim_relationships',actorId,key,fields);
  if(prior)return prior;
  if(type==='component_of'&&
    (getClaimState(db,first).status!=='reviewed'||getClaimState(db,second).status!=='reviewed'))
    throw new Error('Invalid unreviewed compound split');
  const existing=db.prepare(`SELECT r.*,v.id AS revocation_id,v.action AS revocation_action
    FROM claim_relationships r LEFT JOIN claim_relationship_revocations v ON v.relationship_id=r.id
    WHERE r.claim_id=? AND r.other_claim_id=? AND r.type=? ORDER BY r.id LIMIT 1001`)
    .all(first,second,type);
  if(existing.length>1000)throw new Error('Invalid relationship projection size');
  if(decorateRelationships(db,existing).some(row=>row.active))
    throw new Error('Invalid relationship already recorded');
  const firstContext=type==='component_of'?contextVersion(db,first):null;
  const secondContext=type==='component_of'?contextVersion(db,second):null;
  const result=db.prepare(`INSERT INTO claim_relationships
    (claim_id,other_claim_id,type,actor_id,claim_context_version_id,other_context_version_id,reason,request_id)
    VALUES(?,?,?,?,?,?,?,?)`)
    .run(first,second,type,actorId,firstContext,secondContext,why,key);
  assertRelationshipBounds(db,first);assertRelationshipBounds(db,second);
  return db.prepare('SELECT * FROM claim_relationships WHERE id=?').get(result.lastInsertRowid);
}
function appendClaimRelationship(db,input) {
  return db.transaction(()=>insertRelationship(db,input)).immediate();
}
function revokeRelationship(db,{relationshipId,actorId,reason,requestId,action='revoked'}) {
  positive(relationshipId,'relationship');
  if(!['revoked','corrected'].includes(action))throw new Error('Invalid relationship action');
  const why=bounded(reason,'reason',8000),key=request(requestId);
  editor(db,actorId);
  const relationship=db.prepare('SELECT * FROM claim_relationships WHERE id=?').get(relationshipId);
  if(!relationship)throw new Error('Unknown relationship');
  const fields=[['relationship_id',relationshipId],['action',action],['reason',why]];
  const prior=savedRequest(db,'claim_relationship_revocations',actorId,key,fields);
  if(prior)return prior;
  if(action==='revoked'&&db.prepare('SELECT id FROM claim_relationships WHERE actor_id=? AND request_id=?')
    .get(actorId,key))throw new Error('Invalid requestId reuse');
  if(db.prepare('SELECT id FROM claim_relationship_revocations WHERE relationship_id=?').get(relationshipId))
    throw new Error('Invalid relationship already revoked');
  const result=db.prepare(`INSERT INTO claim_relationship_revocations
    (relationship_id,actor_id,action,reason,request_id) VALUES(?,?,?,?,?)`)
    .run(relationshipId,actorId,action,why,key);
  assertRelationshipBounds(db,relationship.claim_id);assertRelationshipBounds(db,relationship.other_claim_id);
  return db.prepare('SELECT * FROM claim_relationship_revocations WHERE id=?').get(result.lastInsertRowid);
}
function revokeClaimRelationship(db,input) {
  return db.transaction(()=>revokeRelationship(db,input)).immediate();
}
function correctClaimRelationship(db,{relationshipId,claimId,otherClaimId,type,actorId,reason,requestId}) {
  const key=request(requestId),why=bounded(reason,'reason',8000);
  return db.transaction(()=>{
    editor(db,actorId);
    const prior=db.prepare('SELECT * FROM claim_relationship_revocations WHERE actor_id=? AND request_id=?')
      .get(actorId,key);
    if(prior) {
      if(prior.relationship_id!==relationshipId||prior.action!=='corrected'||prior.reason!==why)
        throw new Error('Invalid requestId reuse');
      const replacement=db.prepare('SELECT * FROM claim_relationships WHERE actor_id=? AND request_id=?')
        .get(actorId,key);
      if(!replacement)throw new Error('Invalid correction audit');
      const first=type==='component_of'?claimId:Math.min(claimId,otherClaimId);
      const second=type==='component_of'?otherClaimId:Math.max(claimId,otherClaimId);
      if(replacement.claim_id!==first||replacement.other_claim_id!==second||
        replacement.type!==type||replacement.reason!==why)throw new Error('Invalid requestId reuse');
      return {revocation:prior,replacement};
    }
    if(db.prepare('SELECT id FROM claim_relationships WHERE actor_id=? AND request_id=?').get(actorId,key))
      throw new Error('Invalid requestId reuse');
    const original=db.prepare('SELECT * FROM claim_relationships WHERE id=?').get(positive(relationshipId,'relationship'));
    if(!original)throw new Error('Unknown relationship');
    if(claimId!==original.claim_id&&claimId!==original.other_claim_id)
      throw new Error('Invalid correction claim');
    const revocation=revokeRelationship(db,{relationshipId,actorId,reason:why,requestId:key,action:'corrected'});
    const replacement=insertRelationship(db,{claimId,otherClaimId,type,actorId,reason:why,requestId:key},true);
    return {revocation,replacement};
  }).immediate();
}
function listClaimRelationships(db,claimId,after=0) {
  claim(db,claimId);
  if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid after');
  return decorateRelationships(db,relationshipHistory(db,claimId,after));
}
function appendClaimSearchAttempt(db,{claimId,actorId,query,sourceUrl=null,outcome,note,requestId}) {
  const phrase=bounded(query,'query',4000),detail=bounded(note,'note',8000),key=request(requestId);
  if(phrase.length>2000||!OUTCOMES.has(outcome))throw new Error('Invalid search attempt');
  if(sourceUrl!==null) {
    if(typeof sourceUrl!=='string'||sourceUrl.length>2048||Buffer.byteLength(sourceUrl)>4096)
      throw new Error('Invalid sourceUrl');
    let parsed;
    try {parsed=new URL(sourceUrl);} catch {throw new Error('Invalid sourceUrl');}
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)
      throw new Error('Invalid sourceUrl');
  }
  return db.transaction(()=>{
    editor(db,actorId);claim(db,claimId);
    const fields=[['claim_id',claimId],['query',phrase],['source_url',sourceUrl],['outcome',outcome],['note',detail]];
    const prior=savedRequest(db,'claim_search_attempts',actorId,key,fields);
    if(prior)return prior;
    const result=db.prepare(`INSERT INTO claim_search_attempts
      (claim_id,actor_id,query,source_url,outcome,note,request_id) VALUES(?,?,?,?,?,?,?)`)
      .run(claimId,actorId,phrase,sourceUrl,outcome,detail,key);
    return db.prepare('SELECT * FROM claim_search_attempts WHERE id=?').get(result.lastInsertRowid);
  }).immediate();
}
function listClaimSearchAttempts(db,claimId,after=0) {
  claim(db,claimId);
  if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid after');
  return db.prepare('SELECT * FROM claim_search_attempts WHERE claim_id=? AND id>? ORDER BY id LIMIT 100')
    .all(claimId,after);
}
function appendClaimCoverageEvent(db,{claimId,actorId,dimension,state,reason,
  expectedEventId,expectedContextVersionId,requestId}) {
  if(!DIMENSIONS.includes(dimension)||!STATES.has(state))throw new Error('Invalid coverage state');
  const why=bounded(reason,'reason',8000),key=request(requestId);
  if(expectedEventId!==null&&(!Number.isSafeInteger(expectedEventId)||expectedEventId<1))
    throw new Error('Invalid expected event');
  if(expectedContextVersionId!==null&&
    (!Number.isSafeInteger(expectedContextVersionId)||expectedContextVersionId<1))
    throw new Error('Invalid expected context version');
  return db.transaction(()=>{
    editor(db,actorId);claim(db,claimId);
    const fields=[['claim_id',claimId],['dimension',dimension],['state',state],['reason',why],
      ['expected_event_id',expectedEventId],['context_version_id',expectedContextVersionId]];
    const prior=savedRequest(db,'claim_coverage_events',actorId,key,fields);
    if(prior)return prior;
    if(contextVersion(db,claimId)!==expectedContextVersionId)throw new Error('Coverage context changed');
    const current=db.prepare(`SELECT id FROM claim_coverage_events
      WHERE claim_id=? AND dimension=? AND context_version_id IS ?
      ORDER BY id DESC LIMIT 1`).get(claimId,dimension,expectedContextVersionId);
    if((current?.id??null)!==expectedEventId)throw new Error('Coverage changed');
    const result=db.prepare(`INSERT INTO claim_coverage_events
      (claim_id,actor_id,context_version_id,dimension,state,expected_event_id,reason,request_id)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(claimId,actorId,expectedContextVersionId,dimension,state,expectedEventId,why,key);
    return db.prepare('SELECT * FROM claim_coverage_events WHERE id=?').get(result.lastInsertRowid);
  }).immediate();
}
function listClaimCoverageEvents(db,claimId,after=0) {
  claim(db,claimId);
  if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid after');
  return db.prepare('SELECT * FROM claim_coverage_events WHERE claim_id=? AND id>? ORDER BY id LIMIT 100')
    .all(claimId,after);
}
function projectClaimResearch(db,claimId) {
  claim(db,claimId);
  const relationshipHistoryRows=relationshipHistory(db,claimId,0,1001);
  if(relationshipHistoryRows.length>1000)throw new Error('Invalid relationship projection size');
  if(relationshipHistoryRows.reduce((total,row)=>total+Buffer.byteLength(row.reason)+
    Buffer.byteLength(row.revocation_reason??''),0)>1000000)
    throw new Error('Invalid relationship projection size');
  const relationshipHistoryProjection=decorateRelationships(db,relationshipHistoryRows);
  const relationships=relationshipHistoryProjection.filter(row=>row.active);
  const latest=db.prepare(`SELECT e.* FROM claim_coverage_events e WHERE e.claim_id=? AND e.id=(
    SELECT MAX(e2.id) FROM claim_coverage_events e2 WHERE e2.claim_id=e.claim_id AND e2.dimension=e.dimension)
    ORDER BY e.dimension`).all(claimId);
  const currentContext=contextVersion(db,claimId);
  const coverage=Object.fromEntries(DIMENSIONS.map(dimension=>[dimension,
    (()=>{
      const event=latest.find(row=>row.dimension===dimension);
      if(!event)return {dimension,state:'unknown',id:null,contextVersionId:currentContext};
      if(event.context_version_id!==currentContext)return {dimension,state:'unknown',id:null,
        contextVersionId:currentContext,staleEventId:event.id,staleState:event.state};
      return event;
    })()]));
  const searchOutcomes=Object.fromEntries(db.prepare(`SELECT outcome,COUNT(*) AS count FROM claim_search_attempts
    WHERE claim_id=? GROUP BY outcome`).all(claimId).map(row=>[row.outcome,row.count]));
  return {relationships,relationshipHistory:relationshipHistoryProjection,coverage,searchOutcomes,
    searchAttempts:db.prepare(`SELECT * FROM claim_search_attempts WHERE claim_id=? ORDER BY id DESC LIMIT 100`)
      .all(claimId).reverse()};
}
module.exports={appendClaimRelationship,revokeClaimRelationship,correctClaimRelationship,listClaimRelationships,
  appendClaimSearchAttempt,
  listClaimSearchAttempts,appendClaimCoverageEvent,listClaimCoverageEvents,projectClaimResearch};

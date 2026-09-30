const POLICIES = new Set(['private','excerpt_only','public_original','restricted']);
function requireSource(db,id) {
  if (!Number.isSafeInteger(id) || id<=0 || !db.prepare('SELECT id FROM source_items WHERE id=?').get(id)) throw new Error('Unknown source');
}
function getSourceAccess(db,sourceId) {
  requireSource(db,sourceId);
  const row=db.prepare('SELECT id,policy FROM source_access_events WHERE source_id=? ORDER BY id DESC LIMIT 1').get(sourceId);
  return row ? {policy:row.policy,eventId:row.id} : {policy:'private',eventId:null};
}
// Internal service: API must enforce authenticated editor identity separately.
function setSourceAccess(db,{sourceId,actorId,policy,reason,expectedEventId}) {
  if (!POLICIES.has(policy)) throw new Error('Invalid policy');
  if (typeof reason!=='string' || !reason.trim() || reason.length>8000) throw new Error('Invalid reason');
  if (!Number.isSafeInteger(actorId) || actorId<=0) throw new Error('Invalid actor');
  if (expectedEventId!==null && (!Number.isSafeInteger(expectedEventId) || expectedEventId<=0)) throw new Error('Invalid expected event');
  return db.transaction(()=>{
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(actorId)) throw new Error('Unknown actor');
    const current=getSourceAccess(db,sourceId);
    if (current.eventId!==expectedEventId) throw new Error('Source access changed');
    if(policy==='restricted'||current.policy==='restricted')
      require('./publication/owner-authority').requirePublicationOwner(db,actorId);
    const info=db.prepare('INSERT INTO source_access_events(source_id,actor_id,policy,reason) VALUES(?,?,?,?)').run(sourceId,actorId,policy,reason);
    require('./publication/service').invalidateSourceForChange(db,
      {sourceId,actorId,reason,restricted:policy==='restricted'});
    return db.prepare('SELECT * FROM source_access_events WHERE id=?').get(info.lastInsertRowid);
  }).immediate();
}
function checkedUrl(value) {
  if (typeof value!=='string' || value.length>8000) throw new Error('Invalid URL');
  const url=new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
  return url.href;
}
function recordRetrieval(db,{sourceId,url,finalUrl,status,retrievedAt,sha256,mime,method}) {
  requireSource(db,sourceId);
  const original=checkedUrl(url), final=checkedUrl(finalUrl);
  if (!Number.isInteger(status) || status<100 || status>599) throw new Error('Invalid status');
  if (typeof retrievedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(retrievedAt) ||
      !Number.isFinite(Date.parse(retrievedAt)) || new Date(retrievedAt).toISOString()!==retrievedAt) throw new Error('Invalid retrievedAt');
  if (sha256!==null && (typeof sha256!=='string' || !/^[a-f0-9]{64}$/.test(sha256))) throw new Error('Invalid digest');
  if (status>=200 && status<300 && sha256===null) throw new Error('Successful retrieval requires original digest');
  if (typeof mime!=='string' || mime.length>200 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) throw new Error('Invalid MIME');
  if (!['manual_import','http','wayback','archive_link'].includes(method)) throw new Error('Invalid method');
  const result=db.prepare(`INSERT INTO source_retrievals(source_id,url,final_url,status,retrieved_at,sha256,mime,method)
    VALUES(?,?,?,?,?,?,?,?)`).run(sourceId,original,final,status,retrievedAt,sha256,mime,method);
  return db.prepare('SELECT * FROM source_retrievals WHERE id=?').get(result.lastInsertRowid);
}
function listRetrievals(db,sourceId) {
  requireSource(db,sourceId);
  return db.prepare('SELECT * FROM source_retrievals WHERE source_id=? ORDER BY id').all(sourceId);
}
module.exports={setSourceAccess,getSourceAccess,recordRetrieval,listRetrievals};

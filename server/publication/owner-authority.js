'use strict';
const {createHash}=require('node:crypto');
function fail(code){throw Object.assign(new Error(`Publication owner ${code}`),{code});}
function ownerEvent(db,userId){return db.prepare('SELECT id,allowed FROM publication_owner_events WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId)??null;}
function requireEditor(db,userId){if(!Number.isSafeInteger(userId)||userId<1||
  db.prepare("SELECT role FROM user_roles WHERE user_id=?").get(userId)?.role!=='editor')fail('editor_required');}
function requirePublicationOwner(db,userId){
  requireEditor(db,userId);
  if(ownerEvent(db,userId)?.allowed!==1)fail('publication_owner_required');
}
function setPublicationOwner(db,{subject,allowed,reason,operator,expectedEventId,requestKey,now=Date.now()}){
  if(typeof subject!=='string'||!subject.trim()||subject.length>255||typeof allowed!=='boolean'||
    typeof reason!=='string'||!reason.trim()||reason.length>500||/[\x00-\x1f\x7f]/.test(reason)||
    typeof operator!=='string'||!operator.trim()||operator.length>120||/[\x00-\x1f\x7f]/.test(operator)||
    !(expectedEventId===null||Number.isSafeInteger(expectedEventId)&&expectedEventId>0)||
    typeof requestKey!=='string'||!/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)||
    !Number.isSafeInteger(now)||now<0||now>8640000000000000)fail('invalid_request');
  const requestHash=createHash('sha256').update(JSON.stringify([subject,allowed,reason,operator,expectedEventId])).digest('hex');
  return db.transaction(()=>{
    const prior=db.prepare('SELECT * FROM publication_owner_events WHERE request_key=?').get(requestKey);
    if(prior){if(prior.request_hash!==requestHash)fail('idempotency_conflict');return prior;}
    const user=db.prepare('SELECT user_id FROM google_identities WHERE subject=?').get(subject);
    if(!user)fail('verified_identity_required');
    if(allowed)requireEditor(db,user.user_id);
    if((ownerEvent(db,user.user_id)?.id??null)!==expectedEventId)fail('owner_conflict');
    const result=db.prepare(`INSERT INTO publication_owner_events(user_id,allowed,reason,operator,
      occurred_at_ms,request_key,request_hash) VALUES(?,?,?,?,?,?,?)`)
      .run(user.user_id,Number(allowed),reason,operator,now,requestKey,requestHash);
    return db.prepare('SELECT * FROM publication_owner_events WHERE id=?').get(result.lastInsertRowid);
  }).immediate();
}
module.exports={ownerEvent,requireEditor,requirePublicationOwner,setPublicationOwner};

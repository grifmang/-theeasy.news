'use strict';
const {randomUUID}=require('node:crypto');
const {loadExportCommand,fenceExportCommand}=require('./service');
const {TARGETS}=require('./local-export');
const FATAL_EXPORT_CODES=new Set(['reconciliation_required','sink_conflict','missing_sink_marker',
  'sink_locked','directory_sync_failed','artifact_conflict','invalid_manifest','invalid_head',
  'unexpected_artifact','unbound_sink_marker']);
function fail(code){throw Object.assign(new Error(`Publication delivery ${code}`),{code});}
function checkedTime(now){if(!Number.isSafeInteger(now)||now<0||now>8640000000000000)fail('invalid_clock');}
function leaseRow(db,id){return db.prepare('SELECT * FROM publication_delivery_tasks WHERE id=?').get(id);}
function claimDelivery(db,{now=Date.now(),leaseMs=30000,signal}={}){
  checkedTime(now);
  if(signal?.aborted)fail('aborted');
  if(!Number.isSafeInteger(leaseMs)||leaseMs<1000||leaseMs>30000)fail('invalid_lease');
  return db.transaction(()=>{
    if(signal?.aborted)fail('aborted');
    db.prepare(`UPDATE publication_delivery_tasks SET state='failed',lease_token=NULL,
      lease_until_ms=NULL,last_error_code='lease_exhausted'
      WHERE state='leased' AND attempts>=10 AND lease_until_ms<=?`).run(now);
    const row=db.prepare(`SELECT t.id FROM publication_delivery_tasks t
      JOIN publication_outbox o ON o.id=t.outbox_id
      WHERE t.target IN ('public_index','static_snapshot','cache','document_preview')
        AND t.attempts<10 AND
        ((t.state='pending' AND t.ready_at_ms<=?) OR
         (t.state='leased' AND t.lease_until_ms<=?))
        AND (o.action='invalidate' OR
          (SELECT state FROM work_admission_state WHERE id=1)='running')
      ORDER BY CASE o.action WHEN 'invalidate' THEN 0 ELSE 1 END,t.id LIMIT 1`).get(now,now);
    if(!row)return null;
    const token=randomUUID(),until=now+leaseMs;
    if(until>8640000000000000)fail('invalid_clock');
    const result=db.prepare(`UPDATE publication_delivery_tasks SET state='leased',
      attempts=attempts+1,lease_token=?,lease_until_ms=?,last_error_code=NULL
      WHERE id=? AND attempts<10 AND
      ((state='pending' AND ready_at_ms<=?) OR (state='leased' AND lease_until_ms<=?))`)
      .run(token,until,row.id,now,now);
    if(result.changes!==1)fail('claim_conflict');
    return leaseRow(db,row.id);
  }).immediate();
}
function currentLease(db,task,now){
  const row=leaseRow(db,task?.id);
  if(!row||row.state!=='leased'||row.lease_token!==task.lease_token||
    row.lease_until_ms<=now)fail('stale_lease');
  return row;
}
function renewDelivery(db,task,{now=Date.now(),leaseMs=30000}={}){
  checkedTime(now);
  if(!Number.isSafeInteger(leaseMs)||leaseMs<1000||leaseMs>30000)fail('invalid_lease');
  return db.transaction(()=>{
    currentLease(db,task,now);
    const result=db.prepare(`UPDATE publication_delivery_tasks SET lease_until_ms=?
      WHERE id=? AND state='leased' AND lease_token=? AND lease_until_ms>?`)
      .run(now+leaseMs,task.id,task.lease_token,now);
    if(result.changes!==1)fail('stale_lease');
    return leaseRow(db,task.id);
  }).immediate();
}
function prepareDelivery(db,task,{sinkId,now=Date.now(),signal}={}){
  checkedTime(now);if(signal?.aborted)fail('aborted');
  currentLease(db,task,now);
  if(typeof sinkId!=='string')fail('invalid_sink');
  const row=db.prepare(`SELECT o.action FROM publication_delivery_tasks t
    JOIN publication_outbox o ON o.id=t.outbox_id WHERE t.id=?`).get(task.id);
  if(!row||!TARGETS.has(task.target))fail('invalid_task');
  const prepared=loadExportCommand(db,{outboxId:task.outbox_id,target:task.target,sinkId});
  prepared.command.taskId=task.id;
  return prepared;
}
function acknowledgeDelivery(db,task,{sink,prepared,now=Date.now(),clock=Date.now,signal}={}){
  checkedTime(now);if(signal?.aborted)fail('aborted');
  if(!sink||typeof sink.apply!=='function'||!prepared?.command)fail('invalid_request');
  return db.transaction(()=>{
    if(signal?.aborted)fail('aborted');
    const row=currentLease(db,task,now),fence=fenceExportCommand(db,prepared);
    if(prepared.command.taskId!==row.id||prepared.command.outboxId!==row.outbox_id||
      prepared.command.target!==row.target||prepared.command.generation!==row.generation)
      fail('invalid_task');
    let result;
    if(prepared.installedEvidence)
      result=sink.confirmInstalled(prepared.command,prepared.installedEvidence);
    else if(fence.superseded){
      if(sink.unpointedLink(prepared.command))fail('await_higher_head');
      result={outcome:'superseded',appliedGeneration:fence.appliedGeneration,
        artifactSha256:null,artifactSize:null,manifestSha256:null};
    }
    else{
      // This is the sole bounded local filesystem operation under an IMMEDIATE
      // SQLite fence. It prevents a head change between final check and apply.
      result=sink.apply(prepared.command,prepared.dtoJson,{signal});
      if(result.outcome==='superseded')fail('reconciliation_required');
    }
    if(signal?.aborted)fail('aborted');
    const completedAt=clock();checkedTime(completedAt);
    currentLease(db,task,completedAt);
    db.prepare(`INSERT INTO publication_delivery_receipts(task_id,outbox_id,sink_id,target,
      claim_id,generation,action,outcome,applied_generation,dto_sha256,artifact_sha256,
      artifact_size,manifest_sha256,lease_token,completed_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id,row.outbox_id,prepared.command.sinkId,
      row.target,prepared.command.claimId,row.generation,prepared.command.action,result.outcome,
      result.appliedGeneration,prepared.command.dtoSha256,result.artifactSha256,
      result.artifactSize,result.manifestSha256,row.lease_token,completedAt);
    const changed=db.prepare(`UPDATE publication_delivery_tasks SET state='done',lease_token=NULL,
      lease_until_ms=NULL,last_error_code=NULL WHERE id=? AND state='leased' AND lease_token=?
      AND lease_until_ms>?`).run(row.id,row.lease_token,completedAt);
    if(changed.changes!==1)fail('stale_lease');
    return result;
  }).immediate();
}
function failDelivery(db,task,{now=Date.now(),errorCode='delivery_failed'}={}){
  checkedTime(now);
  if(typeof errorCode!=='string'||!/^[a-z_]{1,64}$/.test(errorCode))errorCode='delivery_failed';
  return db.transaction(()=>{
    const row=currentLease(db,task,now),waiting=errorCode==='await_higher_head';
    const exhausted=!waiting&&row.attempts>=10;
    const delay=waiting?30000:Math.min(60000,1000*2**Math.min(row.attempts-1,6));
    const changed=db.prepare(`UPDATE publication_delivery_tasks SET state=?,ready_at_ms=?,
      lease_token=NULL,lease_until_ms=NULL,last_error_code=?,attempts=?
      WHERE id=? AND state='leased' AND lease_token=? AND lease_until_ms>?`)
      .run(exhausted?'failed':'pending',Math.min(8640000000000000,now+delay),errorCode,
        waiting?row.attempts-1:row.attempts,
        row.id,row.lease_token,now);
    if(changed.changes!==1)fail('stale_lease');
    return {state:exhausted?'failed':'pending',retryAt:exhausted?null:now+delay};
  }).immediate();
}
function runNextPublicationDelivery(db,{sink,sinkId,clock=Date.now,signal}={}){
  if(signal?.aborted)fail('aborted');
  const task=claimDelivery(db,{now:clock(),signal});if(!task)return null;
  try{
    const prepared=prepareDelivery(db,task,{sinkId,now:clock(),signal});
    prepared.installedEvidence=sink.inspectInstalled(prepared.command);
    if(!prepared.superseded&&!prepared.installedEvidence&&prepared.command.action==='activate')
      sink.prepareArtifact(prepared.command,prepared.dtoJson,{signal});
    try{
      if(signal?.aborted)fail('aborted');
      return acknowledgeDelivery(db,task,{sink,prepared,now:clock(),clock,signal});
    }
    finally{sink.discardPrepared?.(task.id);}
  }catch(error){
    if(FATAL_EXPORT_CODES.has(error.code))throw error;
    try{failDelivery(db,task,{now:clock(),errorCode:error.code??'delivery_failed'});}catch{}
    throw error;
  }
}
module.exports={claimDelivery,renewDelivery,prepareDelivery,acknowledgeDelivery,failDelivery,
  runNextPublicationDelivery,FATAL_EXPORT_CODES};

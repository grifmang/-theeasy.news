'use strict';

const {createHash,randomUUID}=require('node:crypto');
const {loadAnalysisVersion}=require('./persistence');
const {buildEvidencePacket}=require('../evidence/packet');
const {isPaused}=require('../ops/work-admission');
const {DECISION_MODEL,POLICY_VERSION}=require('./verify');

const POLICY=Object.freeze({version:POLICY_VERSION,decisionModel:DECISION_MODEL});
const LEASE_MS=30000;
function fail(code){throw Object.assign(new Error(`Analysis job ${code}`),{code});}
function time(value){return Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;}
function editor(db,actorId){if(!Number.isSafeInteger(actorId)||actorId<1||
  db.prepare("SELECT role FROM user_roles WHERE user_id=?").get(actorId)?.role!=='editor')fail('editor_required');}
function admissionHash(version){return createHash('sha256').update(JSON.stringify([
  version.draft_sha256,version.packet_version,POLICY_VERSION,DECISION_MODEL])).digest('hex');}
function currentBinding(db,version){
  const packet=buildEvidencePacket(db,version.claim_id);
  const context=db.prepare('SELECT id FROM claim_context_versions WHERE claim_id=? ORDER BY id DESC LIMIT 1').get(version.claim_id);
  return packet.version===version.packet_version&&packet.context?.id===version.claim_context_version_id&&
    context?.id===version.claim_context_version_id;
}
function currentJob(db,job){
  const version=loadAnalysisVersion(db,job.analysis_version_id);
  return job.policy_version===POLICY_VERSION&&job.decision_model===DECISION_MODEL&&
    job.admission_hash===admissionHash(version)&&currentBinding(db,version);
}
function authorized(db,job){const latest=db.prepare(`SELECT e.allowed,r.role FROM analysis_verification_permission_events e
  LEFT JOIN user_roles r ON r.user_id=e.actor_id
  WHERE e.job_id=? AND e.admission_hash=? ORDER BY e.id DESC LIMIT 1`).get(job.id,job.admission_hash);
  return latest?.allowed===1&&latest.role==='editor';}
function enqueueVerificationJob(db,{analysisVersionId,actorId,now=Date.now(),maxAttempts=3,deadlineMs=300000}){
  if(!time(now)||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>3||
    !Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>300000||!time(now+deadlineMs))fail('invalid_request');
  return db.transaction(()=>{
    editor(db,actorId);
    const version=loadAnalysisVersion(db,analysisVersionId);
    if(!currentBinding(db,version))fail('version_changed');
    const hash=admissionHash(version);
    db.prepare(`INSERT INTO analysis_verification_jobs(analysis_version_id,policy_version,decision_model,
      admission_hash,max_attempts,enqueued_by,enqueued_at_ms,task_deadline_at_ms,retry_ready_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(analysis_version_id,policy_version,decision_model,admission_hash)
      DO NOTHING`).run(analysisVersionId,POLICY_VERSION,DECISION_MODEL,hash,maxAttempts,actorId,now,now+deadlineMs,now);
    return db.prepare(`SELECT * FROM analysis_verification_jobs WHERE analysis_version_id=? AND policy_version=?
      AND decision_model=? AND admission_hash=?`).get(analysisVersionId,POLICY_VERSION,DECISION_MODEL,hash);
  }).immediate();
}
function authorizeVerificationJob(db,{jobId,actorId,allowed,reason,expectedEventId,
  expectedAdmissionHash,now=Date.now()}){
  if(!Number.isSafeInteger(jobId)||jobId<1||typeof allowed!=='boolean'||!time(now)||
    typeof reason!=='string'||!reason.trim()||reason.length>500||/[\x00-\x1f\x7f]/.test(reason)||
    !(expectedEventId===null||Number.isSafeInteger(expectedEventId)&&expectedEventId>0)||
    typeof expectedAdmissionHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedAdmissionHash))fail('invalid_request');
  return db.transaction(()=>{
    editor(db,actorId);
    const job=db.prepare('SELECT * FROM analysis_verification_jobs WHERE id=?').get(jobId);
    if(!job)fail('unknown_job');
    const latest=db.prepare('SELECT id FROM analysis_verification_permission_events WHERE job_id=? ORDER BY id DESC LIMIT 1').get(jobId);
    if(job.admission_hash!==expectedAdmissionHash||(latest?.id??null)!==expectedEventId)fail('permission_conflict');
    if(!currentJob(db,job))fail('version_changed');
    if(['done','exhausted','blocked'].includes(job.state))fail('job_settled');
    const result=db.prepare(`INSERT INTO analysis_verification_permission_events
      (job_id,admission_hash,allowed,actor_id,reason,occurred_at_ms) VALUES(?,?,?,?,?,?)`)
      .run(jobId,job.admission_hash,Number(allowed),actorId,reason,now);
    return db.prepare('SELECT * FROM analysis_verification_permission_events WHERE id=?').get(result.lastInsertRowid);
  }).immediate();
}
function sweep(db,now){
  db.prepare(`UPDATE analysis_verification_jobs SET state='exhausted',lease_token=NULL,lease_until_ms=NULL,last_error='deadline_expired'
    WHERE state IN ('queued','retry_wait','leased') AND task_deadline_at_ms<=?`).run(now);
  db.prepare(`UPDATE analysis_verification_jobs SET state='exhausted',lease_token=NULL,lease_until_ms=NULL,last_error='lease_expired'
    WHERE state='leased' AND lease_until_ms<=? AND attempts>=max_attempts`).run(now);
  db.prepare(`UPDATE analysis_verification_jobs SET state='retry_wait',lease_token=NULL,lease_until_ms=NULL,
    retry_ready_at_ms=?,last_error='lease_expired' WHERE state='leased' AND lease_until_ms<=? AND attempts<max_attempts`).run(now,now);
}
function claimNextVerificationJob(db,{now=Date.now(),leaseMs=LEASE_MS}={}){
  if(!time(now))fail('invalid_request');
  if(!Number.isSafeInteger(leaseMs)||leaseMs<16000||leaseMs>60000)fail('invalid_request');
  return db.transaction(()=>{
    if(isPaused(db))return null;
    sweep(db,now);
    const candidates=db.prepare(`SELECT * FROM analysis_verification_jobs WHERE state IN ('queued','retry_wait')
      AND retry_ready_at_ms<=? AND task_deadline_at_ms>? AND attempts<max_attempts
      AND EXISTS(SELECT 1 FROM analysis_verification_permission_events e
        JOIN user_roles r ON r.user_id=e.actor_id AND r.role='editor'
        WHERE e.job_id=analysis_verification_jobs.id AND e.admission_hash=analysis_verification_jobs.admission_hash
          AND e.allowed=1 AND e.id=(SELECT MAX(latest.id) FROM analysis_verification_permission_events latest
            WHERE latest.job_id=analysis_verification_jobs.id))
      ORDER BY id LIMIT 100`).all(now,now);
    for(const job of candidates){
      if(!currentJob(db,job)){
        db.prepare("UPDATE analysis_verification_jobs SET state='blocked',last_error='version_changed' WHERE id=?").run(job.id);
        continue;
      }
      if(!authorized(db,job))continue;
      const token=randomUUID(),until=Math.min(job.task_deadline_at_ms,now+leaseMs);
      db.prepare(`UPDATE analysis_verification_jobs SET state='leased',attempts=attempts+1,
        lease_token=?,lease_until_ms=? WHERE id=?`).run(token,until,job.id);
      return db.prepare('SELECT * FROM analysis_verification_jobs WHERE id=?').get(job.id);
    }
    return null;
  }).immediate();
}
function gateAdapterCall(db,job,{now=Date.now(),leaseMs=LEASE_MS,dispatch=false,renew=false}={}){
  if(!time(now))fail('invalid_request');
  if(!Number.isSafeInteger(leaseMs)||leaseMs<16000||leaseMs>60000||
    typeof dispatch!=='boolean'||typeof renew!=='boolean')fail('invalid_request');
  const check=()=>{
    const current=db.prepare('SELECT * FROM analysis_verification_jobs WHERE id=?').get(job.id);
    if(!current||current.state!=='leased'||current.lease_token!==job.lease_token||current.lease_until_ms<=now)fail('lease_lost');
    if(now>=current.task_deadline_at_ms)fail('deadline_expired');
    if(isPaused(db))fail('work_paused');
    if(db.prepare('SELECT paused_at FROM provider_queue_state WHERE id=1').get()?.paused_at!==null)
      fail('provider_paused');
    if(!authorized(db,current))fail('permission_required');
    if(!currentJob(db,current))fail('version_changed');
    if(dispatch)db.prepare(`UPDATE analysis_verification_jobs SET dispatch_started_at_ms=COALESCE(dispatch_started_at_ms,?),
      lease_until_ms=MIN(task_deadline_at_ms,?) WHERE id=? AND lease_token=?`)
      .run(now,now+leaseMs,current.id,job.lease_token);
    else if(renew)db.prepare(`UPDATE analysis_verification_jobs SET lease_until_ms=MIN(task_deadline_at_ms,?)
      WHERE id=? AND lease_token=?`).run(now+leaseMs,current.id,job.lease_token);
    return current;
  };
  return db.inTransaction?check():db.transaction(check).immediate();
}
function settleVerificationJob(db,job,{now=Date.now(),error}={}){
  if(!time(now)||typeof error!=='string'||!/^[a-z_]{1,64}$/.test(error))fail('invalid_request');
  return db.transaction(()=>{
    const current=db.prepare('SELECT * FROM analysis_verification_jobs WHERE id=?').get(job.id);
    if(!current||current.state!=='leased'||current.lease_token!==job.lease_token||current.lease_until_ms<=now)return false;
    const parked=['work_paused','provider_paused','budget_guard_tripped','aborted','budget_exhausted',
      'concurrency_exhausted','pending_reconciliation','clock_rollback'].includes(error);
    if(parked){
      const delay=['work_paused','provider_paused'].includes(error)?5000:
        error==='pending_reconciliation'?30000:15000;
      db.prepare(`UPDATE analysis_verification_jobs SET state='retry_wait',attempts=attempts-1,
        last_error=?,lease_token=NULL,lease_until_ms=NULL,retry_ready_at_ms=?
        WHERE id=? AND lease_token=?`).run(error,Math.min(now+delay,current.task_deadline_at_ms),current.id,job.lease_token);
      return true;
    }
    const terminal=['version_changed','permission_required','provider_auth','provider_configuration',
      'price_unavailable'].includes(error)?'blocked':
      error==='deadline_expired'||now>=current.task_deadline_at_ms||current.attempts>=current.max_attempts?'exhausted':null;
    const state=terminal||'retry_wait';
    const backoff=Math.min(30000,1000*2**(current.attempts-1));
    db.prepare(`UPDATE analysis_verification_jobs SET state=?,last_error=?,lease_token=NULL,lease_until_ms=NULL,
      retry_ready_at_ms=? WHERE id=? AND lease_token=?`).run(state,error||'provider_error',Math.min(now+backoff,current.task_deadline_at_ms),current.id,job.lease_token);
    return true;
  }).immediate();
}
function completeVerificationJobInTransaction(db,job,report,now){
  if(!time(now))fail('invalid_request');
  const current=db.prepare('SELECT * FROM analysis_verification_jobs WHERE id=?').get(job.id);
  if(!current||current.state!=='leased'||current.lease_token!==job.lease_token||current.lease_until_ms<=now)
    fail('lease_lost');
  if(now>=current.task_deadline_at_ms)fail('deadline_expired');
  if(isPaused(db))fail('work_paused');
  if(db.prepare('SELECT paused_at FROM provider_queue_state WHERE id=1').get()?.paused_at!==null)fail('provider_paused');
  if(!authorized(db,current))fail('permission_required');
  if(!currentJob(db,current))fail('version_changed');
  if(report.analysis_version_id!==current.analysis_version_id||report.policy_version!==POLICY_VERSION||
    report.decision_model!==DECISION_MODEL)fail('report_mismatch');
  if(db.prepare(`UPDATE analysis_verification_jobs SET state='done',report_id=?,lease_token=NULL,
    lease_until_ms=NULL,last_error=NULL WHERE id=? AND state='leased' AND lease_token=?`)
    .run(report.id,current.id,job.lease_token).changes!==1)fail('lease_lost');
}
module.exports={POLICY,admissionHash,enqueueVerificationJob,authorizeVerificationJob,claimNextVerificationJob,
  gateAdapterCall,settleVerificationJob,completeVerificationJobInTransaction};

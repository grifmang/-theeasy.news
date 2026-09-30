const {randomUUID}=require('crypto');
const {getClaimState}=require('./research-lifecycle');
const {getClaimContext}=require('./claim-context');
const {getSourceAccess}=require('./source-provenance');
const {isPaused,markClaimPauseBlocked,advanceClaimPauseBlockedForRetry}=require('./ops/work-admission');
function validId(value) {return Number.isSafeInteger(value) && value>0;}
const STAGE='passage-evaluation-v1',TASK_MS=300000,MAX_TIME=8640000000000000;
function clock(now) {if(!Number.isSafeInteger(now) || now<0||now>MAX_TIME) throw new Error('Invalid job clock');}
function reviewEvent(db,{jobId=null,kind,reason=kind,actorId=null,key,now}) {
  if(!Number.isSafeInteger(now)||now<0||now>MAX_TIME || typeof reason!=='string'||reason.length<1||reason.length>500||
    /[\x00-\x1f\x7f]/.test(reason))throw new Error('Invalid review event');
  db.prepare(`INSERT INTO claim_job_review_events(job_id,kind,reason,actor_id,dedup_key,occurred_at_ms)
    VALUES(?,?,?,?,?,?) ON CONFLICT(dedup_key) DO NOTHING`).run(jobId,kind,reason,actorId,key,now);
}
function eligibility(db,job) {
  const state=getClaimState(db,job.claim_id);
  if(state.restricted || state.status==='superseded') return 'claim_unavailable';
  if((getClaimContext(db,job.claim_id)?.id ?? null)!==job.context_version_id) return 'claim_context_changed';
  const source=db.prepare(`SELECT d.source_id FROM research_passages p JOIN research_documents d
    ON d.id=p.document_id WHERE p.id=?`).get(job.passage_id);
  if(!source) return 'unknown_passage';
  if(getSourceAccess(db,source.source_id).policy==='restricted') return 'source_restricted';
  return null;
}
// Internal scheduling only. Eligibility is not authorization for provider egress.
function enqueueClaimJob(db,{claimId,contextVersionId,passageId,stage=STAGE,model,questionVersion,policyVersion,maxAttempts=3,
  taskDeadlineAt=null,now=Date.now()}) {
  clock(now);
  const deadline=taskDeadlineAt===null?now+TASK_MS:taskDeadlineAt;
  if(!validId(claimId) || !validId(passageId) || (contextVersionId!==null && !validId(contextVersionId)) ||
    stage!==STAGE || model!=='jev-1.13.0' || questionVersion!=='passage-v1' || policyVersion!=='passage-shadow-v1' ||
    !Number.isInteger(maxAttempts) || maxAttempts<1 || maxAttempts>3 ||
    !Number.isSafeInteger(deadline)||deadline<=now||deadline>now+TASK_MS||deadline>MAX_TIME) throw new Error('Invalid claim job');
  return db.transaction(()=>{
    const reason=eligibility(db,{claim_id:claimId,context_version_id:contextVersionId,passage_id:passageId});
    if(reason) throw new Error(`Claim job unavailable: ${reason}`);
    db.prepare(`INSERT INTO claim_jobs(claim_id,context_version_id,passage_id,stage,model,question_version,policy_version,max_attempts,task_deadline_at,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(claimId,contextVersionId,passageId,stage,model,questionVersion,policyVersion,maxAttempts,deadline,now);
    return db.prepare(`SELECT * FROM claim_jobs WHERE claim_id=? AND context_version_id IS ? AND passage_id=?
      AND stage=? AND model=? AND question_version=? AND policy_version=?`).get(claimId,contextVersionId,passageId,stage,model,questionVersion,policyVersion);
  }).immediate();
}
function claimNextJob(db,{now=Date.now(),leaseMs=30000,authorizedOnly=false,recoverCompleted=false}={}) {
  clock(now);
  if(typeof authorizedOnly!=='boolean' || typeof recoverCompleted!=='boolean') throw new Error('Invalid authorization filter');
  if(!Number.isSafeInteger(leaseMs) || leaseMs<1 || leaseMs>300000 ||
    !Number.isSafeInteger(now+leaseMs)||now+leaseMs>MAX_TIME) throw new Error('Invalid lease duration');
  return db.transaction(()=>{
    if(isPaused(db))return null;
    const expired=db.prepare(`SELECT id,attempts FROM claim_jobs WHERE state IN ('queued','retry_wait','leased')
      AND (task_deadline_at IS NULL OR task_deadline_at<=?)`).all(now);
    db.prepare(`UPDATE claim_jobs SET state='exhausted',lease_token=NULL,lease_until=NULL,last_error='deadline_expired'
      WHERE state IN ('queued','retry_wait','leased') AND (task_deadline_at IS NULL OR task_deadline_at<=?)`).run(now);
    for(const row of expired)reviewEvent(db,{jobId:row.id,kind:'deadline_expired',
      key:`job:${row.id}:deadline`,now});
    const exhausted=db.prepare(`SELECT id,attempts FROM claim_jobs WHERE
      (state='leased' AND lease_until<=? OR state IN ('queued','retry_wait'))
      AND attempts>=MIN(max_attempts,3)`).all(now);
    db.prepare(`UPDATE claim_jobs SET state='exhausted',lease_token=NULL,lease_until=NULL,last_error='lease_expired'
      WHERE state='leased' AND lease_until<=? AND attempts>=MIN(max_attempts,3)`).run(now);
    db.prepare(`UPDATE claim_jobs SET state='exhausted',last_error='attempts_exhausted'
      WHERE state IN ('queued','retry_wait') AND attempts>=MIN(max_attempts,3)`).run();
    for(const row of exhausted)reviewEvent(db,{jobId:row.id,kind:'attempts_exhausted',
      key:`job:${row.id}:attempts:${row.attempts}`,now});
    if(db.prepare('SELECT paused_at FROM provider_queue_state WHERE id=1').get().paused_at)return null;
    const recoverable=recoverCompleted?db.prepare(`SELECT j.*,1 AS recovery_only FROM claim_jobs j
      WHERE j.state='exhausted' AND j.last_error='lease_expired' AND EXISTS (
        SELECT 1 FROM model_reservations r JOIN model_call_results s ON s.reservation_id=r.id
        WHERE r.request_key LIKE 'claim-job:'||j.id||':attempt:'||j.attempts||'%' AND s.status='succeeded'
      ) AND j.task_deadline_at>? AND
        (?=0 OR (SELECT allowed FROM provider_permission_events WHERE job_id=j.id ORDER BY id DESC LIMIT 1)=1)
      ORDER BY j.id LIMIT 100`).all(now,authorizedOnly?1:0):[];
    const candidates=[...recoverable,...db.prepare(`SELECT * FROM claim_jobs WHERE attempts<MIN(max_attempts,3) AND
      ((state IN ('queued','retry_wait') AND next_attempt<=?) OR (state='leased' AND lease_until<=?))
      AND task_deadline_at>?
      AND (?=0 OR (SELECT allowed FROM provider_permission_events WHERE job_id=claim_jobs.id ORDER BY id DESC LIMIT 1)=1)
      ORDER BY id LIMIT 100`).all(now,now,now,authorizedOnly?1:0)];
    for(const job of candidates) {
      const reason=eligibility(db,job);
      if(reason) {
        db.prepare(`UPDATE claim_jobs SET state='blocked',last_error=?,lease_token=NULL,lease_until=NULL,
          pause_blocked_at_ms=NULL,pause_blocked_version=NULL WHERE id=?`).run(reason,job.id);
        continue;
      }
      db.prepare("UPDATE claim_jobs SET state='leased',attempts=attempts+?,lease_token=?,lease_until=? WHERE id=?")
        .run(job.recovery_only?0:1,randomUUID(),job.task_deadline_at===null?now+leaseMs:Math.min(now+leaseMs,job.task_deadline_at),job.id);
      const claimed=db.prepare('SELECT * FROM claim_jobs WHERE id=?').get(job.id);
      return job.recovery_only?{...claimed,recovery_only:true}:claimed;
    }
    return null;
  }).immediate();
}
function renewClaimLease(db,job,{now=Date.now(),leaseMs=30000,guard=null}={}) {
  clock(now);
  if(!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>300000||
    !Number.isSafeInteger(now+leaseMs)||now+leaseMs>MAX_TIME)
    throw new Error('Invalid lease duration');
  if(guard&&!guard.check(db,()=>now))return false;
  return db.transaction(()=>{
    if(isPaused(db))return false;
    if(db.prepare('SELECT paused_at FROM provider_queue_state WHERE id=1').get().paused_at)return false;
    const current=db.prepare(`SELECT * FROM claim_jobs WHERE id=? AND state='leased'
      AND lease_token=? AND lease_until>? AND task_deadline_at>?`).get(job.id,job.lease_token,now,now);
    if(!current||eligibility(db,current))return false;
    const permission=require('./provider-permission').getProviderPermission(db,current.id);
    if(!permission.allowed)return false;
    const next=Math.min(now+leaseMs,current.task_deadline_at);
    if(next<=current.lease_until)return true;
    return db.prepare(`UPDATE claim_jobs SET lease_until=? WHERE id=? AND state='leased'
      AND lease_token=? AND lease_until=?`).run(next,current.id,job.lease_token,current.lease_until).changes===1;
  }).immediate();
}
function finishClaimJob(db,job,{now=Date.now(),error=null,retryAt=now,terminal=false}={}) {
  clock(now);clock(retryAt);
  if(retryAt<now || typeof terminal!=='boolean' || (terminal&&error===null) ||
    (error!==null && (typeof error!=='string' || !/^[a-z_]{1,64}$/.test(error)))) throw new Error('Invalid retry or error');
  return db.transaction(()=>{
    const current=db.prepare("SELECT * FROM claim_jobs WHERE id=? AND state='leased' AND lease_token=? AND lease_until>? AND task_deadline_at>?").get(job.id,job.lease_token,now,now);
    if(!current) return false;
    const reason=eligibility(db,current);
    const state=reason?'blocked':error===null?'done':terminal||current.attempts>=Math.min(current.max_attempts,3)||
      (current.task_deadline_at!==null&&retryAt>=current.task_deadline_at)?'exhausted':'retry_wait';
    db.prepare(`UPDATE claim_jobs SET state=?,last_error=?,next_attempt=?,
      retry_ready_at_ms=CASE WHEN ?='retry_wait' THEN ? ELSE retry_ready_at_ms END,
      lease_token=NULL,lease_until=NULL,
      dispatch_started_at_ms=CASE WHEN ?='retry_wait' THEN NULL ELSE dispatch_started_at_ms END,
      pause_blocked_at_ms=CASE WHEN ?='retry_wait' THEN pause_blocked_at_ms ELSE NULL END,
      pause_blocked_version=CASE WHEN ?='retry_wait' THEN pause_blocked_version ELSE NULL END
      WHERE id=?`).run(state,reason || error,retryAt,state,retryAt,state,state,state,current.id);
    if(state==='retry_wait') {
      advanceClaimPauseBlockedForRetry(db,current.id);
      markClaimPauseBlocked(db,current.id,now);
    }
    if(state==='exhausted') {
      const kind=error==='budget_exhausted'?'budget_exhausted':
        reason==='deadline_expired'||error==='deadline_expired'||
        (current.task_deadline_at!==null&&retryAt>=current.task_deadline_at)?'deadline_expired':'attempts_exhausted';
      reviewEvent(db,{jobId:current.id,kind,key:`job:${current.id}:${kind}:${current.attempts}`,now});
    }
    return !reason;
  }).immediate();
}
module.exports={STAGE,enqueueClaimJob,claimNextJob,finishClaimJob,renewClaimLease,reviewEvent,claimJobIneligibility:eligibility};

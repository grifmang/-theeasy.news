const {claimNextJob,finishClaimJob,reviewEvent}=require('./claim-jobs');
const {prepareClaimEvaluation,commitClaimDecision}=require('./claim-decision');
const {getProviderPermission}=require('./provider-permission');
const {runJevCall}=require('./models/jev-call');
const {hashPassageInput}=require('./models/jev');
const {isPaused,markClaimPauseBlocked,advanceClaimPauseBlockedForRetry}=require('./ops/work-admission');

// One bounded unit of work; importing this module starts no timers or network.
async function runNextClaimJob({db,client,limits,guard,clock=Date.now,signal}) {
  if(typeof client?.evaluate!=='function') throw new Error('Evaluation client required');
  if(signal?.aborted) return {status:'aborted'};
  if(isPaused(db)) return {status:'work_paused'};
  if(guard&&!guard.check())return {status:'budget_guard_tripped'};
  if(db.prepare('SELECT paused_at FROM provider_queue_state WHERE id=1').get().paused_at) {
    claimNextJob(db,{now:clock(),authorizedOnly:true,recoverCompleted:true});
    return {status:'provider_paused'};
  }
  const job=claimNextJob(db,{now:clock(),authorizedOnly:true,recoverCompleted:true});
  if(!job) return {status:'idle'};
  function park(reason,{defer=false,retryAt=null}={}) {
    const now=clock();
    if(['work_paused','permission_required','provider_configuration',
      'lease_lost','deadline_refreshed'].includes(reason)||
      (reason==='budget_guard_tripped'&&!defer)) {
      const blocked=['permission_required','provider_configuration'].includes(reason);
      const changed=db.transaction(()=>{
        const result=db.prepare(`UPDATE claim_jobs SET state=?,last_error=?,
        next_attempt=?,attempts=attempts-1,lease_token=NULL,lease_until=NULL,
        eligible_at_ms=CASE WHEN ? THEN NULL ELSE eligible_at_ms END,
        pause_blocked_at_ms=CASE WHEN ? THEN NULL ELSE pause_blocked_at_ms END,
        pause_blocked_version=CASE WHEN ? THEN NULL ELSE pause_blocked_version END
        WHERE id=? AND state='leased' AND lease_token=? AND attempts>0`)
        .run(blocked?'blocked':'retry_wait',reason,now,blocked?1:0,blocked?1:0,blocked?1:0,
          job.id,job.lease_token);
        if(result.changes&&!blocked)markClaimPauseBlocked(db,job.id,now);
        if(result.changes&&reason==='provider_configuration')
          reviewEvent(db,{jobId:job.id,kind:'provider_paused',reason,key:`job:${job.id}:provider_pause:${job.attempts}`,now});
        return result;
      }).immediate();
      return {status:changed.changes?reason:'stale',jobId:job.id};
    }
    const due=retryAt===null?Math.min(Number.MAX_SAFE_INTEGER,now+60000):retryAt;
    if(job.task_deadline_at===null||now>=job.task_deadline_at||
      (defer&&due>=job.task_deadline_at)) {
      const finished=finishClaimJob(db,job,{now,error:reason==='budget_exhausted'?'budget_exhausted':'deadline_expired',terminal:true});
      return {status:finished?'exhausted':'stale',jobId:job.id};
    }
    const changed=db.transaction(()=>{
      const result=db.prepare(`UPDATE claim_jobs SET state=?,last_error=?,next_attempt=?,
      retry_ready_at_ms=CASE WHEN ? THEN ? ELSE retry_ready_at_ms END,
      attempts=attempts-?,lease_token=NULL,lease_until=NULL,
      eligible_at_ms=CASE WHEN ? THEN eligible_at_ms ELSE NULL END,
      pause_blocked_at_ms=CASE WHEN ? THEN pause_blocked_at_ms ELSE NULL END,
      pause_blocked_version=CASE WHEN ? THEN pause_blocked_version ELSE NULL END
      WHERE id=? AND state='leased' AND lease_token=? AND lease_until>?`)
      .run(defer?'retry_wait':'blocked',reason,Math.min(job.task_deadline_at,Math.max(now,due)),
        defer?1:0,Math.min(job.task_deadline_at,Math.max(now,due)),defer?1:0,
        defer?1:0,defer?1:0,defer?1:0,job.id,job.lease_token,now);
      if(result.changes&&defer) {
        advanceClaimPauseBlockedForRetry(db,job.id);
        markClaimPauseBlocked(db,job.id,now);
      }
      if(result.changes&&['provider_auth','provider_configuration'].includes(reason))
        reviewEvent(db,{jobId:job.id,kind:'provider_paused',reason,key:`job:${job.id}:provider_pause:${job.attempts}`,now});
      return result;
    }).immediate();
    return {status:changed.changes?reason:'stale',jobId:job.id};
  }
  let decisionWriteStarted=false;
  try {
    if(isPaused(db))return park('work_paused');
    const input=prepareClaimEvaluation(db,job.id),inputHash=hashPassageInput(input);
    const permission=getProviderPermission(db,job.id);
    if(!permission.allowed || permission.inputHash!==inputHash) return park('permission_required');
    const prefix=`claim-job:${job.id}:attempt:`;
    const prior=db.prepare(`SELECT r.id AS reservation_id,r.request_key,s.status AS result_status,s.error_code,t.status AS settlement_status,
      m.observed_at_ms,m.retry_after_ms,u.attempt_number
      FROM model_reservations r LEFT JOIN model_call_results s ON s.reservation_id=r.id
      LEFT JOIN model_settlements t ON t.id=(SELECT MAX(id) FROM model_settlements WHERE reservation_id=r.id)
      LEFT JOIN model_call_failure_metadata m ON m.reservation_id=r.id
      LEFT JOIN model_call_usage_events u ON u.reservation_id=r.id
      WHERE r.request_key LIKE ? ORDER BY r.id DESC LIMIT 1`).get(`${prefix}%`);
    // Every retry gets a new durable key. Unresolved charges hold the job until reconciliation.
    const retryableRejection=prior?.result_status==='failed'&&
      ['provider_rate_limited','provider_overloaded'].includes(prior.error_code);
    if(retryableRejection&&Number.isSafeInteger(prior.observed_at_ms)&&
      Number.isInteger(prior.attempt_number)) {
      const backoff=Math.min(300000,1000*2**prior.attempt_number+
        ((job.id*7919+prior.attempt_number*104729)%1000));
      const due=prior.observed_at_ms+Math.max(backoff,prior.retry_after_ms??0);
      if(job.task_deadline_at!==null&&due>=job.task_deadline_at) {
        const finished=finishClaimJob(db,job,{now:clock(),error:'deadline_expired',terminal:true});
        return {status:finished?'exhausted':'stale',jobId:job.id};
      }
      if(clock()<due)return park('provider_backoff',{defer:true,retryAt:due});
    }
    const unresolved=prior&&!retryableRejection&&!['billed','not_billed'].includes(prior.settlement_status);
    if(job.dispatch_started_at_ms!==null&&prior?.result_status==='failed'&&
      ['billed','not_billed'].includes(prior.settlement_status))
      db.prepare(`UPDATE claim_jobs SET dispatch_started_at_ms=NULL WHERE id=? AND state='leased'
        AND lease_token=?`).run(job.id,job.lease_token);
    const requestKey=prior&&(prior.result_status==='succeeded'||unresolved)?prior.request_key:
      (['work_paused','budget_guard_tripped','permission_required','lease_lost','provider_paused'].includes(prior?.error_code)||
        (prior?.error_code==='deadline_expired'&&prior.settlement_status==='not_billed'))?
        `${prefix}${job.attempts}:after:${prior.reservation_id}`:
      `${prefix}${job.attempts}`;
    const preDispatch=({now})=>{
      if(db.prepare('SELECT paused_at FROM provider_queue_state WHERE id=1').get().paused_at)
        throw Object.assign(new Error('Provider queue paused'),{code:'provider_paused'});
      if(job.recovery_only)throw Object.assign(new Error('Recovery cannot issue a provider call'),{code:'lease_lost'});
      const live=db.prepare(`SELECT id FROM claim_jobs WHERE id=? AND state='leased' AND lease_token=?
        AND lease_until>? AND task_deadline_at>?`).get(job.id,job.lease_token,now,now);
      if(!live)throw Object.assign(new Error('Claim lease changed'),{code:'lease_lost'});
      const current=getProviderPermission(db,job.id);
      if(!current.allowed||current.inputHash!==inputHash)
        throw Object.assign(new Error('Transmission no longer authorized'),{code:'permission_required'});
      const marked=db.prepare(`UPDATE claim_jobs SET dispatch_started_at_ms=? WHERE id=? AND state='leased'
        AND lease_token=? AND dispatch_started_at_ms IS NULL`).run(now,job.id,job.lease_token);
      if(marked.changes!==1)throw Object.assign(new Error('Claim dispatch changed'),{code:'lease_lost'});
    };
    const call=await runJevCall(db,{requestKey,input,limits,guard,clock,signal,
      attemptNumber:job.attempts,retryIdentity:`claim-job:${job.id}`,taskDeadlineAt:job.task_deadline_at,
      preDispatch,
      onSucceeded:({reservationId,now})=>{
        decisionWriteStarted=true;
        const permission=getProviderPermission(db,job.id);
        if(!permission.allowed||permission.inputHash!==inputHash||
          !commitClaimDecision(db,job,reservationId,{now}))throw new Error('Claim decision fence changed');
      },onProviderPause:({errorCode,now})=>{
        const changed=db.prepare(`UPDATE claim_jobs SET state='blocked',last_error=?,
          lease_token=NULL,lease_until=NULL,eligible_at_ms=NULL,
          pause_blocked_at_ms=NULL,pause_blocked_version=NULL
          WHERE id=? AND state='leased' AND lease_token=? AND lease_until>?`)
          .run(errorCode,job.id,job.lease_token,now);
        if(changed.changes)reviewEvent(db,{jobId:job.id,kind:'provider_paused',reason:errorCode,
          key:`job:${job.id}:provider_pause:${job.attempts}`,now});
      }},client);
    if(call.status==='work_paused'||(call.status==='failed'&&call.errorCode==='work_paused'))
      return park('work_paused');
    if(call.status==='deadline_expired') {
      if(db.prepare('SELECT task_deadline_at FROM claim_jobs WHERE id=?').get(job.id)?.task_deadline_at>clock())
        return park('deadline_refreshed');
      const finished=finishClaimJob(db,job,{now:clock(),error:'deadline_expired',terminal:true});
      return {status:finished?'exhausted':'stale',jobId:job.id};
    }
    if(call.status==='budget_exhausted'||call.status==='budget_guard_tripped'||call.status==='concurrency_exhausted'||call.status==='price_unavailable'||
      call.status==='clock_rollback')
      return park(call.status,{defer:true});
    if(call.status==='pending_reconciliation') {
      const settlement=db.prepare(`SELECT status FROM model_settlements WHERE reservation_id=? ORDER BY id DESC LIMIT 1`).get(call.reservationId);
      if(!settlement||settlement.status==='unknown')return park('pending_reconciliation');
      const readyAt=clock(),resumed=finishClaimJob(db,job,{now:readyAt,error:'reconciled',retryAt:readyAt});
      return {status:resumed?'retry_recorded':'stale',jobId:job.id};
    }
    if(call.status==='failed') {
      if(!call.transportStarted&&call.errorCode==='deadline_expired'&&
        db.prepare('SELECT task_deadline_at FROM claim_jobs WHERE id=?').get(job.id)?.task_deadline_at>clock())
        return park('deadline_refreshed');
      if(!call.transportStarted) {
        if(call.errorCode==='provider_paused')return park('provider_configuration');
        if(['permission_required','lease_lost','budget_guard_tripped'].includes(call.errorCode))
          return park(call.errorCode);
      }
      const settlement=db.prepare(`SELECT status FROM model_settlements WHERE reservation_id=? ORDER BY id DESC LIMIT 1`).get(call.reservationId);
      const retryableRejection=['provider_rate_limited','provider_overloaded'].includes(call.errorCode);
      if(call.errorCode==='provider_auth'||call.errorCode==='provider_configuration')
        return {status:call.errorCode,jobId:job.id};
      if((!settlement||settlement.status==='unknown')&&!retryableRejection)return park('pending_reconciliation');
      const now=clock();
      if(call.errorCode==='aborted'||call.errorCode==='deadline_expired') {
        const finished=finishClaimJob(db,job,{now,error:call.errorCode,terminal:true});
        return {status:finished?'exhausted':'stale',jobId:job.id};
      }
      const backoff=Math.min(300000,1000*2**job.attempts+((job.id*7919+job.attempts*104729)%1000));
      const delay=Math.max(backoff,call.retryAfterMs??0);
      const retryAt=Math.min(Number.MAX_SAFE_INTEGER,now+delay,job.task_deadline_at??Number.MAX_SAFE_INTEGER);
      const finished=finishClaimJob(db,job,{now,error:call.errorCode,retryAt});
      return {status:finished?'retry_recorded':'stale',jobId:job.id};
    }
    if(call.status==='succeeded')return {status:'done',jobId:job.id};
    if(!getProviderPermission(db,job.id).allowed) return park('permission_required');
    decisionWriteStarted=true;
    return {status:commitClaimDecision(db,job,call.reservationId,{now:clock()})?'done':'stale',jobId:job.id};
  } catch {
    // A saved success remains eligible for exact-key replay after this lease expires.
    // A new success fault has already tripped the durable guard inside runJevCall.
    if(decisionWriteStarted)return {status:'decision_deferred',jobId:job.id};
    if(isPaused(db))return park('work_paused');
    const now=clock();
    const finished=finishClaimJob(db,job,{now,error:'evaluation_error',retryAt:now+60000});
    return {status:finished?'retry_recorded':'stale',jobId:job.id};
  }
}
module.exports={runNextClaimJob};

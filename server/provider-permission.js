const {prepareClaimEvaluation}=require('./claim-decision');
const {hashPassageInput}=require('./models/jev');
const {claimJobIneligibility}=require('./claim-jobs');
const {reviewEvent}=require('./claim-jobs');
const {markClaimPauseBlocked}=require('./ops/work-admission');
const {createHash}=require('crypto');
function getProviderPermission(db,jobId) {
  if(!Number.isSafeInteger(jobId) || jobId<1) throw new Error('Invalid job');
  return db.transaction(()=>{
    const job=db.prepare('SELECT * FROM claim_jobs WHERE id=?').get(jobId);
    if(!job) throw new Error('Unknown job');
    const inputHash=hashPassageInput(prepareClaimEvaluation(db,jobId));
    const event=db.prepare('SELECT * FROM provider_permission_events WHERE job_id=? ORDER BY id DESC LIMIT 1').get(jobId);
    const unavailable=claimJobIneligibility(db,job);
    const allowed=!unavailable && event?.allowed===1 && event.input_hash===inputHash;
    return {allowed,provider:'typesafe',inputHash,eventId:event?.id ?? null,
      reason:unavailable || (allowed?null:'permission_required')};
  }).deferred();
}
// HTTP boundary must enforce editor role and bind actorId from the session.
function setProviderPermission(db,{jobId,actorId,allowed,reason,expectedEventId,expectedInputHash,now=Date.now()}) {
  if(!Number.isSafeInteger(actorId) || actorId<1 || typeof allowed!=='boolean' ||
    !Number.isSafeInteger(now)||now<0||now>8640000000000000||
    typeof reason!=='string' || !reason.trim() || reason.length>8000 ||
    (expectedEventId!==null && (!Number.isSafeInteger(expectedEventId) || expectedEventId<1)) ||
    typeof expectedInputHash!=='string' || !/^[a-f0-9]{64}$/.test(expectedInputHash)) throw new Error('Invalid permission request');
  return db.transaction(()=>{
    if(!db.prepare('SELECT id FROM users WHERE id=?').get(actorId)) throw new Error('Unknown actor');
    const current=getProviderPermission(db,jobId);
    if(current.eventId!==expectedEventId || current.inputHash!==expectedInputHash) throw new Error('Provider permission or input changed');
    if(allowed && ![null,'permission_required'].includes(current.reason)) throw new Error('Claim job unavailable');
    const job=db.prepare('SELECT state,task_deadline_at,eligible_at_ms,attempts FROM claim_jobs WHERE id=?').get(jobId);
    if(allowed && job.task_deadline_at!==null && job.task_deadline_at<=now) {
      db.prepare(`UPDATE claim_jobs SET state='exhausted',last_error='deadline_expired',
        lease_token=NULL,lease_until=NULL,eligible_at_ms=NULL,pause_blocked_at_ms=NULL,
        pause_blocked_version=NULL WHERE id=? AND state IN ('queued','retry_wait','leased','blocked')`).run(jobId);
      reviewEvent(db,{jobId,kind:'deadline_expired',reason:'deadline_expired',actorId,
        key:`job:${jobId}:deadline`,now});
      return {...current,allowed:false,reason:'deadline_expired'};
    }
    if(allowed && !['queued','retry_wait','leased'].includes(job.state) &&
      !(job.state==='blocked' && current.reason==='permission_required'))
      throw new Error('Claim job unavailable');
    db.prepare("INSERT INTO provider_permission_events(job_id,actor_id,provider,input_hash,allowed,reason) VALUES(?,?,'typesafe',?,?,?)")
      .run(jobId,actorId,current.inputHash,allowed?1:0,reason);
    if(allowed) {
      db.prepare(`UPDATE claim_jobs SET state='queued',last_error=NULL,next_attempt=?,retry_ready_at_ms=?
        WHERE id=? AND state='blocked' AND last_error='permission_required'`).run(now,now,jobId);
      db.prepare('UPDATE claim_jobs SET eligible_at_ms=COALESCE(eligible_at_ms,?) WHERE id=?').run(now,jobId);
      markClaimPauseBlocked(db,jobId,now);
    } else db.prepare(`UPDATE claim_jobs SET eligible_at_ms=NULL,pause_blocked_at_ms=NULL,
      pause_blocked_version=NULL WHERE id=?`).run(jobId);
    return getProviderPermission(db,jobId);
  }).immediate();
}
function recoverProviderQueue(db,{actorId,reason,requestId,expectedPauseVersion,expectedPausedAt,
  expectedReason,afterJobId=0,now=Date.now(),maxJobs=100}) {
  if(!Number.isSafeInteger(actorId)||actorId<1||typeof reason!=='string'||!reason.trim()||
    reason.length>500||!/[\p{L}\p{N}]/u.test(reason)||
    !/^[\p{L}\p{N} .,;:!?()'_-]+$/u.test(reason)||
    /[\p{L}\p{N}_-]{65,}/u.test(reason)||/\b(?:bearer|api[_-]?key|secret|token)\s*[:=]/i.test(reason)||
    typeof requestId!=='string'||
    !/^[A-Za-z0-9_.:-]{1,100}$/.test(requestId)||!Number.isSafeInteger(expectedPauseVersion)||
    expectedPauseVersion<1||typeof expectedPausedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(expectedPausedAt)||
    !['provider_auth','provider_configuration'].includes(expectedReason)||!Number.isSafeInteger(now)||now<0||now>8640000000000000||
    !Number.isSafeInteger(afterJobId)||afterJobId<0||
    !Number.isInteger(maxJobs)||maxJobs<1||maxJobs>100)throw new Error('Invalid provider recovery');
  const hash=createHash('sha256').update(JSON.stringify([actorId,reason,expectedPauseVersion,
    expectedPausedAt,expectedReason,afterJobId,maxJobs])).digest('hex');
  const requestHash=createHash('sha256').update(requestId).digest('hex');
  return db.transaction(()=>{
    if(!db.prepare('SELECT id FROM users WHERE id=?').get(actorId))throw new Error('Unknown actor');
    const prior=db.prepare('SELECT * FROM provider_queue_recovery_events WHERE request_id=?').get(requestHash);
    if(prior) {
      if(prior.payload_hash!==hash)throw new Error('Provider recovery request conflicts');
      return {status:'already_recorded',recoveryId:prior.id,requeuedJobs:prior.requeued_jobs,
        skippedJobs:prior.skipped_jobs,nextAfterJobId:prior.next_after_job_id,
        completed:prior.completed===1};
    }
    const current=db.prepare('SELECT * FROM provider_queue_state WHERE id=1').get();
    if(current.pause_version!==expectedPauseVersion||current.paused_at!==expectedPausedAt||
      current.reason!==expectedReason)throw new Error('Provider pause changed');
    if(afterJobId>0&&!db.prepare(`SELECT 1 FROM provider_queue_recovery_events
      WHERE expected_pause_version=? AND next_after_job_id=? AND completed=0`)
      .get(expectedPauseVersion,afterJobId))throw new Error('Provider recovery continuation conflicts');
    const blocked=db.prepare(`SELECT * FROM claim_jobs INDEXED BY claim_jobs_provider_recovery WHERE state='blocked'
      AND last_error IN ('provider_auth','provider_configuration') AND id>?
      ORDER BY id LIMIT ?`).all(afterJobId,maxJobs+1);
    const batch=blocked.slice(0,maxJobs),completed=blocked.length<=maxJobs;
    let requeued=0,skipped=0;
    for(const job of batch) {
      const terminal=job.task_deadline_at===null||job.task_deadline_at<=now?'deadline_expired':
        job.attempts>=Math.min(job.max_attempts,3)?'attempts_exhausted':null;
      if(terminal) {
        db.prepare(`UPDATE claim_jobs SET state='exhausted',last_error=?,lease_token=NULL,
          lease_until=NULL WHERE id=? AND state='blocked'`).run(terminal,job.id);
        reviewEvent(db,{jobId:job.id,kind:terminal,reason:terminal,actorId,
          key:`job:${job.id}:${terminal}:${job.attempts}`,now});
        skipped++;
        continue;
      }
      const unavailable=claimJobIneligibility(db,job);
      if(unavailable) {
        db.prepare("UPDATE claim_jobs SET last_error=? WHERE id=? AND state='blocked'").run(unavailable,job.id);
        reviewEvent(db,{jobId:job.id,kind:'job_skipped',reason:unavailable,actorId,
          key:`provider_recovery:${requestHash}:skip:${job.id}`,now});
        skipped++;
        continue;
      }
      const permission=getProviderPermission(db,job.id);
      if(!permission.allowed) {
        db.prepare("UPDATE claim_jobs SET last_error='permission_required' WHERE id=? AND state='blocked'")
          .run(job.id);
        reviewEvent(db,{jobId:job.id,kind:'job_skipped',reason:'permission_required',actorId,
          key:`provider_recovery:${requestHash}:skip:${job.id}`,now});
        skipped++;
        continue;
      }
      const latest=db.prepare(`SELECT t.status FROM model_reservations r
        LEFT JOIN model_settlements t ON t.id=(SELECT MAX(id) FROM model_settlements WHERE reservation_id=r.id)
        WHERE r.request_key LIKE ? ORDER BY r.id DESC LIMIT 1`)
        .get(`claim-job:${job.id}:attempt:${job.attempts}%`);
      if(latest&&!['billed','not_billed'].includes(latest.status))
        throw new Error('Provider recovery requires charge reconciliation');
      db.prepare(`UPDATE claim_jobs SET state='queued',last_error=NULL,next_attempt=?,
        retry_ready_at_ms=?,eligible_at_ms=?,lease_token=NULL,lease_until=NULL
        WHERE id=? AND state='blocked'`).run(now,now,now,job.id);
      markClaimPauseBlocked(db,job.id,now);
      reviewEvent(db,{jobId:job.id,kind:'job_requeued',reason,actorId,
        key:`provider_recovery:${requestHash}:job:${job.id}`,now});
      requeued++;
    }
    if(completed) {
      const changed=db.prepare(`UPDATE provider_queue_state SET paused_at=NULL,reason=NULL,
        pause_version=pause_version+1 WHERE id=1 AND pause_version=? AND paused_at=? AND reason=?`)
        .run(expectedPauseVersion,expectedPausedAt,expectedReason);
      if(changed.changes!==1)throw new Error('Provider pause changed');
    }
    const nextAfterJobId=completed?null:batch[batch.length-1].id;
    const event=db.prepare(`INSERT INTO provider_queue_recovery_events
      (request_id,payload_hash,actor_id,expected_pause_version,reason,recovered_at_ms,requeued_jobs,
        skipped_jobs,after_job_id,next_after_job_id,completed)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(requestHash,hash,actorId,expectedPauseVersion,reason,now,
        requeued,skipped,afterJobId,nextAfterJobId,completed?1:0);
    reviewEvent(db,{kind:completed?'provider_recovered':'provider_recovery_batch',reason,actorId,
      key:`provider_recovery:${requestHash}`,now});
    return {status:completed?'recorded':'partial',recoveryId:Number(event.lastInsertRowid),
      requeuedJobs:requeued,skippedJobs:skipped,nextAfterJobId,completed};
  }).immediate();
}
module.exports={getProviderPermission,setProviderPermission,recoverProviderQueue};

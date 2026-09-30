const {createHash}=require('crypto');

const hash=value=>createHash('sha256').update(value).digest('hex');
function isPaused(db) {
  const row=db.prepare('SELECT state FROM work_admission_state WHERE id=1').get();
  if(!row) throw new Error('Work admission state unavailable');
  return row.state==='paused';
}
// Call inside the caller's immediate transaction when a job becomes dispatchable
// during a pause. Pure pause-only parking must not move an existing baseline.
function markClaimPauseBlocked(db,jobId,now) {
  const pause=db.prepare('SELECT state,version,changed_at_ms FROM work_admission_state WHERE id=1').get();
  if(pause?.state!=='paused')return false;
  const baseline=`MAX(?,?,eligible_at_ms,CASE WHEN state='retry_wait' THEN retry_ready_at_ms ELSE 0 END)`;
  return db.prepare(`UPDATE claim_jobs SET pause_blocked_at_ms=${baseline},pause_blocked_version=?
    WHERE id=? AND state IN ('queued','retry_wait','leased') AND dispatch_started_at_ms IS NULL
      AND pause_blocked_at_ms IS NULL AND eligible_at_ms IS NOT NULL
      AND task_deadline_at>${baseline}
      AND (SELECT allowed FROM provider_permission_events WHERE job_id=claim_jobs.id
        ORDER BY id DESC LIMIT 1)=1`)
    .run(now,pause.changed_at_ms,pause.version,jobId,now,pause.changed_at_ms).changes===1;
}
// A genuine retry/backoff suspends dispatch eligibility independently of the
// global pause. Move only this pause version's existing baseline to the true
// retry-ready time; a ready time beyond resume yields no pause credit.
function advanceClaimPauseBlockedForRetry(db,jobId) {
  return db.prepare(`UPDATE claim_jobs SET pause_blocked_at_ms=MAX(pause_blocked_at_ms,retry_ready_at_ms)
    WHERE id=? AND state='retry_wait' AND pause_blocked_at_ms IS NOT NULL
      AND pause_blocked_version=(SELECT version FROM work_admission_state
        WHERE id=1 AND state='paused')`).run(jobId).changes===1;
}
function changeWorkAdmission(db,{actorId,action,expectedVersion,reason,requestId,now=Date.now()}) {
  if(!Number.isSafeInteger(actorId)||actorId<1||!['pause','resume'].includes(action)||
    !Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion>=Number.MAX_SAFE_INTEGER||
    typeof reason!=='string'||!reason.trim()||reason.length>500||/[\x00-\x1f\x7f]/.test(reason)||
    typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)||
    !Number.isSafeInteger(now)||now<0||now>8640000000000000) throw new Error('Invalid work admission request');
  const requestIdHash=hash(requestId);
  const payloadHash=hash(JSON.stringify([actorId,action,expectedVersion,reason]));
  return db.transaction(()=>{
    if(db.prepare("SELECT role FROM user_roles WHERE user_id=?").get(actorId)?.role!=='editor')
      throw new Error('Editor authority required');
    const prior=db.prepare('SELECT * FROM work_admission_events WHERE request_id_hash=?').get(requestIdHash);
    if(prior) {
      if(prior.payload_hash!==payloadHash) throw new Error('Work admission request conflict');
      return {status:'already_recorded',state:prior.after_state,version:prior.after_version,
        changedAt:prior.occurred_at_ms};
    }
    const current=db.prepare('SELECT state,version,changed_at_ms FROM work_admission_state WHERE id=1').get();
    if(!current||current.version!==expectedVersion||current.state===(action==='pause'?'paused':'running'))
      throw new Error('Work admission state changed');
    if(now<current.changed_at_ms) throw new Error('Work admission clock changed');
    const after=action==='pause'?'paused':'running';
    if(action==='pause') {
      const baseline=`MAX(?,eligible_at_ms,CASE WHEN state='retry_wait' THEN retry_ready_at_ms ELSE 0 END)`;
      db.prepare(`UPDATE claim_jobs SET pause_blocked_at_ms=${baseline},pause_blocked_version=?
        WHERE state IN ('queued','retry_wait','leased') AND dispatch_started_at_ms IS NULL
          AND pause_blocked_at_ms IS NULL AND eligible_at_ms IS NOT NULL
          AND task_deadline_at>${baseline}
          AND (SELECT allowed FROM provider_permission_events WHERE job_id=claim_jobs.id
            ORDER BY id DESC LIMIT 1)=1`).run(now,current.version+1,now);
    } else {
      db.prepare(`UPDATE claim_jobs SET
        task_deadline_at=CASE WHEN pause_blocked_at_ms<? AND task_deadline_at>pause_blocked_at_ms
          THEN MIN(8640000000000000,task_deadline_at+(?-pause_blocked_at_ms))
          ELSE task_deadline_at END,
        pause_credit_version=?,pause_blocked_at_ms=NULL,pause_blocked_version=NULL
        WHERE pause_blocked_version=? AND pause_blocked_at_ms IS NOT NULL`)
        .run(now,now,current.version+1,current.version);
    }
    db.prepare(`INSERT INTO work_admission_events(request_id_hash,payload_hash,actor_id,action,reason,
      before_state,after_state,before_version,after_version,occurred_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(requestIdHash,payloadHash,actorId,action,reason,current.state,after,current.version,current.version+1,now);
    const updated=db.prepare('UPDATE work_admission_state SET state=?,version=version+1,changed_at_ms=? WHERE id=1 AND state=? AND version=?')
      .run(after,now,current.state,expectedVersion);
    if(updated.changes!==1) throw new Error('Work admission state changed');
    return {status:'recorded',state:after,version:current.version+1,changedAt:now};
  }).immediate();
}
function countUpTo(db,sql,now) {
  return db.prepare(`SELECT COUNT(*) AS n FROM (${sql} LIMIT 1001)`).get(now).n;
}
function workAdmissionStatus(db,{now=Date.now(),guard=null}={}) {
  if(!Number.isSafeInteger(now)||now<0||now>8640000000000000) throw new Error('Invalid status clock');
  const current=db.prepare('SELECT state,version,changed_at_ms FROM work_admission_state WHERE id=1').get();
  if(!current) throw new Error('Work admission state unavailable');
  const claimLeases=countUpTo(db,"SELECT 1 FROM claim_jobs WHERE state='leased' AND lease_until>?",now);
  const fetchLeases=countUpTo(db,"SELECT 1 FROM fetch_jobs WHERE state='leased' AND lease_until>?",now);
  const rebuildLeases=countUpTo(db,"SELECT 1 FROM rebuild_jobs WHERE state='leased' AND lease_until>?",now);
  const analysisLeases=countUpTo(db,"SELECT 1 FROM analysis_verification_jobs WHERE state='leased' AND lease_until_ms>?",now);
  const claimBacklog=countUpTo(db,"SELECT 1 FROM claim_jobs WHERE state IN ('queued','retry_wait') AND task_deadline_at>?",now);
  const fetchBacklog=countUpTo(db,"SELECT 1 FROM fetch_jobs WHERE state IN ('queued','retry_wait') AND next_attempt<=?",now);
  const rebuildBacklog=countUpTo(db,"SELECT 1 FROM rebuild_jobs WHERE state IN ('queued','retry_wait') AND next_attempt<=?",now);
  const analysisBacklog=countUpTo(db,"SELECT 1 FROM analysis_verification_jobs WHERE state IN ('queued','retry_wait') AND retry_ready_at_ms<=?1 AND task_deadline_at_ms>?1",now);
  const providerPaused=Boolean(db.prepare('SELECT paused_at FROM provider_queue_state WHERE id=1').get()?.paused_at);
  const unresolved=Boolean(db.prepare(`SELECT 1 FROM model_budget_counters WHERE scope='all' AND category=''
    AND period_kind IN ('unknown','late_hold') AND period_key='' AND amount_micros>0 LIMIT 1`).get());
  const guardTripped=guard?guard.peek(db,()=>now).tripped:false;
  const alerts=[];
  if(claimBacklog>1000||fetchBacklog>1000||rebuildBacklog>1000||analysisBacklog>1000)
    alerts.push({kind:'queue_backlog',severity:'warning'});
  if(providerPaused) alerts.push({kind:'provider_paused',severity:'warning'});
  if(guardTripped) alerts.push({kind:'budget_guard_tripped',severity:'warning'});
  if(unresolved) alerts.push({kind:'budget_unresolved',severity:'warning'});
  alerts.push({kind:'backup_age_unknown',severity:'warning'});
  return {state:current.state,version:current.version,changedAt:current.changed_at_ms,
    draining:current.state==='paused'&&(claimLeases+fetchLeases+rebuildLeases+analysisLeases)>0,
    activeLeases:{claim:claimLeases,fetch:fetchLeases,rebuild:rebuildLeases,
      analysisVerification:analysisLeases,
      capped:claimLeases>1000||fetchLeases>1000||rebuildLeases>1000||analysisLeases>1000},
    backlog:{claim:claimBacklog,fetch:fetchBacklog,rebuild:rebuildBacklog,
      analysisVerification:analysisBacklog,
      capped:claimBacklog>1000||fetchBacklog>1000||rebuildBacklog>1000||analysisBacklog>1000},
    alerts:alerts.slice(0,5),backupAge:{status:'unknown'}};
}
module.exports={isPaused,markClaimPauseBlocked,advanceClaimPauseBlockedForRetry,
  changeWorkAdmission,workAdmissionStatus};

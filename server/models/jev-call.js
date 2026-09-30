const {randomUUID}=require('crypto');
const {buildPassageRequest,evaluatePassage,hashPassageInput}=require('./jev');
const {reserveModelCost,estimateCost}=require('./prices');
const {settleCost}=require('./budget');
const ops=require('./budget-ops');
const {isPaused}=require('../ops/work-admission');

const TRANSPORT_MS=10000;
const CLEANUP_GRACE_MS=3000;
function at(ms) {if(!Number.isSafeInteger(ms)||ms<0)throw new Error('Invalid call deadline');return new Date(ms).toISOString();}

// One attempt only. A durable request key never grants a second transport.
async function runJevCall(db,{requestKey,input,limits,guard,signal,clock=Date.now,attemptNumber=1,
  retryIdentity=requestKey,taskDeadlineAt=null,onSucceeded=null,onProviderPause=null,preDispatch=null},client) {
  const request=buildPassageRequest(input);
  if(typeof client?.evaluate!=='function'||typeof clock!=='function'||!guard||typeof guard.check!=='function'||
    (onSucceeded!==null&&typeof onSucceeded!=='function')||
    (onProviderPause!==null&&typeof onProviderPause!=='function')||
    (preDispatch!==null&&typeof preDispatch!=='function'))
    throw Object.assign(new Error('Invalid call boundary'),{code:'invalid_request'});
  if(isPaused(db))return {status:'work_paused'};
  if(!guard.check(db,clock))return {status:'budget_guard_tripped'};
  if(signal?.aborted)throw Object.assign(new Error('Call aborted'),{code:'aborted'});
  ops.integer(attemptNumber);if(attemptNumber<1||attemptNumber>3)throw new Error('Invalid attempt number');
  if(taskDeadlineAt!==null&&(!Number.isSafeInteger(taskDeadlineAt)||taskDeadlineAt<0))
    throw Object.assign(new Error('Invalid task deadline'),{code:'invalid_request'});
  if(taskDeadlineAt!==null&&taskDeadlineAt<=clock())return {status:'deadline_expired'};
  ops.identifier(retryIdentity);
  const snapshot={...request.state,model:request.model,questionVersion:input.questionVersion};
  const inputHash=hashPassageInput(snapshot);
  let admission,admissionAt;
  try {
    admission=db.transaction(()=>{
      const existing=db.prepare(`SELECT r.id,a.input_hash FROM model_reservations r
        LEFT JOIN model_call_attempts a ON a.reservation_id=r.id WHERE r.request_key=?`).get(requestKey);
      if(existing) {
        if(existing.input_hash!==inputHash)throw new Error('Request input changed or key already used');
        const saved=db.prepare('SELECT * FROM model_call_results WHERE reservation_id=?').get(existing.id);
        if(!saved)return {status:'pending_reconciliation',reservationId:existing.id};
        if(saved.status==='succeeded')return {status:'cached',reservationId:existing.id,result:JSON.parse(saved.result_json)};
        const metadata=db.prepare('SELECT observed_at_ms,provider_status,retry_after_ms,provider_request_id FROM model_call_failure_metadata WHERE reservation_id=?').get(existing.id);
        return {status:'failed',reservationId:existing.id,errorCode:saved.error_code,
          providerStatus:metadata?.provider_status??null,retryAfterMs:metadata?.retry_after_ms??null,
          requestId:metadata?.provider_request_id??null,observedAtMs:metadata?.observed_at_ms??null};
      }
      if(isPaused(db))return {status:'work_paused'};
      if(!guard.check(db,clock))return {status:'budget_guard_tripped'};
      admissionAt=ops.lockedNow(clock);
      if(!ops.advanceClock(db,admissionAt))return {status:'clock_rollback'};
      const policy=ops.effectivePolicy(db,limits,admissionAt);
      if(policy.effective.maxInputTokens<64000||policy.effective.maxOutputTokens<1)
        return {status:'budget_exhausted',reason:'token_cap'};
      if(ops.activeSlots(db,admissionAt)>=policy.effective.maxConcurrentCalls) {
        ops.alert(db,{kind:'concurrency_exhausted',category:'classification',now:admissionAt});
        return {status:'concurrency_exhausted'};
      }
      // No tokenizer: reserve the full 64k input ceiling. Output is post-response capped.
      const reserved=reserveModelCost(db,{requestKey,category:'classification',model:snapshot.model,
        inputTokens:64000,outputTokens:policy.effective.maxOutputTokens,now:admissionAt,guard},limits);
      if(reserved.status!=='reserved')return reserved;
      const startMs=Date.parse(admissionAt),deadlineAt=at(taskDeadlineAt===null?startMs+TRANSPORT_MS:
        Math.min(startMs+TRANSPORT_MS,taskDeadlineAt)),
        leaseUntil=at(startMs+TRANSPORT_MS+CLEANUP_GRACE_MS),slotToken=randomUUID();
      if(!ops.startSlot(db,{reservationId:reserved.reservation.id,now:admissionAt,deadlineAt,leaseUntil,slotToken},
        policy.effective.maxConcurrentCalls))throw new Error('Slot changed inside admission transaction');
      db.prepare('INSERT INTO model_call_attempts(reservation_id,input_hash,model,question_version) VALUES(?,?,?,?)')
        .run(reserved.reservation.id,inputHash,snapshot.model,snapshot.questionVersion);
      return {status:'reserved',reservationId:reserved.reservation.id,policyVersion:reserved.policy.version,
        priceVersion:reserved.reservation.price_version,maxOutputTokens:policy.effective.maxOutputTokens,
        slotToken,deadlineAt,leaseUntil};
    }).immediate();
  } catch(error) {
    if(/price|billing|cost|token/i.test(error.message)) {
      ops.alert(db,{kind:'unknown_price',category:'classification',now:admissionAt||ops.lockedNow(clock)});
      return {status:'price_unavailable'};
    }
    throw error;
  }
  if(admission.status!=='reserved')return admission;
  const {reservationId}=admission;
  let result=null,actual=null,errorCode=null,providerStatus=null,retryAfterMs=null,requestId=null,
    dispatched=false,cancellationConfirmed=true,armedName=null;
  function recordAuditFault() {
    try {guard.trip(armedName);}catch {console.error(JSON.stringify({event:'budget_guard_fatal',reservationId}));}
    try {db.transaction(()=>{
      const now=new Date().toISOString();
      db.prepare("INSERT INTO model_budget_integrity_fault_events(reservation_id,kind,occurred_at) VALUES(?,'late_hold_failure',?)")
        .run(reservationId,now);
      ops.alert(db,{kind:'late_hold_failure',category:'classification',reservationId,now});
    }).immediate();}catch(faultError){console.error(JSON.stringify({event:'budget_late_audit_failed',reservationId,
      code:faultError.code||'storage_unavailable'}));}
  }
  function recordLateTransport(outcome,raw) {
    if(!db.open){recordAuditFault();return;}
    const usage=raw?.body?.usage;
    const inputTokens=Number.isSafeInteger(usage?.input_tokens)&&usage.input_tokens>=0?usage.input_tokens:null;
    const outputTokens=Number.isSafeInteger(usage?.output_tokens)&&usage.output_tokens>=0?usage.output_tokens:null;
    try {db.transaction(()=>{
      const observedAt=ops.lockedNow(clock);
      const watermark=db.prepare('SELECT last_at FROM model_budget_clock WHERE id=1').get().last_at;
      ops.recordLateUsage(db,{reservationId,slotToken:admission.slotToken,outcome,inputTokens,outputTokens,
        now:observedAt>watermark?observedAt:watermark});
    }).immediate();guard.disarm(armedName);}catch(error){recordAuditFault();}
  }
  const checkedClient={evaluate:(request,options)=>{
    let transport,invocationError;
    // SQLite serializes this short synchronous send fence with an operator pause.
    // Keep only adapter invocation under the lock; the returned promise is awaited later.
    db.transaction(()=>{
      if(isPaused(db))throw Object.assign(new Error('Work admission paused'),{code:'work_paused'});
      if(!guard.check(db,clock))throw Object.assign(new Error('Budget guard tripped'),{code:'budget_guard_tripped'});
      if(preDispatch)preDispatch({now:clock()});
      dispatched=true;
      try {transport=client.evaluate(request,options);} catch(error) {invocationError=error;}
    }).immediate();
    if(invocationError)throw invocationError;
    return transport;
  }};
  try {
    armedName=guard.arm(reservationId,admission.slotToken);
    result=await evaluatePassage(snapshot,checkedClient,{signal,maxOutputTokens:admission.maxOutputTokens,
      deadlineAt:Date.parse(admission.deadlineAt),clock,cleanupGraceMs:CLEANUP_GRACE_MS,
      onLateTransport:recordLateTransport});
    actual=estimateCost({model:result.model,inputTokens:result.usage.input_tokens,
      outputTokens:result.usage.output_tokens,now:admissionAt});
    if(actual.priceVersion!==admission.priceVersion)errorCode='stale_usage';
  } catch(error) {
    errorCode=['aborted','timeout','work_paused','budget_guard_tripped','permission_required','lease_lost',
      'provider_paused','invalid_response','provider_error','provider_auth','provider_configuration',
      'provider_rate_limited','provider_overloaded','stale_usage','deadline_expired'].includes(error.code)?
      error.code:'evaluation_failed';
    if(dispatched&&['work_paused','budget_guard_tripped','permission_required','lease_lost','provider_paused'].includes(errorCode))
      errorCode='evaluation_failed';
    providerStatus=Number.isInteger(error.status)&&error.status>=100&&error.status<=599?error.status:null;
    retryAfterMs=Number.isSafeInteger(error.retryAfterMs)&&error.retryAfterMs>=0&&error.retryAfterMs<=300000?
      error.retryAfterMs:null;
    requestId=typeof error.requestId==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(error.requestId)?error.requestId:null;
    if(dispatched&&(errorCode==='aborted'||errorCode==='timeout')&&error.transportSettled===false)
      cancellationConfirmed=false;
  }
  const completedAt=ops.lockedNow(clock);
  try {const completed=db.transaction(()=>{
    const slot=db.prepare("SELECT * FROM model_call_slot_events WHERE reservation_id=? AND action='start'").get(reservationId);
    const recovered=Boolean(db.prepare('SELECT 1 FROM model_call_recovery_events WHERE reservation_id=?').get(reservationId));
    const closed=Boolean(db.prepare("SELECT 1 FROM model_call_slot_events WHERE reservation_id=? AND action='finish'").get(reservationId));
    if(slot?.slot_token!==admission.slotToken)throw new Error('Attempt fence mismatch');
    const clockValid=ops.advanceClock(db,completedAt);
    const eventAt=clockValid?completedAt:db.prepare('SELECT last_at FROM model_budget_clock WHERE id=1').get().last_at;
    const expired=completedAt>=admission.deadlineAt||!clockValid;
    const outcome=result?'succeeded':'failed';
    if(recovered||closed) {
      // An unsettled transport may still report usage; leave the one late-event key for that callback.
      if(cancellationConfirmed||result)ops.recordLateUsage(db,{reservationId,slotToken:admission.slotToken,outcome,
        inputTokens:result?.usage.input_tokens??null,outputTokens:result?.usage.output_tokens??null,now:eventAt});
      return {status:'pending_reconciliation',reservationId};
    }
    if(result&&expired) {
      ops.recordLateUsage(db,{reservationId,slotToken:admission.slotToken,outcome:'succeeded',
        inputTokens:result.usage.input_tokens,outputTokens:result.usage.output_tokens,now:eventAt});
      errorCode=clockValid?'deadline_expired':'clock_rollback';
    }
    const success=Boolean(result&&!errorCode&&!expired);
    // Any dispatched request without validated usage keeps its full reservation
    // as an unknown charge, including explicit HTTP rejections.
    const unbilled=!dispatched;
    settleCost(db,{reservationId,status:success?'billed':unbilled?'not_billed':'unknown',
      actualMicros:success?actual.maxMicros:unbilled?0:null,now:eventAt});
    db.prepare(`INSERT INTO model_call_usage_events(reservation_id,reported_input_tokens,reported_output_tokens,
      attempt_number,retry_identity,policy_version,price_version,status) VALUES(?,?,?,?,?,?,?,?)`)
      .run(reservationId,result?.usage.input_tokens??null,result?.usage.output_tokens??null,
        attemptNumber,retryIdentity,admission.policyVersion,admission.priceVersion,
        success?'valid':result?'invalid':'unknown');
    if(errorCode==='invalid_response'||errorCode==='stale_usage'||expired)
      ops.alert(db,{kind:expired?'stale_usage':errorCode==='invalid_response'?'invalid_usage':'stale_usage',
        category:'classification',reservationId,now:eventAt});
    db.prepare(`INSERT INTO model_call_results(reservation_id,status,result_json,error_code)
      VALUES(?,?,?,?)`).run(reservationId,success?'succeeded':'failed',success?JSON.stringify(result):null,
      success?null:errorCode||'evaluation_failed');
    if(!success&&(providerStatus!==null||retryAfterMs!==null||requestId!==null))
      db.prepare(`INSERT INTO model_call_failure_metadata(reservation_id,observed_at_ms,provider_status,retry_after_ms,provider_request_id)
        VALUES(?,?,?,?,?)`).run(reservationId,Date.parse(eventAt),providerStatus,retryAfterMs,requestId);
    if(!success&&['provider_auth','provider_configuration'].includes(errorCode))
      db.prepare(`UPDATE provider_queue_state SET paused_at=COALESCE(paused_at,?),
        reason=COALESCE(reason,?),pause_version=pause_version+1 WHERE id=1`)
        .run(eventAt,errorCode);
    if(!success&&['provider_auth','provider_configuration'].includes(errorCode)&&onProviderPause)
      onProviderPause({reservationId,errorCode,now:Date.parse(eventAt)});
    if(cancellationConfirmed)ops.finishSlot(db,{reservationId,now:eventAt,slotToken:admission.slotToken});
    if(success&&onSucceeded)onSucceeded({reservationId,result,now:Date.parse(eventAt)});
    return success?{status:'succeeded',reservationId,result}:{status:'failed',reservationId,
      errorCode:errorCode||'evaluation_failed',providerStatus,retryAfterMs,requestId,
      observedAtMs:Date.parse(eventAt),transportStarted:dispatched};
  }).immediate();
    guard.disarm(armedName);
    return completed;
  }catch(error){recordAuditFault();throw error;}
}
module.exports={runJevCall};

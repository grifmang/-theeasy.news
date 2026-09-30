const {createHash}=require('crypto');
function integer(value) {if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid nonnegative integer');return value;}
function identifier(value,max=200) {if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw new Error('Invalid identifier');return value;}
function utc(value) {if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error('Invalid UTC timestamp');return value;}
function lockedNow(clock) {
  if(typeof clock!=='function')throw new Error('Invalid budget clock');
  const value=clock();
  if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid budget clock');
  return new Date(value).toISOString();
}
function advanceClock(db,now) {
  utc(now);
  const last=db.prepare('SELECT last_at FROM model_budget_clock WHERE id=1').get().last_at;
  if(now<last) {alert(db,{kind:'clock_rollback',now,period:last.slice(0,10)});return false;}
  if(now>last)db.prepare('UPDATE model_budget_clock SET last_at=? WHERE id=1').run(now);
  return true;
}
function categoryLimits(value) {
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>32)throw new Error('Invalid category limits');
  const result={};
  for(const key of Object.keys(value).sort()) {if(!/^[a-z][a-z0-9_-]{0,63}$/.test(key))throw new Error('Invalid category');result[key]=integer(value[key]);}
  return result;
}
function hardLimits(limits) {
  if(!limits||typeof limits!=='object')throw new Error('Invalid budget limits');
  const hard={dailyMicros:integer(limits.dailyMicros),monthlyMicros:integer(limits.monthlyMicros),
    categoryDailyMicros:categoryLimits(limits.categoryDailyMicros),categoryMonthlyMicros:categoryLimits(limits.categoryMonthlyMicros),
    maxConcurrentCalls:integer(limits.maxConcurrentCalls??1),maxInputTokens:integer(limits.maxInputTokens??64000),
    maxOutputTokens:integer(limits.maxOutputTokens??4096),reasoningMicros:integer(limits.reasoningMicros??0),toolMicros:integer(limits.toolMicros??0)};
  if(hard.dailyMicros>hard.monthlyMicros)throw new Error('Invalid budget limits');return hard;
}
function effectivePolicy(db,limits,now) {
  utc(now);const hard=hardLimits(limits);
  const row=db.prepare('SELECT * FROM model_budget_policy_events ORDER BY id DESC LIMIT 1').get();
  const proposed=row?{dailyMicros:row.daily_micros,monthlyMicros:row.monthly_micros,
    categoryDailyMicros:JSON.parse(row.category_daily_json),categoryMonthlyMicros:JSON.parse(row.category_monthly_json),
    maxConcurrentCalls:row.max_concurrent_calls,maxInputTokens:row.max_input_tokens,maxOutputTokens:row.max_output_tokens,
    reasoningMicros:row.reasoning_micros,toolMicros:row.tool_micros}:hard;
  const effective={};
  for(const key of ['dailyMicros','monthlyMicros','maxConcurrentCalls','maxInputTokens','maxOutputTokens','reasoningMicros','toolMicros'])
    effective[key]=Math.min(integer(proposed[key]),hard[key]);
  for(const [field,global] of [['categoryDailyMicros','dailyMicros'],['categoryMonthlyMicros','monthlyMicros']]) {
    effective[field]={};
    for(const key of new Set([...Object.keys(hard[field]),...Object.keys(proposed[field])]))
      effective[field][key]=Math.min(proposed[field][key]??effective[global],hard[field][key]??hard[global],effective[global]);
  }
  return {version:row?.id??0,effectiveAt:row?.effective_at??null,hard,effective};
}
function appendPolicy(db,{actorId,requestId,reason,effectiveAt,policy,now,clock},limits) {
  integer(actorId);if(actorId<1)throw new Error('Invalid actor');identifier(requestId,100);identifier(reason,500);
  if(effectiveAt!==undefined)throw new Error('Policy effective time is server controlled');
  if(clock!==undefined&&typeof clock!=='function')throw new Error('Invalid budget clock');
  if(clock===undefined)utc(now);
  if(!policy||typeof policy!=='object'||Array.isArray(policy))throw new Error('Invalid policy');
  for(const key of Object.keys(policy))if(!['dailyMicros','monthlyMicros','categoryDailyMicros','categoryMonthlyMicros',
    'maxConcurrentCalls','maxInputTokens','maxOutputTokens','reasoningMicros','toolMicros'].includes(key))throw new Error('Invalid policy field');
  const hash=createHash('sha256').update(JSON.stringify([actorId,reason,policy])).digest('hex');
  return db.transaction(()=>{
    const prior=db.prepare('SELECT id,payload_sha256 FROM model_budget_policy_events WHERE request_id=?').get(requestId);
    if(prior) {if(prior.payload_sha256!==hash)throw new Error('Policy request id conflicts');return {status:'already_recorded',version:prior.id};}
    const appliedAt=clock?lockedNow(clock):now;
    if(!advanceClock(db,appliedAt))return {status:'clock_rollback'};
    const hard=hardLimits(limits),base=effectivePolicy(db,limits,appliedAt).effective;
    const next={...base,...policy,
      categoryDailyMicros:policy.categoryDailyMicros===undefined?
        Object.fromEntries(Object.entries(base.categoryDailyMicros).map(([key,value])=>[key,Math.min(value,policy.dailyMicros??base.dailyMicros)])):
        categoryLimits(policy.categoryDailyMicros),
      categoryMonthlyMicros:policy.categoryMonthlyMicros===undefined?
        Object.fromEntries(Object.entries(base.categoryMonthlyMicros).map(([key,value])=>[key,Math.min(value,policy.monthlyMicros??base.monthlyMicros)])):
        categoryLimits(policy.categoryMonthlyMicros)};
    for(const key of ['dailyMicros','monthlyMicros','maxConcurrentCalls','maxInputTokens','maxOutputTokens','reasoningMicros','toolMicros'])
      if(integer(next[key])>hard[key])throw new Error('Policy exceeds environment ceiling');
    if(next.dailyMicros>next.monthlyMicros)throw new Error('Daily limit exceeds monthly limit');
    for(const [field,global] of [['categoryDailyMicros','dailyMicros'],['categoryMonthlyMicros','monthlyMicros']])
      for(const [key,value] of Object.entries(next[field])) if(value>next[global]||value>(hard[field][key]??hard[global]))
        throw new Error('Policy exceeds environment ceiling');
    const result=db.prepare(`INSERT INTO model_budget_policy_events(actor_id,request_id,payload_sha256,reason,effective_at,
      daily_micros,monthly_micros,category_daily_json,category_monthly_json,max_concurrent_calls,max_input_tokens,
      max_output_tokens,reasoning_micros,tool_micros) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(actorId,requestId,hash,reason,
      appliedAt,next.dailyMicros,next.monthlyMicros,JSON.stringify(next.categoryDailyMicros),JSON.stringify(next.categoryMonthlyMicros),
      next.maxConcurrentCalls,next.maxInputTokens,next.maxOutputTokens,next.reasoningMicros,next.toolMicros);
    return {status:'recorded',version:Number(result.lastInsertRowid)};
  }).immediate();
}
function alert(db,{kind,category=null,reservationId=null,period,now}) {
  utc(now);
  const allowed=['daily_exhausted','monthly_exhausted','category_daily_exhausted','category_monthly_exhausted',
    'concurrency_exhausted','unknown_price','unknown_charge','overrun','stale_usage','invalid_usage','clock_rollback',
    'late_usage','late_hold_failure'];
  if(!allowed.includes(kind))throw new Error('Invalid alert');
  const key=[kind,category||'',reservationId||'',period||now.slice(0,10)].join(':').slice(0,200);
  db.prepare('INSERT OR IGNORE INTO model_budget_alert_events(dedupe_key,kind,category,reservation_id,occurred_at,detail) VALUES(?,?,?,?,?,?)')
    .run(key,kind,category,reservationId,now,'');
}
function activeSlots(db,now) {
  utc(now);
  return db.prepare(`SELECT COUNT(*) AS n FROM model_call_slot_events s WHERE s.action='start' AND s.lease_until>?
    AND NOT EXISTS(SELECT 1 FROM model_call_slot_events f WHERE f.reservation_id=s.reservation_id AND f.action='finish')`).get(now).n;
}
function startSlot(db,{reservationId,now,deadlineAt,leaseUntil,slotToken},maxConcurrentCalls) {
  integer(reservationId);utc(now);utc(deadlineAt);utc(leaseUntil);identifier(slotToken,100);integer(maxConcurrentCalls);
  if(deadlineAt<=now||leaseUntil<=deadlineAt||Date.parse(leaseUntil)-Date.parse(now)>15000)
    throw new Error('Invalid slot lease');
  if(activeSlots(db,now)>=maxConcurrentCalls)return false;
  db.prepare("INSERT INTO model_call_slot_events(reservation_id,action,occurred_at,deadline_at,lease_until,slot_token) VALUES(?,'start',?,?,?,?)")
    .run(reservationId,now,deadlineAt,leaseUntil,slotToken);
  return true;
}
function finishSlot(db,{reservationId,now,slotToken}) {
  integer(reservationId);utc(now);identifier(slotToken,100);
  db.prepare(`INSERT OR IGNORE INTO model_call_slot_events(reservation_id,action,occurred_at,slot_token)
    SELECT ?,'finish',?,? WHERE EXISTS(SELECT 1 FROM model_call_slot_events
      WHERE reservation_id=? AND action='start' AND slot_token=?)`).run(reservationId,now,slotToken,reservationId,slotToken);
}
function recoverExpired(db,{reservationId,actorId,reason,requestId,clock=Date.now}) {
  integer(reservationId);if(reservationId<1)throw new Error('Invalid reservation');
  integer(actorId);if(actorId<1)throw new Error('Invalid actor');identifier(reason,500);identifier(requestId,100);
  const hash=createHash('sha256').update(JSON.stringify([reservationId,actorId,reason])).digest('hex');
  return db.transaction(()=>{
    const prior=db.prepare('SELECT * FROM model_call_recovery_events WHERE request_id=?').get(requestId);
    if(prior){if(prior.payload_sha256!==hash)throw new Error('Recovery request id conflicts');return {status:'already_recorded',recoveryId:prior.id};}
    const now=lockedNow(clock),slot=db.prepare("SELECT * FROM model_call_slot_events WHERE reservation_id=? AND action='start'").get(reservationId);
    const legacy=db.prepare('SELECT kind FROM model_call_legacy_recovery WHERE reservation_id=?').get(reservationId)?.kind;
    const attempt=Boolean(db.prepare('SELECT 1 FROM model_call_attempts WHERE reservation_id=?').get(reservationId));
    const result=Boolean(db.prepare('SELECT 1 FROM model_call_results WHERE reservation_id=?').get(reservationId));
    const finished=Boolean(db.prepare("SELECT 1 FROM model_call_slot_events WHERE reservation_id=? AND action='finish'").get(reservationId));
    if(!attempt||(!slot&&legacy!=='unfinished')||(slot&&(slot.lease_until>now||finished))||
      db.prepare('SELECT 1 FROM model_call_recovery_events WHERE reservation_id=?').get(reservationId)||
      (!slot&&result))throw new Error('Attempt is not recoverable');
    const latest=db.prepare('SELECT status FROM model_settlements WHERE reservation_id=? ORDER BY id DESC LIMIT 1').get(reservationId);
    if(latest&&latest.status!=='unknown')throw new Error('Attempt is not recoverable');
    if(!slot&&latest)throw new Error('Attempt is not recoverable');
    if(!advanceClock(db,now))return {status:'clock_rollback'};
    const inserted=db.prepare(`INSERT INTO model_call_recovery_events(reservation_id,actor_id,request_id,payload_sha256,reason,occurred_at)
      VALUES(?,?,?,?,?,?)`).run(reservationId,actorId,requestId,hash,reason,now);
    if(!latest)require('./budget').settleCost(db,{reservationId,status:'unknown',actualMicros:null,now});
    if(slot)finishSlot(db,{reservationId,now,slotToken:slot.slot_token});
    return {status:'recorded',recoveryId:Number(inserted.lastInsertRowid)};
  }).immediate();
}
function reconcileUnknown(db,{reservationId,status,actualMicros,actorId,reason,requestId,clock=Date.now}) {
  if(!['billed','not_billed'].includes(status))throw new Error('Invalid reconciliation');
  integer(reservationId);integer(actorId);identifier(reason,500);identifier(requestId,100);
  const hash=createHash('sha256').update(JSON.stringify([reservationId,status,actualMicros,actorId,reason])).digest('hex');
  return db.transaction(()=>{
    const prior=db.prepare('SELECT * FROM model_charge_reconciliations WHERE request_id=?').get(requestId);
    if(prior) {if(prior.payload_sha256!==hash)throw new Error('Reconciliation request id conflicts');
      return {status:'already_recorded',settlement:db.prepare('SELECT * FROM model_settlements WHERE id=?').get(prior.settlement_id)};}
    const now=lockedNow(clock);
    let latest=db.prepare('SELECT * FROM model_settlements WHERE reservation_id=? ORDER BY id DESC LIMIT 1').get(reservationId);
    const attempt=Boolean(db.prepare('SELECT 1 FROM model_call_attempts WHERE reservation_id=?').get(reservationId));
    if(attempt) {
      const slot=db.prepare("SELECT 1 FROM model_call_slot_events WHERE reservation_id=? AND action='start'").get(reservationId);
      const finished=db.prepare("SELECT 1 FROM model_call_slot_events WHERE reservation_id=? AND action='finish'").get(reservationId);
      const recovered=db.prepare('SELECT 1 FROM model_call_recovery_events WHERE reservation_id=?').get(reservationId);
      const legacy=db.prepare('SELECT kind FROM model_call_legacy_recovery WHERE reservation_id=?').get(reservationId)?.kind;
      if((slot&&!finished&&!recovered)||(!slot&&
        !((legacy==='unfinished'&&recovered)||(legacy==='completed_unknown'&&!recovered))))
        throw new Error('Attempt must be recovered before reconciliation');
    }
    if(latest?.status!=='unknown')throw new Error('Only latest unknown charge can be reconciled');
    if(!advanceClock(db,now))return {status:'clock_rollback'};
    const settlement=require('./budget').settleCost(db,{reservationId,status,actualMicros,now});
    ensureLateHold(db,reservationId,now);
    db.prepare('INSERT INTO model_charge_reconciliations(actor_id,request_id,payload_sha256,reason,settlement_id) VALUES(?,?,?,?,?)')
      .run(actorId,requestId,hash,reason,settlement.id);
    const requestKey=db.prepare('SELECT request_key FROM model_reservations WHERE id=?').get(reservationId)?.request_key;
    const match=/^claim-job:(\d+):attempt:\d+(?::after:\d+)?$/.exec(requestKey||'');
    if(match)db.prepare(`UPDATE claim_jobs SET state=CASE WHEN attempts<max_attempts THEN 'retry_wait' ELSE 'exhausted' END,
      next_attempt=?,retry_ready_at_ms=?,last_error='reconciled',lease_token=NULL,lease_until=NULL,
      dispatch_started_at_ms=CASE WHEN attempts<max_attempts THEN NULL ELSE dispatch_started_at_ms END
      WHERE id=? AND state='blocked' AND last_error='pending_reconciliation'`)
      .run(Date.parse(now),Date.parse(now),Number(match[1]));
    if(match)require('../ops/work-admission').markClaimPauseBlocked(db,Number(match[1]),Date.parse(now));
    return {status:'recorded',settlement};
  }).immediate();
}
function recordLateUsage(db,{reservationId,slotToken,outcome,inputTokens=null,outputTokens=null,now}) {
  integer(reservationId);identifier(slotToken,100);utc(now);
  if(!['succeeded','failed'].includes(outcome))throw new Error('Invalid late outcome');
  for(const value of [inputTokens,outputTokens])if(value!==null)integer(value);
  db.prepare(`INSERT OR IGNORE INTO model_call_late_events(reservation_id,slot_token,outcome,
    reported_input_tokens,reported_output_tokens,occurred_at) VALUES(?,?,?,?,?,?)`)
    .run(reservationId,slotToken,outcome,inputTokens,outputTokens,now);
  ensureLateHold(db,reservationId,now);
}
function ensureLateHold(db,reservationId,now) {
  const row=db.prepare(`SELECT r.id,r.category,r.max_micros,r.price_version,a.model,a.policy_version,
    s.status,s.actual_micros,l.outcome,l.reported_input_tokens,l.reported_output_tokens
    FROM model_call_late_events l JOIN model_reservations r ON r.id=l.reservation_id
    LEFT JOIN model_reservation_admissions a ON a.reservation_id=r.id
    LEFT JOIN model_settlements s ON s.id=(SELECT MAX(id) FROM model_settlements WHERE reservation_id=r.id)
    WHERE r.id=?`).get(reservationId);
  if(!row)return;
  alert(db,{kind:'late_usage',category:row.category,reservationId,now});
  if(!['billed','not_billed'].includes(row.status))return;
  let exposure=BigInt(row.max_micros);
  if(row.reported_input_tokens!==null&&row.reported_output_tokens!==null) {
    try {
      const priced=require('./prices').priceReportedUsage({model:row.model,priceVersion:row.price_version,
        inputTokens:row.reported_input_tokens,outputTokens:row.reported_output_tokens});
      if(BigInt(priced)<=BigInt(row.status==='billed'?row.actual_micros:0))return;
      if(BigInt(priced)>exposure)exposure=BigInt(priced);
    } catch {exposure+=BigInt(row.max_micros);}
  } else exposure+=BigInt(row.max_micros);
  const billed=BigInt(row.status==='billed'?row.actual_micros:0);
  const existing=db.prepare(`SELECT h.amount_micros,x.actual_micros FROM model_late_charge_holds h
    LEFT JOIN model_late_hold_resolutions x ON x.hold_id=h.id WHERE h.reservation_id=?`).all(reservationId);
  const covered=existing.reduce((sum,item)=>sum+BigInt(item.actual_micros??item.amount_micros),0n);
  const extra=exposure>billed+covered?exposure-billed-covered:0n;
  if(!extra)return;
  if(extra>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Late hold overflow');
  db.prepare(`INSERT OR IGNORE INTO model_late_charge_holds(reservation_id,source,hold_key,amount_micros,price_version,policy_version,occurred_at)
    VALUES(?,'late_usage',?,?,?,?,?)`).run(reservationId,`late:${reservationId}`,Number(extra),row.price_version,row.policy_version??0,now);
}
function resolveLateHold(db,{holdId,status,actualMicros,actorId,reason,requestId,clock=Date.now}) {
  integer(holdId);integer(actorId);integer(actualMicros);identifier(reason,500);identifier(requestId,100);
  if(holdId<1||actorId<1||!['billed','not_billed'].includes(status)||(status==='not_billed'&&actualMicros!==0))
    throw new Error('Invalid late hold resolution');
  const hash=createHash('sha256').update(JSON.stringify([holdId,status,actualMicros,actorId,reason])).digest('hex');
  return db.transaction(()=>{
    const prior=db.prepare('SELECT * FROM model_late_hold_resolutions WHERE request_id=?').get(requestId);
    if(prior){if(prior.payload_sha256!==hash)throw new Error('Late hold request id conflicts');
      return {status:'already_recorded',resolutionId:prior.id};}
    const hold=db.prepare('SELECT * FROM model_late_charge_holds WHERE id=?').get(holdId);
    if(!hold||db.prepare('SELECT 1 FROM model_late_hold_resolutions WHERE hold_id=?').get(holdId))
      throw new Error('Late hold already resolved or unavailable');
    const now=lockedNow(clock);if(!advanceClock(db,now))return {status:'clock_rollback'};
    const event=db.prepare(`INSERT INTO model_late_hold_resolutions(hold_id,actor_id,request_id,payload_sha256,reason,status,actual_micros,occurred_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(holdId,actorId,requestId,hash,reason,status,actualMicros,now);
    if(actualMicros>hold.amount_micros) {
      const category=db.prepare(`SELECT r.category FROM model_late_charge_holds h JOIN model_reservations r ON r.id=h.reservation_id
        WHERE h.id=?`).get(holdId).category;
      alert(db,{kind:'overrun',category,reservationId:hold.reservation_id,now});
    }
    return {status:'recorded',resolutionId:Number(event.lastInsertRowid)};
  }).immediate();
}
function restoreGuardExposure(db,guard,{reservationId,actorId,reason,requestId,clock=Date.now}) {
  integer(reservationId);integer(actorId);identifier(reason,500);identifier(requestId,100);
  if(reservationId<1||actorId<1||!guard)throw new Error('Invalid guard restoration');
  const hash=createHash('sha256').update(JSON.stringify([reservationId,actorId,reason])).digest('hex');
  return db.transaction(()=>{
    const prior=db.prepare('SELECT * FROM model_budget_guard_restorations WHERE request_id=?').get(requestId);
    if(prior){if(prior.payload_sha256!==hash)throw new Error('Guard restoration request id conflicts');
      return {status:'already_recorded',restorationId:prior.id};}
    const trip=guard.trips(db,clock).find(item=>item.reservationId===reservationId&&
      !db.prepare('SELECT 1 FROM model_budget_guard_restorations WHERE trip_name=?').get(item.name));
    if(!trip)throw new Error('Reservation is not tripped or already restored');
    const row=db.prepare(`SELECT r.*,a.policy_version FROM model_reservations r
      LEFT JOIN model_reservation_admissions a ON a.reservation_id=r.id WHERE r.id=?`).get(reservationId);
    const latest=db.prepare('SELECT status FROM model_settlements WHERE reservation_id=? ORDER BY id DESC LIMIT 1').get(reservationId);
    if(!row||!['billed','not_billed'].includes(latest?.status)||row.max_micros<1)
      throw new Error('Charge must be finalized before restoration');
    const now=lockedNow(clock);if(!advanceClock(db,now))return {status:'clock_rollback'};
    const holdKey=`guard:${trip.name}`;
    db.prepare(`INSERT INTO model_late_charge_holds(reservation_id,source,hold_key,amount_micros,price_version,policy_version,occurred_at)
      VALUES(?,'guard_restoration',?,?,?,?,?)`).run(reservationId,holdKey,row.max_micros,row.price_version,row.policy_version??0,now);
    const hold=db.prepare('SELECT * FROM model_late_charge_holds WHERE hold_key=?').get(holdKey);
    const faultId=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM model_budget_integrity_fault_events WHERE reservation_id=?').get(reservationId).id;
    const event=db.prepare(`INSERT INTO model_budget_guard_restorations(reservation_id,trip_name,fault_id,hold_id,
      actor_id,request_id,payload_sha256,reason,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(reservationId,trip.name,faultId,hold.id,actorId,requestId,hash,reason,now);
    return {status:'recorded',restorationId:Number(event.lastInsertRowid),holdId:hold.id};
  }).immediate();
}
function rearmGuard(db,guard,{actorId,reason,requestId,clock=Date.now}) {
  integer(actorId);if(actorId<1||!guard)throw new Error('Invalid guard rearm');
  identifier(reason,500);identifier(requestId,100);
  const hash=createHash('sha256').update(JSON.stringify([actorId,reason])).digest('hex');
  const result=db.transaction(()=>{
    const prior=db.prepare('SELECT * FROM model_budget_guard_rearms WHERE request_id=?').get(requestId);
    if(prior){if(prior.payload_sha256!==hash)throw new Error('Guard rearm request id conflicts');
      return {status:'already_recorded',rearmId:prior.id,snapshot:JSON.parse(prior.trip_names_json)};}
    const snapshot=guard.trips(db,clock);
    if(!snapshot.length||guard.fatal)throw new Error('Guard requires operator intervention');
    for(const item of snapshot)if(!db.prepare(`SELECT 1 FROM model_budget_guard_restorations
      WHERE trip_name=? AND reservation_id=?`).get(item.name,item.reservationId))throw new Error('Guard exposure is not restored');
    const now=lockedNow(clock);if(!advanceClock(db,now))return {status:'clock_rollback'};
    const event=db.prepare(`INSERT INTO model_budget_guard_rearms(actor_id,request_id,payload_sha256,reason,
      trip_names_json,occurred_at) VALUES(?,?,?,?,?,?)`).run(actorId,requestId,hash,reason,
      JSON.stringify(snapshot),now);
    return {status:'recorded',rearmId:Number(event.lastInsertRowid),snapshot};
  }).immediate();
  if(result.status==='clock_rollback')return result;
  const state=guard.rearm(result.snapshot,db,clock);
  return {status:result.status,rearmId:result.rearmId,guard:state};
}
function view(db,limits,now,{beforeReservationId=Number.MAX_SAFE_INTEGER,beforeUnresolvedId=Number.MAX_SAFE_INTEGER,
  beforeAlertId=Number.MAX_SAFE_INTEGER,beforeLateHoldId=Number.MAX_SAFE_INTEGER,limit=50,guard=null}={}) {
  utc(now);for(const value of [beforeReservationId,beforeUnresolvedId,beforeAlertId,beforeLateHoldId,limit])integer(value);
  if(limit<1||limit>50)throw new Error('Invalid budget page limit');
  const policy=effectivePolicy(db,limits,now),counter=(scope,category,kind,key)=>db.prepare(`SELECT amount_micros FROM model_budget_counters
    WHERE scope=? AND category=? AND period_kind=? AND period_key=?`).get(scope,category,kind,key)?.amount_micros??0;
  const sum=(a,b)=>{const value=BigInt(a)+BigInt(b);return value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):value.toString();};
  const day=now.slice(0,10),month=now.slice(0,7),outstanding=counter('all','','outstanding','');
  const totals={dailyMicros:sum(outstanding,counter('all','','day',day)),
    monthlyMicros:sum(outstanding,counter('all','','month',month)),outstandingMicros:outstanding,
    unknownMicros:counter('all','','unknown',''),lateHoldMicros:counter('all','','late_hold',''),categories:{}};
  const categoryRows=db.prepare(`SELECT DISTINCT category FROM model_budget_counters WHERE scope='category' AND
    ((period_kind='outstanding' AND period_key='') OR (period_kind='day' AND period_key=?) OR
      (period_kind='month' AND period_key=?)) LIMIT 65`).all(day,month);
  for(const {category} of categoryRows.slice(0,64)) {
    const pending=counter('category',category,'outstanding','');
    totals.categories[category]={dailyMicros:sum(pending,counter('category',category,'day',day)),
      monthlyMicros:sum(pending,counter('category',category,'month',month))};
  }
  const reservations=db.prepare(`SELECT r.id,r.category,r.max_micros,r.price_version,r.reserved_at,
    a.policy_version,a.estimated_input_tokens,a.estimated_output_tokens,s.status,s.actual_micros,
    u.reported_input_tokens,u.reported_output_tokens,u.attempt_number,u.status AS usage_status
    FROM model_reservations r LEFT JOIN model_reservation_admissions a ON a.reservation_id=r.id
    LEFT JOIN model_settlements s ON s.id=(SELECT MAX(id) FROM model_settlements WHERE reservation_id=r.id)
    LEFT JOIN model_call_usage_events u ON u.reservation_id=r.id
    WHERE r.id<? ORDER BY r.id DESC LIMIT ?`).all(beforeReservationId,limit);
  const unresolved=db.prepare(`SELECT p.reservation_id AS id,p.category,p.max_micros,p.reserved_at,p.state,
    s.deadline_at,s.lease_until,CASE WHEN x.id IS NULL THEN 0 ELSE 1 END AS recovered,
    l.kind AS legacy_kind,CASE WHEN l.kind='unfinished' THEN 1 ELSE 0 END AS legacy_recovery_eligible
    FROM model_budget_pending p LEFT JOIN model_call_slot_events s ON s.reservation_id=p.reservation_id AND s.action='start'
    LEFT JOIN model_call_recovery_events x ON x.reservation_id=p.reservation_id
    LEFT JOIN model_call_legacy_recovery l ON l.reservation_id=p.reservation_id
    WHERE p.reservation_id<? ORDER BY p.reservation_id DESC LIMIT ?`).all(beforeUnresolvedId,limit);
  const lateHolds=db.prepare(`SELECT h.id,h.reservation_id,h.source,h.amount_micros,h.price_version,h.policy_version,h.occurred_at,
    r.category,x.status AS resolution_status,x.actual_micros AS resolved_micros
    FROM model_late_charge_holds h JOIN model_reservations r ON r.id=h.reservation_id
    LEFT JOIN model_late_hold_resolutions x ON x.hold_id=h.id
    WHERE h.id<? ORDER BY h.id DESC LIMIT ?`).all(beforeLateHoldId,limit);
  const alerts=db.prepare(`SELECT id,kind,category,reservation_id,occurred_at FROM model_budget_alert_events
    WHERE id<? ORDER BY id DESC LIMIT ?`).all(beforeAlertId,limit);
  return {now,policyVersion:policy.version,effectiveAt:policy.effectiveAt,hardCeilings:policy.hard,effective:policy.effective,
    totals,categoryTotalsTruncated:categoryRows.length>64,activeSlots:activeSlots(db,now),
    guard:guard?guard.status():{tripped:false,fatal:false,reason:null,requiredAction:null,pendingReservations:[]},
    reservations,unresolved,lateHolds,alerts,
    nextCursors:{reservations:reservations.length===limit?reservations.at(-1).id:null,
      unresolved:unresolved.length===limit?unresolved.at(-1).id:null,
      lateHolds:lateHolds.length===limit?lateHolds.at(-1).id:null,alerts:alerts.length===limit?alerts.at(-1).id:null}};
}
module.exports={integer,identifier,utc,lockedNow,advanceClock,hardLimits,effectivePolicy,appendPolicy,alert,
  activeSlots,startSlot,finishSlot,recoverExpired,reconcileUnknown,recordLateUsage,ensureLateHold,resolveLateHold,
  restoreGuardExposure,rearmGuard,view};

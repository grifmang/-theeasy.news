const ops=require('./budget-ops');
function money(value) {
  if(!Number.isSafeInteger(value) || value<0) throw new Error('Invalid integer microdollars');
}
function text(value) {
  if(typeof value!=='string' || !value.trim() || value.length>200) throw new Error('Invalid budget identifier');
}
function reserveCost(db,{requestKey,category,maxMicros,priceVersion,now,model=null,
  estimatedInputTokens=null,estimatedOutputTokens=null,components=null,clock,guard},limits) {
  text(requestKey);text(category);text(priceVersion);money(maxMicros);
  if(!/^[a-z][a-z0-9_-]{0,63}$/.test(category)||!/^[A-Za-z0-9._:-]{1,100}$/.test(priceVersion))
    throw new Error('Invalid budget identifier');
  const hard=ops.hardLimits(limits);
  if(estimatedInputTokens!==null) money(estimatedInputTokens);
  if(estimatedOutputTokens!==null) money(estimatedOutputTokens);
  const parts=components||{inputMicros:maxMicros,outputMicros:0,reasoningMicros:0,toolMicros:0};
  for(const key of ['inputMicros','outputMicros','reasoningMicros','toolMicros'])money(parts[key]);
  if(BigInt(parts.inputMicros)+BigInt(parts.outputMicros)+BigInt(parts.reasoningMicros)+BigInt(parts.toolMicros)!==BigInt(maxMicros))
    throw new Error('Invalid cost components');
  if(clock!==undefined&&typeof clock!=='function')throw new Error('Invalid budget clock');
  if(clock===undefined)ops.utc(now);
  return db.transaction(()=>{
    if(db.prepare(`SELECT 1 FROM model_budget_integrity_fault_events f
      WHERE f.id>COALESCE((SELECT MAX(r.fault_id) FROM model_budget_guard_restorations r
        WHERE r.reservation_id=f.reservation_id),0) LIMIT 1`).get())
      return {status:'budget_exhausted',reason:'ledger_integrity'};
    if(guard&&!guard.check(db,clock))return {status:'budget_exhausted',reason:'budget_guard_tripped'};
    const existing=db.prepare('SELECT * FROM model_reservations WHERE request_key=?').get(requestKey);
    if(existing) {
      if(existing.category!==category || existing.max_micros!==maxMicros || existing.price_version!==priceVersion) throw new Error('Reservation parameters changed');
      const admission=db.prepare('SELECT * FROM model_reservation_admissions WHERE reservation_id=?').get(existing.id);
      if(admission&&(admission.model!==model||admission.estimated_input_tokens!==estimatedInputTokens||
        admission.estimated_output_tokens!==estimatedOutputTokens||admission.input_micros!==parts.inputMicros||
        admission.output_micros!==parts.outputMicros||admission.reasoning_micros!==parts.reasoningMicros||
        admission.tool_micros!==parts.toolMicros)) throw new Error('Reservation parameters changed');
      // Never a second permit, even if a previous attempt timed out or settled.
      return {status:'already_reserved',reservation:existing};
    }
    const admittedAt=clock?ops.lockedNow(clock):now;
    if(!ops.advanceClock(db,admittedAt))return {status:'clock_rollback'};
    const snapshot=ops.effectivePolicy(db,hard,admittedAt),effective=snapshot.effective;
    const counter=(scope,cat,kind,key)=>BigInt(db.prepare(`SELECT amount_micros FROM model_budget_counters
      WHERE scope=? AND category=? AND period_kind=? AND period_key=?`).get(scope,cat,kind,key)?.amount_micros??0);
    const day=admittedAt.slice(0,10),month=admittedAt.slice(0,7);
    const outstanding=counter('all','','outstanding',''),categoryOutstanding=counter('category',category,'outstanding','');
    const daily=outstanding+counter('all','','day',day),monthly=outstanding+counter('all','','month',month);
    const categoryDaily=categoryOutstanding+counter('category',category,'day',day);
    const categoryMonthly=categoryOutstanding+counter('category',category,'month',month);
    const added=BigInt(maxMicros);
    const checks=[['daily_exhausted',daily,effective.dailyMicros,day],
      ['monthly_exhausted',monthly,effective.monthlyMicros,month],
      ['category_daily_exhausted',categoryDaily,effective.categoryDailyMicros[category]??effective.dailyMicros,day],
      ['category_monthly_exhausted',categoryMonthly,effective.categoryMonthlyMicros[category]??effective.monthlyMicros,month]];
    for(const [kind,used,limit,period] of checks) if(!limit||used+added>BigInt(limit)) {
      ops.alert(db,{kind,category,period,now:admittedAt});return {status:'budget_exhausted',reason:kind};
    }
    const result=db.prepare('INSERT INTO model_reservations(request_key,category,max_micros,price_version,reserved_at) VALUES(?,?,?,?,?)').run(requestKey,category,maxMicros,priceVersion,admittedAt);
    db.prepare(`INSERT INTO model_reservation_admissions(reservation_id,policy_version,policy_json,price_version,model,
      estimated_input_tokens,estimated_output_tokens,input_micros,output_micros,reasoning_micros,tool_micros)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(result.lastInsertRowid,snapshot.version,JSON.stringify(effective),priceVersion,
      model,estimatedInputTokens,estimatedOutputTokens,parts.inputMicros,parts.outputMicros,parts.reasoningMicros,parts.toolMicros);
    return {status:'reserved',reservation:db.prepare('SELECT * FROM model_reservations WHERE id=?').get(result.lastInsertRowid),policy:snapshot};
  }).immediate();
}
function settleCost(db,{reservationId,actualMicros,status,now=new Date().toISOString()}) {
  if(!Number.isSafeInteger(reservationId) || reservationId<1 || !['billed','not_billed','unknown'].includes(status)) throw new Error('Invalid settlement');
  if(status==='unknown') {if(actualMicros!==null) throw new Error('Invalid unknown charge');}
  else {money(actualMicros);if(status==='not_billed' && actualMicros!==0) throw new Error('Invalid unbilled charge');}
  return db.transaction(()=>{
    const reservation=db.prepare('SELECT * FROM model_reservations WHERE id=?').get(reservationId);
    if(!reservation) throw new Error('Unknown reservation');
    const latest=db.prepare('SELECT * FROM model_settlements WHERE reservation_id=? ORDER BY id DESC LIMIT 1').get(reservationId);
    if(latest?.status===status && latest.actual_micros===actualMicros) return latest;
    if(latest && latest.status!=='unknown') throw new Error('Reservation already settled');
    const result=db.prepare('INSERT INTO model_settlements(reservation_id,status,actual_micros) VALUES(?,?,?)').run(reservationId,status,actualMicros);
    if(status==='unknown')ops.alert(db,{kind:'unknown_charge',category:reservation.category,reservationId,now});
    if(status==='billed'&&actualMicros>reservation.max_micros)ops.alert(db,{kind:'overrun',category:reservation.category,reservationId,now});
    return db.prepare('SELECT * FROM model_settlements WHERE id=?').get(result.lastInsertRowid);
  }).immediate();
}
module.exports={reserveCost,settleCost};

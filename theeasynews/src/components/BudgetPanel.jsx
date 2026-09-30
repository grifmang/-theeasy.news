import React, {useCallback, useEffect, useState} from 'react';
import {apiRequest} from '../api';
import ProviderQueueRecovery from './ProviderQueueRecovery';
import WorkAdmissionPanel from './WorkAdmissionPanel';
import './BudgetPanel.css';

const cursors={reservations:'beforeReservationId',unresolved:'beforeUnresolvedId',lateHolds:'beforeLateHoldId',alerts:'beforeAlertId'};
const currency=value=>`$${(Number(value||0)/1_000_000).toFixed(6)}`;
const stamp=value=>value?new Date(value).toLocaleString():'Not recorded';
const requestId=()=>globalThis.crypto?.randomUUID?.() || `budget-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function useBudget() {
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  const load=useCallback(async signal=>{
    setLoading(true);setError('');
    try {const result=await apiRequest('/api/v1/editor/budget',{signal});if(!signal.aborted)setData(result);}
    catch(reason){if(!signal.aborted)setError(reason.status===401?'Your session expired. Sign in again.':reason.status===403?'Editor access is required.':'Budget status could not be loaded. Check your connection and retry.');}
    finally {if(!signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();load(controller.signal);return()=>controller.abort();},[load,revision]);
  return {data,error,loading,reload:()=>setRevision(value=>value+1)};
}

function MicroField({label,value,onChange}) {return <label className="budget-field">{label}<span className="budget-input-wrap"><span aria-hidden="true">$</span><input type="number" min="0" step="0.000001" inputMode="decimal" value={value} onChange={event=>onChange(event.target.value)} required /></span></label>;}
function ReasonField({value,onChange}) {return <label className="budget-field">Operator reason<textarea value={value} onChange={event=>onChange(event.target.value)} maxLength="500" required /></label>;}
function ActionForm({title,children,onSubmit,working,error,confirmText}) {
  return <form className="budget-action" onSubmit={event=>{event.preventDefault();if(confirmText&&!window.confirm(confirmText))return;onSubmit();}}>
    <h4>{title}</h4>{children}{error&&<p className="budget-error" role="alert">{error}</p>}
    <button type="submit" disabled={working}>{working?'Recording…':'Record action'}</button>
  </form>;
}
function OpsAction({title,endpoint,fields,confirmText,onDone}) {
  const hasStatus=Object.hasOwn(fields,'status');
  const [reason,setReason]=useState(''),[amount,setAmount]=useState(''),[status,setStatus]=useState(hasStatus?'billed':''),[working,setWorking]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(null);
  const edit=(setter,value)=>{setter(value);setRetry(null);};
  const submit=async payload=>{
    setWorking(true);setError('');
    try {await apiRequest(endpoint,{method:'POST',body:payload});setRetry(null);setReason('');setAmount('');onDone(`${title} completed and recorded.`);}
    catch(cause){setError(cause.status===409?'The record changed since this page loaded. Refresh and review its current state.':cause.message||'The action was not recorded. Retry safely or refresh to confirm its status.');setRetry(payload);}
    finally {setWorking(false);}
  };
  const execute=()=>{
    if(retry){submit(retry);return;}
    const payload={...Object.fromEntries(Object.entries(fields).filter(([key])=>key!=='status').map(([key,value])=>[key,value])),reason,requestId:requestId()};
    if(hasStatus) {payload.status=status;payload.actualMicros=status==='not_billed'?0:Math.round(Number(amount)*1_000_000);}
    submit(payload);
  };
  return <ActionForm title={title} onSubmit={execute} working={working} error={error} confirmText={confirmText}>
    {hasStatus&&<><label className="budget-field">Outcome<select value={status} onChange={event=>edit(setStatus,event.target.value)}><option value="billed">Billed</option><option value="not_billed">Not billed</option></select></label>
      {status==='billed'&&<MicroField label="Actual charge" value={amount} onChange={value=>edit(setAmount,value)}/>}</>}
    <ReasonField value={reason} onChange={value=>edit(setReason,value)}/>
    {retry&&<p className="budget-note">Retry keeps the original request ID so the server can safely deduplicate it.</p>}
  </ActionForm>;
}
function ReservationActions({item,onDone}) {
  const hasUnknown=item.state==='unknown';
  return <div className="budget-actions">
    {item.recoveryEligible&&<OpsAction title="Recover expired attempt" endpoint="/api/v1/editor/budget/recover" fields={{reservationId:item.id}} confirmText={`Recover reservation ${item.id}? This finalizes its expired slot and may record an unknown charge.`} onDone={onDone}/>}
    {hasUnknown&&item.unknownEligible&&<OpsAction title="Reconcile unknown charge" endpoint="/api/v1/editor/budget/reconcile" fields={{reservationId:item.id,status:true}} confirmText={`Record a billing outcome for reservation ${item.id}? This audited settlement cannot be removed.`} onDone={onDone}/>}
  </div>;
}
function PolicyForm({snapshot,onDone}) {
  const effective=snapshot.effective;
  const [values,setValues]=useState({daily:(effective.dailyMicros/1e6).toFixed(6),monthly:(effective.monthlyMicros/1e6).toFixed(6),reasoning:(effective.reasoningMicros/1e6).toFixed(6),tool:(effective.toolMicros/1e6).toFixed(6),slots:effective.maxConcurrentCalls,input:effective.maxInputTokens,output:effective.maxOutputTokens,
    categoryDaily:JSON.stringify(effective.categoryDailyMicros||{},null,2),categoryMonthly:JSON.stringify(effective.categoryMonthlyMicros||{},null,2),reason:''});
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(null);
  const edit=change=>{setValues(v=>({...v,...change}));setRetry(null);};
  async function submit(payload){setWorking(true);setError('');try{await apiRequest('/api/v1/editor/budget/policy',{method:'POST',body:payload});setRetry(null);onDone('Budget policy appended and recorded.');}catch(cause){setError(cause.status===409?'The budget clock or policy changed. Refresh before trying again.':cause.message||'Policy was not recorded.');setRetry(payload);}finally{setWorking(false);}}
  return <form className="budget-policy" onSubmit={event=>{event.preventDefault();if(!window.confirm('Append this audited budget policy? Effective values are still capped by environment ceilings.'))return;
    let categoryDailyMicros,categoryMonthlyMicros;
    try {categoryDailyMicros=JSON.parse(values.categoryDaily||'{}');categoryMonthlyMicros=JSON.parse(values.categoryMonthly||'{}');if(!categoryDailyMicros||Array.isArray(categoryDailyMicros)||typeof categoryDailyMicros!=='object'||!categoryMonthlyMicros||Array.isArray(categoryMonthlyMicros)||typeof categoryMonthlyMicros!=='object')throw new Error();}
    catch {setError('Category limits must each be a JSON object, for example {"classification": 2500000}.');return;}
    const payload=retry||{requestId:requestId(),reason:values.reason,policy:{dailyMicros:Math.round(Number(values.daily)*1e6),monthlyMicros:Math.round(Number(values.monthly)*1e6),reasoningMicros:Math.round(Number(values.reasoning)*1e6),toolMicros:Math.round(Number(values.tool)*1e6),maxConcurrentCalls:Number(values.slots),maxInputTokens:Number(values.input),maxOutputTokens:Number(values.output),categoryDailyMicros,categoryMonthlyMicros}};submit(payload);}}>
    <h3>Append operating policy</h3><p>Policy changes are append-only; the effective values remain bounded by the environment ceilings above.</p>
    <div className="budget-form-grid"><MicroField label="Daily ceiling" value={values.daily} onChange={daily=>edit({daily})}/><MicroField label="Monthly ceiling" value={values.monthly} onChange={monthly=>edit({monthly})}/>
      <MicroField label="Reasoning reserve" value={values.reasoning} onChange={reasoning=>edit({reasoning})}/><MicroField label="Tool reserve" value={values.tool} onChange={tool=>edit({tool})}/>
      <label className="budget-field">Concurrent calls<input type="number" min="0" step="1" value={values.slots} onChange={event=>edit({slots:event.target.value})} required/></label>
      <label className="budget-field">Input token cap<input type="number" min="0" step="1" value={values.input} onChange={event=>edit({input:event.target.value})} required/></label>
      <label className="budget-field">Output token cap<input type="number" min="0" step="1" value={values.output} onChange={event=>edit({output:event.target.value})} required/></label>
      <label className="budget-field">Category daily limits (JSON)<textarea value={values.categoryDaily} onChange={event=>edit({categoryDaily:event.target.value})} aria-describedby="budget-category-help" /></label>
      <label className="budget-field">Category monthly limits (JSON)<textarea value={values.categoryMonthly} onChange={event=>edit({categoryMonthly:event.target.value})} aria-describedby="budget-category-help" /></label>
      <ReasonField value={values.reason} onChange={reason=>edit({reason})}/></div>
    <p id="budget-category-help" className="budget-note">Use category names as keys and integer micro-dollar limits as values. An empty object inherits the global ceiling.</p>
    {error&&<p className="budget-error" role="alert">{error}</p>}{retry&&<p className="budget-note">Unchanged retry preserves the original request ID.</p>}
    <button disabled={working}>{working?'Recording policy…':'Append policy'}</button>
  </form>;
}
function Pager({kind,data,more,loadMore}) {if(!data.length&&!more)return <p className="budget-empty">Nothing to review in this section.</p>;return more?<button className="budget-more" onClick={()=>loadMore(kind)}>Load older records</button>:null;}

export default function BudgetPanel() {
  const {data,error,loading,reload}=useBudget();
  const [extra,setExtra]=useState({}),[paging,setPaging]=useState(''),[pagingError,setPagingError]=useState(''),[announcement,setAnnouncement]=useState('');
  const refresh=()=>{setExtra({});setPaging('');setPagingError('');reload();};
  const completeAction=message=>{setAnnouncement(message);refresh();};
  async function loadMore(kind) {
    const cursor=extra._cursors?.[kind]??data?.nextCursors[kind];
    if(!cursor||paging)return;
    const controller=new AbortController(),query=new URLSearchParams({limit:'50',[cursors[kind]]:String(cursor)});
    setPaging(kind);setPagingError('');
    try {const page=await apiRequest(`/api/v1/editor/budget?${query}`,{signal:controller.signal});setExtra(previous=>({...previous,[kind]:[...(previous[kind]||[]),...page[kind]]}));setPaging('');
      // Each section advances independently; retain the cursor without exposing server metadata.
      setExtra(previous=>({...previous,_cursors:{...data.nextCursors,...previous._cursors,[kind]:page.nextCursors[kind]}}));
    } catch {setPaging('');setPagingError('Older records could not be loaded. Retry this section.');}
  }
  const sections=useCallback(kind=>[...(data?.[kind]||[]),...(extra[kind]||[])],[data,extra]);
  if(loading&&!data)return <section className="budget-panel" aria-labelledby="budget-title"><h2 id="budget-title">Budget operations</h2><div className="budget-skeleton" role="status">Loading budget status…</div></section>;
  if(error&&!data)return <section className="budget-panel" aria-labelledby="budget-title"><h2 id="budget-title">Budget operations</h2><p aria-live="assertive" className="budget-error">{error}</p><button onClick={reload}>Retry budget status</button></section>;
  if(!data)return null;
  const {hardCeilings:hard,effective,totals,guard}=data, unresolved=sections('unresolved'),holds=sections('lateHolds'),reservations=sections('reservations');
  return <section className="budget-panel" aria-labelledby="budget-title">
    <header className="budget-header"><div><p className="budget-kicker">EDITOR OPERATIONS / COST CONTROL</p><h2 id="budget-title">Budget operations</h2><p>Current exposure, bounded by environment ceilings. Viewing this panel never starts a model call.</p></div><button onClick={refresh} disabled={loading}>{loading?'Refreshing…':'Refresh status'}</button></header>
    <p className="budget-success" role="status" aria-live="polite">{announcement}</p>
    {error&&<p aria-live="assertive" className="budget-error">Refresh failed: {error}. Showing the last successful snapshot.</p>}
    <div className={`budget-guard ${guard.tripped||guard.fatal?'is-alert':''}`} role={guard.tripped||guard.fatal?'alert':'status'}><strong>Guard {guard.fatal?'fatal':guard.tripped?'tripped':'clear'}</strong><span>{guard.reason||'No active guard fault.'}</span><span>{guard.requiredAction?`Required: ${guard.requiredAction.replaceAll('_',' ')}`:'No operator action required.'}</span><span>Active slots: {data.activeSlots} / {effective.maxConcurrentCalls}</span></div>
    <div className="budget-metrics"><article><span>Today, including reserved</span><strong>{currency(totals.dailyMicros)}</strong></article><article><span>This month, including reserved</span><strong>{currency(totals.monthlyMicros)}</strong></article><article><span>Outstanding reservations</span><strong>{currency(totals.outstandingMicros)}</strong></article><article><span>Unknown charges</span><strong>{currency(totals.unknownMicros)}</strong></article><article><span>Late charge holds</span><strong>{currency(totals.lateHoldMicros)}</strong></article></div>
    <div className="budget-ceilings"><h3>Ceilings and effective limits</h3><dl>{[['Daily spend',hard.dailyMicros,effective.dailyMicros],['Monthly spend',hard.monthlyMicros,effective.monthlyMicros],['Concurrent calls',hard.maxConcurrentCalls,effective.maxConcurrentCalls],['Input tokens',hard.maxInputTokens,effective.maxInputTokens],['Output tokens',hard.maxOutputTokens,effective.maxOutputTokens],['Reasoning reserve',hard.reasoningMicros,effective.reasoningMicros],['Tool reserve',hard.toolMicros,effective.toolMicros]].map(([label,ceiling,value])=><div key={label}><dt>{label}</dt><dd>{label.includes('spend')||label.includes('reserve')?currency(value):value}<small> of {label.includes('spend')||label.includes('reserve')?currency(ceiling):ceiling} hard ceiling</small></dd></div>)}</dl><p>Policy version {data.policyVersion}; effective since {stamp(data.effectiveAt)}. Category totals {data.categoryTotalsTruncated?'are truncated after 64 categories.':'are available in the snapshot.'}</p>
      {Object.keys(effective.categoryDailyMicros||{}).length>0&&<><h4>Category ceilings</h4><ul>{Object.keys(effective.categoryDailyMicros).sort().map(category=><li key={category}><strong>{category}</strong> · daily {currency(effective.categoryDailyMicros[category])} · monthly {currency(effective.categoryMonthlyMicros?.[category])}</li>)}</ul></>}
      {Object.keys(totals.categories||{}).length>0&&<><h4>Category spend, including reservations</h4><ul>{Object.entries(totals.categories).sort(([a],[b])=>a.localeCompare(b)).map(([category,values])=><li key={category}><strong>{category}</strong> · today {currency(values.dailyMicros)} · month {currency(values.monthlyMicros)}</li>)}</ul></>}
    </div>
    <ProviderQueueRecovery onDone={()=>setAnnouncement('Provider queue recovery page recorded; queue status refreshed.')}/>
    <WorkAdmissionPanel />
    <PolicyForm key={data.policyVersion} snapshot={data} onDone={completeAction}/>
    <section className="budget-records"><h3>Unresolved reservations</h3>{unresolved.length?unresolved.map(item=><article className="budget-record" key={item.id}><div><strong>Reservation {item.id}</strong><span>{item.category} · {currency(item.max_micros)} · {item.state}</span><span>Reserved {stamp(item.reserved_at)} · deadline {stamp(item.deadline_at)} · recovered: {item.recovered?'yes':'no'}</span>{item.legacy_kind&&<span>Legacy state: {item.legacy_kind}</span>}</div><ReservationActions item={{...item,recoveryEligible:!item.recovered&&((item.legacy_recovery_eligible===1)||(item.lease_until&&Date.parse(item.lease_until)<=Date.parse(data.now))),unknownEligible:item.state==='unknown'}} onDone={completeAction}/></article>):<p className="budget-empty">No unresolved reservations. New reservations remain subject to the server guard and effective caps.</p>}<Pager kind="unresolved" data={unresolved} more={Boolean(extra._cursors?.unresolved??data.nextCursors.unresolved)} loadMore={loadMore}/></section>
    <section className="budget-records"><h3>Late charge holds</h3>{holds.filter(item=>!item.resolution_status).map(item=><article className="budget-record" key={item.id}><div><strong>Hold {item.id} · reservation {item.reservation_id}</strong><span>{item.category} · {currency(item.amount_micros)} · {item.source}</span><span>Created {stamp(item.occurred_at)} · unresolved</span></div><OpsAction title="Resolve hold" endpoint="/api/v1/editor/budget/late-hold/resolve" fields={{holdId:item.id,status:true}} confirmText={`Resolve late charge hold ${item.id}? This resolution is audited and cannot be removed.`} onDone={completeAction}/></article>)}{!holds.some(item=>!item.resolution_status)&&<p className="budget-empty">No unresolved late charge holds.</p>}<Pager kind="lateHolds" data={holds} more={Boolean(extra._cursors?.lateHolds??data.nextCursors.lateHolds)} loadMore={loadMore}/></section>
    <section className="budget-records"><h3>Guard recovery</h3>{guard.tripped?<><p className="budget-note">The API reports guard status without private trip identity. For each finalized reservation below, the restore endpoint verifies whether it matches an active trip.</p>{reservations.filter(item=>['billed','not_billed'].includes(item.status)).map(item=><div className="budget-record" key={`restore-${item.id}`}><div><strong>Reservation {item.id} · {item.status}</strong><span>{item.category} · {currency(item.actual_micros??0)}</span></div><OpsAction title="Restore exposure if tripped" endpoint="/api/v1/editor/budget/guard/restore" fields={{reservationId:item.id}} confirmText={`Attempt an audited exposure restoration for finalized reservation ${item.id}? The server rejects reservations without a matching guard trip.`} onDone={completeAction}/></div>)}</>:<p className="budget-empty">No pending guard restoration. The guard is clear.</p>}{guard.tripped&&!guard.fatal&&<OpsAction title="Rearm budget guard" endpoint="/api/v1/editor/budget/guard/rearm" fields={{}} confirmText="Rearm the budget guard after reviewing every listed exposure? This is an audited operator action." onDone={completeAction}/>}</section>
    {pagingError&&<p aria-live="assertive" className="budget-error">{pagingError}</p>}
    <section className="budget-records"><h3>Recent budget alerts</h3>{sections('alerts').length?<ul>{sections('alerts').map(item=><li key={item.id}><strong>{item.kind.replaceAll('_',' ')}</strong> · {item.category||'all categories'} · reservation {item.reservation_id||'—'} · {stamp(item.occurred_at)}</li>)}</ul>:<p className="budget-empty">No budget alerts recorded.</p>}<Pager kind="alerts" data={sections('alerts')} more={Boolean(extra._cursors?.alerts??data.nextCursors.alerts)} loadMore={loadMore}/></section>
    <section className="budget-records"><h3>Reservation ledger</h3>{reservations.length?<ul>{reservations.map(item=><li key={item.id}><strong>#{item.id} · {item.category}</strong> · reserved {currency(item.max_micros)} · charge {item.status||'pending'}{item.actual_micros!=null?` (${currency(item.actual_micros)})`:''} · policy {item.policy_version??'—'} · {stamp(item.reserved_at)}</li>)}</ul>:<p className="budget-empty">No reservations have been recorded.</p>}<Pager kind="reservations" data={reservations} more={Boolean(extra._cursors?.reservations??data.nextCursors.reservations)} loadMore={loadMore}/></section>
  </section>;
}

import React, {useCallback, useEffect, useState} from 'react';
import {apiRequest} from '../api';

const endpoint='/api/v1/editor/provider-queue';
const recoveryEndpoint=`${endpoint}/recover`;
const id=()=>globalThis.crypto?.randomUUID?.() || `provider-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const reasonLabel=value=>value==='provider_auth'?'Provider authentication':value==='provider_configuration'?'Provider configuration':'Unrecognized pause reason';
const safeReason=value=>['provider_auth','provider_configuration'].includes(value)?value:null;
const formatTime=value=>value?new Date(value).toLocaleString():'Not recorded';

export default function ProviderQueueRecovery({onDone}) {
  const [state,setState]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  const [reason,setReason]=useState(''),[active,setActive]=useState(false),[cursor,setCursor]=useState(0);
  const [retry,setRetry]=useState(null),[working,setWorking]=useState(false),[error,setError]=useState('');
  const [outcome,setOutcome]=useState(null),[announcement,setAnnouncement]=useState('');
  const [revision,setRevision]=useState(0);
  const refresh=useCallback(async signal=>{
    setLoading(true);setLoadError('');
    try {
      const value=await apiRequest(endpoint,{signal});
      if(!signal.aborted) setState({pausedAt:value.pausedAt, reason:safeReason(value.reason), pauseVersion:value.pauseVersion});
    } catch(cause) {
      if(!signal.aborted) setLoadError(cause.status===401?'Your session expired. Sign in again.':cause.status===403?'Editor access is required.':'Provider queue status could not be loaded. Check your connection and retry.');
    } finally {if(!signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();refresh(controller.signal);return()=>controller.abort();},[refresh,revision]);

  async function run(payload) {
    setWorking(true);setError('');setOutcome(null);setAnnouncement('Submitting audited provider recovery page.');
    try {
      const result=await apiRequest(recoveryEndpoint,{method:'POST',body:payload});
      setRetry(null);
      await refresh();
      const completed=Boolean(result.completed);
      const next=Number.isSafeInteger(result.nextAfterJobId)&&result.nextAfterJobId>0?result.nextAfterJobId:null;
      setOutcome({kind:completed?'completed':'partial',requeued:Number(result.requeuedJobs)||0,skipped:Number(result.skippedJobs)||0,
        next, recoveryId:Number.isSafeInteger(result.recoveryId)?result.recoveryId:null, status:result.status});
      if(completed) {setActive(false);setCursor(0);setReason('');setAnnouncement(`Recovery completed. ${Number(result.requeuedJobs)||0} jobs requeued and ${Number(result.skippedJobs)||0} skipped in this page. Provider pause status refreshed.`);}
      else if(next!==null) {setActive(true);setCursor(next);setAnnouncement(`Recovery is partial. ${Number(result.requeuedJobs)||0} jobs requeued and ${Number(result.skippedJobs)||0} skipped in this page. Continue is available.`);}
      else {setActive(false);setAnnouncement('Recovery response did not include a valid continuation. Review current provider queue status.');}
      onDone?.();
    } catch(cause) {
      const conflict=cause.status===409;
      setError(conflict?'The server returned a conflict: the pause may have changed, the continuation may be stale, or charge reconciliation may be required. The route does not distinguish these causes. Review refreshed status and outstanding budget holds before starting a new recovery.':'Recovery was not confirmed. Retry with the same request ID to safely check the recorded result.');
      setRetry(payload);setOutcome({kind:conflict?'conflict':'error'});setAnnouncement(conflict?'Provider recovery conflict. Status was refreshed; review before retrying.':'Recovery request failed. Retry preserves the same request ID.');
      if(conflict) {setActive(false);setCursor(0);}
      await refresh();
    } finally {setWorking(false);}
  }

  function begin(event) {
    event.preventDefault();
    if(!state?.pausedAt||!state.reason||!reason.trim())return;
    if(!window.confirm('Recover jobs blocked by this exact provider pause? This audited action processes bounded pages and clears the pause only when the server confirms the final page.'))return;
    setActive(true);setCursor(0);setRetry(null);setError('');setOutcome(null);
    run({reason:reason.trim(),requestId:id(),expectedPauseVersion:state.pauseVersion,expectedPausedAt:state.pausedAt,
      expectedReason:state.reason,afterJobId:0});
  }
  function continueRecovery() {
    if(!active||!state?.pausedAt||!outcome?.next)return;
    if(!window.confirm('Continue the next bounded recovery page for the same exact provider pause?'))return;
    run({reason:reason.trim(),requestId:id(),expectedPauseVersion:state.pauseVersion,expectedPausedAt:state.pausedAt,
      expectedReason:state.reason,afterJobId:cursor});
  }
  function retryRequest() {if(retry)run(retry);}
  function editReason(value) {setReason(value);setRetry(null);setError('');}

  return <section className="provider-recovery" aria-labelledby="provider-recovery-title">
    <header className="provider-recovery-header"><div><p className="budget-kicker">QUEUE SAFETY / OPERATOR RECOVERY</p><h3 id="provider-recovery-title">Provider queue</h3>
      <p>Recovery is audited and bounded to 100 jobs per page. The provider pause clears only after the server completes the final eligible page.</p></div>
      <button type="button" onClick={()=>setRevision(value=>value+1)} disabled={loading||working}>{loading?'Refreshing…':'Refresh queue status'}</button>
    </header>
    {loading&&!state&&!loadError&&<p className="provider-recovery-loading" role="status">Loading provider queue status…</p>}
    {loadError&&<div><p className="budget-error" role="alert">{loadError}</p><button type="button" onClick={()=>setRevision(value=>value+1)} disabled={loading}>Retry queue status</button></div>}
    {state&&<>
      <dl className="provider-recovery-identity"><div><dt>Status</dt><dd><strong>{state.pausedAt?'Paused':'Unpaused'}</strong></dd></div>
        <div><dt>Pause version</dt><dd>{state.pauseVersion}</dd></div><div><dt>Pause time</dt><dd>{formatTime(state.pausedAt)}</dd></div>
        <div><dt>Pause reason</dt><dd>{state.pausedAt&&state.reason?reasonLabel(state.reason):state.pausedAt?'Unrecognized reason; recovery unavailable':'No active pause'}</dd></div>
      </dl>
      {state.pausedAt&&!state.reason&&<p className="budget-error">This pause reason is not eligible for this recovery flow. No recovery action is available.</p>}
      {outcome&&<div className={`provider-recovery-outcome is-${outcome.kind}`} role="status" aria-live="polite">
        {outcome.kind==='partial'&&<><strong>Partial page recorded</strong><span>This page: {outcome.requeued} requeued, {outcome.skipped} skipped. Skips can include expired jobs, exhausted attempts, ineligible jobs, or missing permission; the route returns no per-job reasons.</span><span>More server-confirmed work remains. Continue uses the returned cursor; the server validates it.</span></>}
        {outcome.kind==='completed'&&<><strong>Recovery completed</strong><span>Final page: {outcome.requeued} requeued, {outcome.skipped} skipped.</span><span>The queue status above was refreshed after this result.</span></>}
        {outcome.kind==='conflict'&&<><strong>Stale pause, continuation conflict, or unresolved charge hold</strong><span>The server rejected this page. The route does not identify which condition occurred. Review the refreshed pause identity and reconcile any outstanding charge before starting a new recovery.</span></>}
        {outcome.kind==='error'&&<><strong>Outcome not confirmed</strong><span>Retry preserves the original request ID and payload.</span></>}
      </div>}
      {state.pausedAt&&state.reason&&<form className="provider-recovery-form" onSubmit={begin}>
        <label className="budget-field" htmlFor="provider-recovery-reason">Audited operator reason
          <textarea id="provider-recovery-reason" value={reason} onChange={event=>editReason(event.target.value)} maxLength="500" required disabled={active||working}/>
        </label>
        <p className="budget-note">Use a concise operational reason. Do not enter credentials, tokens, or private evidence.</p>
        {!active&&<button type="submit" disabled={working||loading||Boolean(loadError)||!reason.trim()}>Start recovery for pause version {state.pauseVersion}</button>}
        {active&&outcome?.kind==='partial'&&<button type="button" onClick={continueRecovery} disabled={working||loading||Boolean(loadError)||!outcome.next}>Continue recovery page</button>}
      </form>}
      {!state.pausedAt&&<p className="budget-empty">The provider queue is not paused. There is no recovery action to take.</p>}
      {retry&&<div className="provider-recovery-retry"><p className="budget-note">Retry sends the identical request ID and payload for safe deduplication.</p><button type="button" onClick={retryRequest} disabled={working}>Retry this recovery request</button></div>}
    </>}
    {error&&<p className="budget-error" role="alert">{error}</p>}
    <p className="provider-recovery-announcement" role="status" aria-live="polite">{announcement}</p>
  </section>;
}

import React,{useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';

export default function ProviderPermissionForm({job,permission,onChanged}) {
  const prefix=useId();
  const [reason,setReason]=useState('');
  const [acknowledged,setAcknowledged]=useState(false);
  const [busy,setBusy]=useState(false);
  const [stale,setStale]=useState(false);
  const [error,setError]=useState('');
  const pending=useRef(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  const valid=permission.provider==='typesafe' && /^[a-f0-9]{64}$/.test(permission.inputHash);
  const canGrant=valid && !permission.allowed && ['queued','retry_wait','leased'].includes(job.state) &&
    [null,'permission_required'].includes(permission.reason);
  async function save(allowed) {
    if(pending.current || stale || !valid || !reason.trim() || (allowed && (!canGrant || !acknowledged))) return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try {
      await apiRequest(`/api/v1/editor/jobs/${job.id}/provider-permission`,{method:'POST',signal:controller.signal,
        body:{allowed,reason,expectedEventId:permission.eventId,expectedInputHash:permission.inputHash}});
      if(!controller.signal.aborted) onChanged();
    } catch(failure) {
      if(controller.signal.aborted) return;
      setStale(failure.status===409);
      setError(failure.status===409?'Input or permission changed. Refresh this job and review it again.':
        failure.status===401?'Session expired. Sign in again.':failure.status===403?'Editor access is required.':
        'Could not save or confirm permission. Refresh the job before retrying.');
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }
  return <section aria-label="Provider disclosure controls"><h4>Typesafe disclosure permission</h4>
    <p>Authorization lets the enabled worker send this prepared input to Typesafe for JEV classification, within configured budgets. It can incur charges. Revocation cannot recall data already sent or cancel an in-flight charge.</p>
    <p>Input fingerprint: <code className="research-hash">{permission.inputHash || 'Unavailable'}</code></p>
    <div className="research-field"><label htmlFor={`${prefix}-reason`}>Permission reason</label>
      <textarea id={`${prefix}-reason`} rows={3} maxLength={8000} value={reason} disabled={busy || stale} onChange={event=>setReason(event.target.value)}/></div>
    {canGrant && <><label><input type="checkbox" checked={acknowledged} disabled={busy || stale} onChange={event=>setAcknowledged(event.target.checked)}/>
      I reviewed the prepared input and am authorized to disclose it to Typesafe.</label>
      <button disabled={busy || stale || !acknowledged || !reason.trim()} onClick={()=>save(true)}>Authorize Typesafe disclosure</button></>}
    {valid && permission.eventId!==null && <button disabled={busy || stale || !reason.trim()} onClick={()=>save(false)}>Revoke Typesafe disclosure</button>}
    {!canGrant && !permission.allowed && <p>This job cannot currently receive a disclosure grant. Check its state and eligibility.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

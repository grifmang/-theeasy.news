import React, {useCallback, useEffect, useState} from 'react';
import {apiRequest} from '../api';

const endpoint='/api/v1/editor/work-admission';
const makeRequestId=()=>globalThis.crypto?.randomUUID?.() || `work-admission-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const formatTime=value=>Number.isFinite(value)?new Date(value).toLocaleString():'Not recorded';
const count=value=>value>=1001?'1,000+':Number(value||0).toLocaleString();
const requestSignature=({action,reason,expectedVersion})=>JSON.stringify([action,reason,expectedVersion]);
const alertLabels={
  queue_backlog:'One or more eligible queues exceed 1,000 backlog items.',
  provider_paused:'The provider queue is paused.',
  budget_guard_tripped:'The budget guard is tripped.',
  budget_unresolved:'Unresolved budget exposure needs review.',
  backup_age_unknown:'Backup age is unknown. Verify backup status separately.'
};
const actionCopy={
  pause:{label:'Pause new work',confirm:'Pause admission of new work? Existing active jobs will continue and are not cancelled.'},
  resume:{label:'Resume new work',confirm:'Resume admission of new work? This does not enable classification, ingestion, or model calls.'}
};

export default function WorkAdmissionPanel() {
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  const [revision,setRevision]=useState(0),[reason,setReason]=useState(''),[working,setWorking]=useState(false);
  const [error,setError]=useState(''),[lastSubmission,setLastSubmission]=useState(null),[announcement,setAnnouncement]=useState('');

  const refresh=useCallback(async signal=>{
    setLoading(true);setLoadError('');
    try {
      const value=await apiRequest(endpoint,{signal});
      if(!signal?.aborted)setData(value);
      return true;
    } catch(cause) {
      if(!signal?.aborted) {
        setData(null);
        setLoadError(cause.status===401?'Your session expired. Sign in again.':cause.status===403?'Editor access is required.':'Work admission status could not be loaded. Check your connection and retry.');
      }
      return false;
    } finally {if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const controller=new AbortController();refresh(controller.signal);return()=>controller.abort();},[refresh,revision]);

  function editReason(value) {setReason(value);setError('');}

  async function submit(payload) {
    setWorking(true);setError('');setAnnouncement('Submitting the audited work admission change.');
    try {
      const {action,...requestBody}=payload;
      const result=await apiRequest(`${endpoint}/${action}`,{method:'POST',body:requestBody});
        setData(result.admission);setReason('');
      const label=actionCopy[action].label;
      setAnnouncement(`${label} ${result.status==='already_recorded'?'was already recorded':'recorded'} at version ${result.admission.version}.`);
    } catch(cause) {
      if(cause.status===409) {
        const refreshed=await refresh();
        setError(refreshed?'The state or request ID conflicts with the current server state. Status was refreshed; review the new version and submit a new action if it is still needed.':'The state or request ID conflicts with the current server state, and status could not be refreshed. Actions are disabled until current status loads. Retry status before continuing.');
        setAnnouncement(refreshed?'Work admission change conflicted. Current status refreshed; review before trying again.':'Work admission change conflicted, and status refresh failed. Actions are disabled until status loads.');
      } else {
        setError(cause.status===401?'Your session expired. Sign in again, then refresh status before taking action.':cause.status===403?'Editor access is required. No change was recorded.':'The outcome was not confirmed. Retry sends the identical request ID and payload so the server can safely deduplicate it.');
        setAnnouncement('Work admission outcome was not confirmed. Retry preserves the request ID and payload.');
      }
    } finally {setWorking(false);}
  }

  function begin(action) {
    if(!data||!reason.trim()||working)return;
    if(!window.confirm(actionCopy[action].confirm))return;
    const intended={action,reason:reason.trim(),expectedVersion:data.version};
    const signature=requestSignature(intended);
    const payload=lastSubmission?.signature===signature?lastSubmission.payload:{...intended,requestId:makeRequestId()};
    setLastSubmission({signature,payload});
    submit(payload);
  }

  if(loading&&!data&&!loadError)return <section className="work-admission" aria-labelledby="work-admission-title"><h3 id="work-admission-title">Work admission</h3><p className="work-admission-loading" role="status">Loading work admission status…</p></section>;
  return <section className="work-admission" aria-labelledby="work-admission-title">
    <header className="work-admission-header"><div><p className="budget-kicker">EDITOR OPERATIONS / WORK CONTROL</p><h3 id="work-admission-title">Work admission</h3>
      <p>Pausing stops admission of new work. Active jobs are not cancelled. This control does not enable classification, ingestion, or model calls.</p></div>
      <button type="button" onClick={()=>setRevision(value=>value+1)} disabled={loading||working}>{loading?'Refreshing…':'Refresh status'}</button>
    </header>
    {loadError&&<div><p className="budget-error" role="alert">{loadError}</p><button type="button" onClick={()=>setRevision(value=>value+1)} disabled={loading||working}>Retry status</button></div>}
    {data&&<>
      <dl className="work-admission-identity">
        <div><dt>Admission</dt><dd><strong>{data.state==='paused'?'Paused':'Running'}</strong></dd></div>
        <div><dt>Version</dt><dd>{data.version}</dd></div>
        <div><dt>Changed</dt><dd>{formatTime(data.changedAt)}</dd></div>
        <div><dt>Active work</dt><dd>{data.draining?'Draining':'Not draining'}</dd></div>
      </dl>
      <p className="work-admission-draining" role="status">{data.state==='paused'?(data.draining?'Admission is paused. Active jobs are still running and may drain; pausing does not cancel them.':'Admission is paused. No active leases are currently reported.'):'Admission is running.'}</p>
      <div className="work-admission-counts" aria-label="Queue counts">
        {[{kind:'claim',label:'Claim'},{kind:'fetch',label:'Fetch'},{kind:'rebuild',label:'Rebuild'},
          {kind:'analysisVerification',label:'Analysis verification'}].map(({kind,label})=><article key={kind}><h4>{label} jobs</h4><dl><div><dt>Active leases</dt><dd>{count(data.activeLeases?.[kind])}</dd></div><div><dt>Backlog</dt><dd>{count(data.backlog?.[kind])}</dd></div></dl></article>)}
      </div>
      {(data.activeLeases?.capped||data.backlog?.capped)&&<p className="budget-note">Counts are capped at 1,000; “1,000+” means the exact total is not reported.</p>}
      <section className="work-admission-alerts" aria-labelledby="work-admission-alerts-title"><h4 id="work-admission-alerts-title">Operational alerts</h4>
        {(()=>{
          const alerts=data.alerts;
          if(!Array.isArray(alerts))return <p className="budget-error">Alert status is unavailable or malformed. Do not assume there are no alerts.</p>;
          const valid=alerts.filter(alert=>alert&&typeof alert==='object'&&typeof alert.kind==='string'&&alertLabels[alert.kind]&&alert.severity==='warning');
          const complete=valid.length===alerts.length;
          return <>{!complete&&<p className="budget-error">Alert data is incomplete or malformed. Review server status before relying on this list.</p>}{valid.length?<ul>{valid.map((alert,index)=><li key={`${alert.kind}-${index}`}>{alertLabels[alert.kind]}</li>)}</ul>:complete?<p className="budget-empty">No allowlisted alerts were reported.</p>:null}</>;
        })()}
        <p>Backup age: unknown.</p>
      </section>
      {(()=>{
        const action=data.state==='paused'?'resume':'pause';
        const candidate={action,reason:reason.trim(),expectedVersion:data.version};
        const isSameRequest=Boolean(reason.trim())&&lastSubmission?.signature===requestSignature(candidate);
        return <form className="work-admission-form" onSubmit={event=>{event.preventDefault();begin(action);}}>
        <label className="budget-field" htmlFor="work-admission-reason">Audited operator reason
          <textarea id="work-admission-reason" value={reason} onChange={event=>editReason(event.target.value)} maxLength="500" required disabled={working}/>
        </label>
        <p className="budget-note">Use a concise reason for the audit record. Do not enter credentials, session data, or private operational identifiers.</p>
        <button type="submit" disabled={working||loading||Boolean(loadError)||!data||!reason.trim()}>{working?'Recording…':isSameRequest?'Retry same request':actionCopy[action].label}</button>
      </form>;
      })()}
    </>}
    {error&&<p className="budget-error" role="alert">{error}</p>}
    <p className="work-admission-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
  </section>;
}

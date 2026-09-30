import React,{useEffect,useId,useState} from 'react';
import {apiRequest} from '../api';
import PublicationReviewPanel from './PublicationReviewPanel';

function message(error) {
  if(error.status===401) return 'Your session expired. Sign in again.';
  if(error.status===403) return 'Editor access is required for analysis verification.';
  return error.status===409?'The record changed. Refresh before continuing.':'Could not load or save this record. Retry when the connection is available.';
}
function ErrorNotice({error,retry}) {return <div><p role="alert">{message(error)}</p><button type="button" onClick={retry}>Refresh</button></div>;}
function JsonDetails({label,value}) {return value==null?null:<details><summary>{label}</summary><pre>{JSON.stringify(value,null,2)}</pre></details>;}
function listFrom(value,key) {return Array.isArray(value?.[key])?value[key]:[];}

function Report({report}) {
  if(!report) return <p>No verification report is attached to this job.</p>;
  const stages=report.stages||report.stageResults||[];
  const issues=report.blockingIssues||report.blocking_issues||report.blockers||[];
  const assertions=report.assertions||[];
  return <section className="analysis-report" aria-label="Verification report">
    <h4>Verification report</h4>
    <p className="analysis-warning"><strong>This report is not a truth verdict or publication approval.</strong> It is a bounded review aid and requires human judgment.</p>
    <p>Outcome: {report.outcome||report.status||report.stage||'Not specified'}{report.semanticReviewRequired?' — human review required':''}</p>
    {issues.length>0?<><h5>Blocking issues</h5><ul>{issues.map((issue,index)=><li key={index}>{typeof issue==='string'?issue:issue.message||issue.code||JSON.stringify(issue)}</li>)}</ul></>:<p>No blocking issues were reported.</p>}
    {stages.length>0&&<><h5>Stages</h5><ul>{stages.map((stage,index)=><li key={index}><strong>{stage.name||stage.stage||`Stage ${index+1}`}</strong>: {stage.status||stage.state||'recorded'}{stage.reason?` — ${stage.reason}`:''}</li>)}</ul></>}
    {assertions.length>0&&<><h5>Assertions</h5><ul>{assertions.map((assertion,index)=><li key={assertion.id||index}><strong>{assertion.text||assertion.assertion||assertion.statement||`Assertion ${index+1}`}</strong>{assertion.status||assertion.relation?` — ${assertion.status||assertion.relation}`:''}{assertion.reason?` — ${assertion.reason}`:''}</li>)}</ul></>}
    <JsonDetails label="Coverage details" value={report.coverage}/>
    <JsonDetails label="Safe preparation details" value={report.pre}/>
    <JsonDetails label="Additional report fields" value={Object.fromEntries(Object.entries(report).filter(([key])=>!['outcome','status','semanticReviewRequired','blockingIssues','blocking_issues','blockers','stages','stageResults','assertions','coverage','pre'].includes(key)))}/>
  </section>;
}

export default function AnalysisVerificationPanel({claimId}) {
  const prefix=useId();
  const [versions,setVersions]=useState([]),[version,setVersion]=useState(null);
  const [jobs,setJobs]=useState([]),[jobId,setJobId]=useState(null),[detail,setDetail]=useState(null);
  const [preferredVersionId,setPreferredVersionId]=useState(null),[preferredJobId,setPreferredJobId]=useState(null);
  const [draft,setDraft]=useState(''),[draftError,setDraftError]=useState(''),[reason,setReason]=useState('');
  const [busy,setBusy]=useState(''),[error,setError]=useState(null),[revision,setRevision]=useState(0);
  const [maxAttempts,setMaxAttempts]=useState('3'),[deadlineMs,setDeadlineMs]=useState('300000');
  const refresh=()=>setRevision(value=>value+1);
  useEffect(()=>{
    const controller=new AbortController();let alive=true;
    setError(null);
    apiRequest(`/api/v1/editor/claims/${claimId}/analysis-versions`,{signal:controller.signal}).then(data=>{
      if(!alive)return;const items=listFrom(data,'items');setVersions(items);
      setVersion(previous=>items.find(item=>String(item.id)===String(preferredVersionId))||
        items.find(item=>String(item.id)===String(previous?.id))||items[0]||null);
    }).catch(reason=>{if(alive&&!controller.signal.aborted)setError(reason);});
    return ()=>{alive=false;controller.abort();};
  },[claimId,revision,preferredVersionId]);
  useEffect(()=>{
    if(!version)return;
    const controller=new AbortController();let alive=true;
    setJobs([]);setDetail(null);setError(null);
    apiRequest(`/api/v1/editor/analysis-versions/${version.id}/verification-jobs`,{signal:controller.signal}).then(data=>{
      if(!alive)return;const items=listFrom(data,'items');setJobs(items);
      setJobId(previous=>items.find(item=>String(item.job?.id)===String(preferredJobId))?.job?.id||
        items.find(item=>String(item.job?.id)===String(previous))?.job?.id||items[0]?.job?.id||null);
    }).catch(reason=>{if(alive&&!controller.signal.aborted)setError(reason);});
    return ()=>{alive=false;controller.abort();};
  },[version,preferredJobId]);
  useEffect(()=>{
    if(!jobId)return;
    const controller=new AbortController();let alive=true;setDetail(null);
    apiRequest(`/api/v1/editor/analysis-verification-jobs/${jobId}`,{signal:controller.signal}).then(data=>{if(alive)setDetail(data);})
      .catch(reason=>{if(alive&&!controller.signal.aborted)setError(reason);});
    return ()=>{alive=false;controller.abort();};
  },[jobId,revision]);
  async function saveDraft(event) {
    event.preventDefault();if(busy)return;let parsed;
    try {parsed=JSON.parse(draft);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();}
    catch {setDraftError('Enter a valid JSON object for the grounded draft.');return;}
    setDraftError('');setBusy('save');setError(null);
    try {const result=await apiRequest(`/api/v1/editor/claims/${claimId}/analysis-versions`,{method:'POST',body:{draft:parsed}});
      const saved=result?.version;
      setDraft('');if(saved){setPreferredVersionId(saved.id);setVersion(saved);}refresh();
    } catch(reason) {setError(reason);} finally {setBusy('');}
  }
  async function queueJob(event) {
    event.preventDefault();if(!version||busy)return;setBusy('queue');setError(null);
    try {const result=await apiRequest(`/api/v1/editor/analysis-versions/${version.id}/verification-jobs`,{method:'POST',body:{maxAttempts:Number(maxAttempts),deadlineMs:Number(deadlineMs)}});
      const queued=result?.job;
      if(queued?.id){setPreferredJobId(queued.id);setJobId(queued.id);}refresh();
    } catch(reason) {setError(reason);} finally {setBusy('');}
  }
  async function changePermission(allowed) {
    if(!detail||busy||!reason.trim())return;
    const answer=window.confirm(`${allowed?'Allow':'Revoke'} execution permission for analysis verification job ${jobId}? This records a separate permission event.`);
    if(!answer)return;
    setBusy('permission');setError(null);
    try {await apiRequest(`/api/v1/editor/analysis-verification-jobs/${jobId}/permission`,{method:'POST',body:{allowed,reason:reason.trim(),
      expectedEventId:detail.permission?.id??null,
      expectedAdmissionHash:detail.job?.admissionHash??null}});setReason('');refresh();
    } catch(reason) {setError(reason);if(reason.status===409)refresh();} finally {setBusy('');}
  }
  const job=detail?.job||{};const permission=detail?.permission||{};
  const report=detail?.report?.report||null;
  return <section className="analysis-verification" aria-labelledby={`${prefix}-heading`}>
    <h3 id={`${prefix}-heading`}>Grounded analysis review</h3>
    <p>Save a grounded draft as an editor-only version, then queue a bounded verification review if useful. The writer is not activated. Queueing records work only; it never authorizes execution, and no live worker is implied.</p>
    {error&&<ErrorNotice error={error} retry={refresh}/>}
    <div className="research-field"><label htmlFor={`${prefix}-version`}>Analysis version</label>
      <select id={`${prefix}-version`} value={version?.id??''} onChange={event=>{
        const selected=versions.find(item=>String(item.id)===event.target.value)||null;
        setPreferredVersionId(selected?.id??null);setVersion(selected);setJobs([]);setJobId(null);setPreferredJobId(null);setDetail(null);
      }}>
        {versions.length===0?<option value="">No versions available</option>:versions.map(item=><option key={item.id} value={item.id}>Version {item.id}{item.createdAtMs?` — ${new Date(item.createdAtMs).toLocaleString()}`:''}</option>)}
      </select>
    </div>
    {versions.length===0&&<p>{error?'Analysis versions could not be loaded.':'No grounded analysis versions yet. Save a draft below to create one.'}</p>}
    <form onSubmit={saveDraft}><div className="research-field">
      <label htmlFor={`${prefix}-draft`}>Grounded draft JSON</label>
      <textarea id={`${prefix}-draft`} rows="8" value={draft} onChange={event=>{setDraft(event.target.value);setDraftError('');}} aria-describedby={`${prefix}-draft-help ${prefix}-draft-error`}/>
      <small id={`${prefix}-draft-help`}>Paste the draft object with its evidence grounding and provenance. Saving stores editor-only content; it does not publish or activate a writer.</small>
      <small id={`${prefix}-draft-error`} role={draftError?'alert':undefined}>{draftError}</small>
    </div><button type="submit" disabled={!draft.trim()||busy!==''}>{busy==='save'?'Saving draft…':'Save grounded draft'}</button></form>
    {version&&<>
      <JsonDetails label={`Selected version ${version.id} metadata`} value={version}/>
      <form onSubmit={queueJob} className="analysis-queue-form"><h4>Queue a verification review</h4>
        <p>Queueing does not authorize a worker to execute the review. A separate editor permission event is required.</p>
        <div className="research-field"><label htmlFor={`${prefix}-attempts`}>Maximum attempts</label><input id={`${prefix}-attempts`} type="number" min="1" max="3" value={maxAttempts} onChange={event=>setMaxAttempts(event.target.value)}/></div>
        <div className="research-field"><label htmlFor={`${prefix}-deadline`}>Deadline (milliseconds)</label><input id={`${prefix}-deadline`} type="number" min="1000" max="300000" value={deadlineMs} onChange={event=>setDeadlineMs(event.target.value)}/></div>
        <button type="submit" disabled={busy!==''}>{busy==='queue'?'Queueing…':'Queue verification'}</button>
      </form>
      <h4>Verification jobs for version {version.id}</h4>
      {jobs.length===0?<p>{error?'Jobs could not be loaded.':'No verification jobs for this version.'}</p>:<ul className="research-list">{jobs.map(item=><li key={item.job.id}><button type="button" aria-pressed={String(jobId)===String(item.job.id)} onClick={()=>setJobId(item.job.id)}>Job {item.job.id} — {item.job.state||item.job.status||'unknown'}</button></li>)}</ul>}
      {jobId&&!detail&&<p role="status">Loading verification job…</p>}
      {detail&&<section className="analysis-job" aria-label={`Verification job ${jobId} detail`}>
        <h4>Job {jobId}</h4><p>State: {job.state||job.status||'unknown'}. Attempts: {job.attempts??job.attemptCount??0}. Deadline: {job.taskDeadlineAtMs?new Date(job.taskDeadlineAtMs).toLocaleString():'not reported'}.</p>
        {(job.lastError||job.last_error)&&<p role="alert">Last error: {job.lastError||job.last_error}</p>}
        <p>Execution permission: {permission.allowed?'Allowed':'Not allowed'}{permission.reason?` — ${permission.reason}`:''}</p>
        <button type="button" onClick={refresh} disabled={busy!==''}>Refresh job</button>
        <fieldset disabled={busy!==''}><legend>Execution permission (separate audited action)</legend>
          <div className="research-field"><label htmlFor={`${prefix}-reason`}>Reason for permission change</label><textarea id={`${prefix}-reason`} rows="3" maxLength="500" required value={reason} onChange={event=>setReason(event.target.value)}/></div>
          <button type="button" disabled={!reason.trim()} onClick={()=>changePermission(true)}>Allow execution</button>{' '}
          <button type="button" disabled={!reason.trim()||!permission.allowed} onClick={()=>changePermission(false)}>Revoke execution permission</button>
        </fieldset>
        <Report report={report}/>
        {job.state==='done'&&detail.job?.id===jobId&&
          detail.report?.metadata?.id&&detail.report.metadata.analysisVersionId===version?.id&&
          version?.id&&<PublicationReviewPanel
          key={`${claimId}-${version.id}-${detail.report.metadata.id}`}
          claimId={claimId} analysisVersionId={version.id} reportId={detail.report.metadata.id} report={report}/>}
        <JsonDetails label="Safe job and version metadata" value={{analysisVersion:detail.analysisVersion,permission:detail.permission,reportMetadata:detail.report?.metadata}}/>
      </section>}
    </>}
    <button type="button" onClick={refresh} disabled={busy!==''}>Refresh analysis versions and jobs</button>
  </section>;
}

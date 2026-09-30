import React,{useCallback,useEffect,useId,useState} from 'react';
import {apiRequest} from '../api';
import PublicationRetractionPanel from './PublicationRetractionPanel';
import {cleanReason,errorText,requestKey} from './publication-utils';
function Preview({preview}){
  if(!preview)return null;
  return <section className="publication-preview" aria-label="Sanitized publication preview">
    <h5>Public preview · unresolved</h5><h6>{preview.title}</h6>
    {preview.attribution&&<p>Attribution: {preview.attribution}</p>}
    <p>Publication does not establish a finding.</p>
    <dl><dt>Support</dt><dd>{preview.summary?.support}</dd><dt>Contradiction</dt><dd>{preview.summary?.contradiction}</dd><dt>Unknown</dt><dd>{preview.summary?.unknown}</dd></dl>
    <h6>Sections</h6><ol>{(preview.sections||[]).map((section,index)=><li key={index}><strong>{section.kind}</strong><p>{section.text}</p><small>Cited passage IDs: {section.citationPassageIds?.join(', ')||'none'}</small></li>)}</ol>
    <h6>Public citations</h6><ol>{(preview.citations||[]).map((citation,index)=><li key={index}>
      <p>Passage {citation.passageId} · {citation.locator}</p>
      {citation.excerpts?.map((excerpt,part)=><blockquote key={part}>{excerpt}</blockquote>)}
      {citation.url&&<a href={citation.url} target="_blank" rel="noopener noreferrer">Public source</a>}
    </li>)}</ol>
  </section>;
}

export default function PublicationReviewPanel({claimId,analysisVersionId,reportId,report,showRetraction=true}){
  const prefix=useId();
  const [state,setState]=useState(null),[headState,setHeadState]=useState(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState('');
  const [revision,setRevision]=useState(0),[reviewDecision,setReviewDecision]=useState('approved');
  const [reviewReason,setReviewReason]=useState(''),[actionReason,setActionReason]=useState('');
  const [pending,setPending]=useState(null),[reviewedAction,setReviewedAction]=useState(false),[approvedBinding,setApprovedBinding]=useState(null);
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    const controller=new AbortController();let alive=true;
    setLoading(true);setError(null);setState(null);setHeadState(null);setPending(null);setReviewedAction(false);
    const head=apiRequest(`/api/v1/editor/claims/${claimId}/publication-state`,{signal:controller.signal})
      .then(data=>{if(alive)setHeadState(data);}).catch(reason=>{if(alive&&!controller.signal.aborted)setError(reason);});
    const version=apiRequest(`/api/v1/editor/analysis-versions/${analysisVersionId}/publication-state?reportId=${reportId}`,{signal:controller.signal})
      .then(data=>{if(alive)setState(data);}).catch(reason=>{if(alive&&!controller.signal.aborted)setError(reason);});
    Promise.all([head,version]).finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;controller.abort();};
  },[claimId,analysisVersionId,reportId,revision]);

  const head=headState?.head;
  const active=head?.state==='active';
  const headVersionKnown=Boolean(headState)&&(!active||Number.isSafeInteger(head.analysisVersionId)&&head.analysisVersionId>0);
  const headConsistent=Boolean(state&&headState)&&
    (state.head?.eventId??null)===(head?.eventId??null)&&
    (state.head?.generation??null)===(head?.generation??null);
  const sameVersionActive=active&&head.analysisVersionId===Number(analysisVersionId);
  const currentApproval=state?.latestReview?.decision==='approved'&&
    state.latestReview.id===approvedBinding?.reviewId&&
    state.draftSha256===approvedBinding.draftSha256&&
    state.reportSha256===approvedBinding.reportSha256&&
    state.checkedVersionHash===approvedBinding.checkedVersionHash&&
    state.dtoSha256===approvedBinding.dtoSha256;
  const canAct=currentApproval&&reviewedAction&&
    (!head||active)&&headVersionKnown&&headConsistent&&!sameVersionActive&&!loading&&!busy;
  const action=head?'correct':'publish';
  const hashes=state&&{expectedDraftSha256:state.draftSha256,expectedReportSha256:state.reportSha256,
    expectedCheckedVersionHash:state.checkedVersionHash,expectedDtoSha256:state.dtoSha256};
  const reviewPayload=()=>({reportId:Number(reportId),...hashes,
    expectedReviewEventId:state.latestReview?.id??null,decision:reviewDecision,reason:reviewReason.trim(),requestKey:requestKey()});
  const actionPayload=()=>({action,reviewEventId:state.latestReview.id,...hashes,
    expectedGeneration:head?.generation??null,expectedHeadEventId:head?.eventId??null,
    reason:actionReason.trim(),requestKey:requestKey()});
  async function submit(kind,payload){
    const path=kind==='review'?`/api/v1/editor/analysis-versions/${analysisVersionId}/publication-reviews`:
      `/api/v1/editor/analysis-versions/${analysisVersionId}/publication-actions`;
    setBusy(true);setError(null);setNotice('');
    try {
      const result=await apiRequest(path,{method:'POST',body:payload});
      if(kind==='review'&&(!Number.isSafeInteger(result.review?.id)||result.review.id<=0||
        result.review.decision!==payload.decision))
        throw new Error('The review response could not be confirmed.');
      if(kind==='action'&&(!Number.isSafeInteger(result.event?.id)||result.event.id<=0||
        result.event.action!==payload.action))
        throw new Error('The publication response could not be confirmed.');
      setPending(null);setReviewedAction(false);
      if(kind==='review'){
        setReviewReason('');
        setApprovedBinding(payload.decision==='approved'&&result.review?.id?{
          reviewId:result.review.id,draftSha256:payload.expectedDraftSha256,
          reportSha256:payload.expectedReportSha256,checkedVersionHash:payload.expectedCheckedVersionHash,
          dtoSha256:payload.expectedDtoSha256}:null);
      } else setApprovedBinding(null);
      if(kind==='action')setActionReason('');
      setNotice(`${kind==='review'?'Review':'Publication action'} recorded. Refreshing state.`);
      refresh();
    } catch(reason) {
      setError(reason);
      if(reason.status===409){setPending(null);setApprovedBinding(null);setReviewedAction(false);setNotice(errorText(reason));refresh();}
      else setPending({kind,payload});
    } finally {setBusy(false);}
  }
  function dispatch(kind,makePayload){
    if(busy)return;
    if((kind==='review'&&(!headVersionKnown||!headConsistent||sameVersionActive))||
      (kind==='action'&&!canAct))return;
    let payload;
    try {payload=pending?.kind===kind?pending.payload:makePayload();}
    catch(reason){setError(reason);return;}
    if(kind==='action'&&!window.confirm(`${payload.action==='correct'?'Correct':'Publish'} claim ${claimId} using analysis version ${analysisVersionId}? This creates a public publication event.`))return;
    submit(kind,payload);
  }
  function changed(kind){if(pending?.kind===kind)setPending(null);}
  const limits=state?.preview?.limitations;
  return <section className="publication-review" aria-labelledby={`${prefix}-heading`}>
    <h4 id={`${prefix}-heading`}>Publication review · version {analysisVersionId}, report {reportId}</h4>
    <p>Review the exact public preview and verification report before recording a decision. All publication actions are manual.</p>
    {loading&&<p role="status">Loading publication state…</p>}
    {error&&<p role="alert">{errorText(error)}</p>}
    {notice&&<p role="status">{notice}</p>}
    <button type="button" onClick={refresh} disabled={busy}>Refresh publication state</button>
    {headState&&<p>Current claim head: {head?`${head.state}, generation ${head.generation}, event ${head.eventId}${active?`, analysis version ${head.analysisVersionId??'unknown'}`:''}`:'none'}.
      {' '}Retraction: {headState.isPublicationOwner&&active?'available to you':'unavailable'}.</p>}
    {sameVersionActive&&<p role="status">This analysis version is already the active publication. Its review cannot be replaced. Create a new analysis version for a correction, or use the explicit retraction below to withdraw the publication.</p>}
    {!loading&&!headVersionKnown&&<p role="alert">The active publication version could not be confirmed. Refresh publication state before reviewing or correcting.</p>}
    {!loading&&state&&!headConsistent&&<p role="alert">The claim head changed during loading. Refresh publication state before reviewing or correcting.</p>}
    {state&&<>
      <Preview preview={state.preview}/>
      <section aria-label="Coverage and limitations"><h5>Coverage and limitations</h5>
        <p>Coverage complete: {limits?.coverageComplete?'yes':'no'}. Search date verified: {limits?.searchDateVerified?'yes':'no'}.
          As of: {limits?.asOfDate||'not established'}.</p>
        {limits?.gaps?.length?<ul>{limits.gaps.map((gap,index)=><li key={index}>{gap}</li>)}</ul>:<p>No coverage gaps listed in this preview.</p>}
        <p>Verification stage: {report?.stage||'not reported'}.</p>
        {report?.blockingIssues?.length>0&&<><h6>Verification blocking issues</h6><ul>{report.blockingIssues.map((issue,index)=><li key={index}>{typeof issue==='string'?issue:issue.message||issue.code||'Unspecified issue'}</li>)}</ul></>}
      </section>
      <dl className="publication-hashes">
        <dt>Draft SHA-256</dt><dd>{state.draftSha256}</dd><dt>Report SHA-256</dt><dd>{state.reportSha256}</dd>
        <dt>Checked version hash</dt><dd>{state.checkedVersionHash}</dd><dt>DTO SHA-256</dt><dd>{state.dtoSha256}</dd>
        <dt>Dependency SHA-256</dt><dd>{state.dependencySha256}</dd>
      </dl>
      <p>Latest review: {state.latestReview?`${state.latestReview.decision}, event ${state.latestReview.id} (${new Date(state.latestReview.occurredAtMs).toLocaleString()})`:'none'}.</p>
      <form onSubmit={event=>{event.preventDefault();if(cleanReason(reviewReason))dispatch('review',reviewPayload);}}>
        <fieldset disabled={busy||loading||sameVersionActive||!headVersionKnown||!headConsistent}><legend>Record immutable publication review</legend>
          <div className="research-field"><label htmlFor={`${prefix}-decision`}>Decision</label><select id={`${prefix}-decision`} value={reviewDecision} onChange={event=>{setReviewDecision(event.target.value);changed('review');}}><option value="approved">Approve this exact preview</option><option value="rejected">Reject this exact preview</option></select></div>
          <div className="research-field"><label htmlFor={`${prefix}-review-reason`}>Reason</label><textarea id={`${prefix}-review-reason`} value={reviewReason} maxLength="500" required rows="3" onChange={event=>{setReviewReason(event.target.value);changed('review');}}/></div>
          <button type="submit" disabled={!cleanReason(reviewReason)}>{pending?.kind==='review'?'Retry same review':'Record review'}</button>
        </fieldset>
      </form>
      <form onSubmit={event=>{event.preventDefault();if(canAct&&cleanReason(actionReason))dispatch('action',actionPayload);}}>
        <fieldset disabled={busy||loading||!currentApproval||(head&&!active)||sameVersionActive||!headVersionKnown||!headConsistent}><legend>{action==='correct'?'Correct active publication':'Publish reviewed analysis'}</legend>
          {!currentApproval&&<p>Record approval of this exact preview in this panel before publishing.</p>}
          <label className="publication-attestation"><input type="checkbox" checked={reviewedAction} onChange={event=>{setReviewedAction(event.target.checked);changed('action');}}/> I reviewed the current approval, preview, hashes, and claim head.</label>
          <div className="research-field"><label htmlFor={`${prefix}-action-reason`}>Publication reason</label><textarea id={`${prefix}-action-reason`} value={actionReason} maxLength="500" required rows="3" onChange={event=>{setActionReason(event.target.value);changed('action');}}/></div>
          <button type="submit" disabled={!canAct||!cleanReason(actionReason)}>{pending?.kind==='action'?`Retry same ${action}`:action==='correct'?'Confirm correction':'Confirm publication'}</button>
        </fieldset>
      </form>
    </>}
    {showRetraction&&<PublicationRetractionPanel claimId={claimId} onChanged={refresh}/>}
  </section>;
}

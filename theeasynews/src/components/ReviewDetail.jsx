import React,{useEffect,useRef,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {apiRequest} from '../api';
import PublicationReviewPanel from './PublicationReviewPanel';

function JobGuidance({job}){
  if(!job)return <p>No verification job exists. Open the claim in the research desk to queue one.</p>;
  const guidance={queued:'Awaiting separate execution permission and worker dispatch.',
    leased:'Verification is running. Refresh after the lease completes.',
    retry_wait:'A bounded retry is pending. Inspect the failure before allowing another attempt.',
    exhausted:'Attempts are exhausted. Review the error and create a new version only after resolving its cause.',
    blocked:'Verification is blocked. Resolve the recorded issue in the research desk.',
    done:'Verification finished. Read the report and cited source context before any publication review.'};
  return <p>Job {job.id}: {job.state}. {guidance[job.state]||'Inspect the job in the research desk.'}{job.lastError?` Recorded failure: ${job.lastError}.`:''}</p>;
}

export default function ReviewDetail(){
  const {versionId}=useParams();
  const citationReturn=useRef(null);
  function openPassage(event,passageId){
    const target=document.getElementById(`review-passage-${passageId}`);
    if(!target)return;
    event.preventDefault();citationReturn.current=event.currentTarget;
    target.scrollIntoView?.();target.focus();
  }
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!/^[1-9]\d*$/.test(versionId)){setError('Invalid analysis version.');setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');setData(null);
    (async()=>{
      const version=await apiRequest(`/api/v1/editor/analysis-versions/${versionId}`,{signal:controller.signal});
      const claimId=version.version.claimId;
      const results=await Promise.allSettled([
        apiRequest(`/api/v1/editor/claims/${claimId}/evidence-packet`,{signal:controller.signal}),
        apiRequest(`/api/v1/editor/analysis-versions/${versionId}/verification-jobs`,{signal:controller.signal}),
        apiRequest(`/api/v1/editor/claims/${claimId}/publication-history`,{signal:controller.signal})]);
      const [packet,jobs,history]=results.map(result=>result.status==='fulfilled'?result.value:null);
      const newest=jobs?.items?.at(-1)?.job;
      let detail=null;
      if(newest)try{detail=await apiRequest(`/api/v1/editor/analysis-verification-jobs/${newest.id}`,{signal:controller.signal});}catch{}
      if(!controller.signal.aborted)setData({version,packet,detail,history});
    })().catch(()=>{if(!controller.signal.aborted)setError('Could not load saved review records.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[versionId,revision]);
  const passages=data?.packet?.passages||[];
  const citations=data?.version?.draft?.citations||[];
  const job=data?.detail?.job,report=data?.detail?.report;
  return <div className="public-reader"><div className="reader-main reader-page">
    <p><Link to="/editor/reviews">← Review queue</Link></p><h1>Review saved analysis version {versionId}</h1>
    {loading&&<p role="status">Loading draft, evidence, and report…</p>}
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setRevision(n=>n+1)}>Retry</button></p>}
    {data&&<>
      <p>Claim {data.version.version.claimId}. This editor draft and packet are private review material.</p>
      <section aria-label="Saved immutable draft"><h2>Saved draft</h2><pre className="review-json">{JSON.stringify(data.version.draft,null,2)}</pre></section>
      <section aria-label="Cited passage navigation"><h2>Cited passages and source context</h2>
        {!data.packet&&<p role="alert">Current evidence context is unavailable. Refresh before recording a decision.</p>}
        {citations.length>0&&<ul>{citations.map((citation,index)=><li key={index}><a href={`#review-passage-${citation.passageId}`} onClick={event=>openPassage(event,citation.passageId)}>Passage {citation.passageId}</a></li>)}</ul>}
        {passages.length?<ol>{passages.map(passage=><li key={passage.id} id={`review-passage-${passage.id}`} tabIndex="-1">
          <h3>Passage {passage.id} · {passage.locator||'locator unavailable'}</h3><blockquote>{passage.quote}</blockquote>
          <p>Original/extraction context: {passage.neighboringContext?.text||'Unavailable in the saved packet.'}</p>
          <p>Extraction quality: {passage.extractionQuality?.status||'unverified'}. Document {passage.document_id}.</p>
          {passage.url&&/^https?:\/\//i.test(passage.url)&&<a href={passage.url} target="_blank" rel="noopener noreferrer">Open source URL</a>}
          <p><button type="button" onClick={()=>citationReturn.current?.focus()}>Return to cited passage</button></p>
        </li>)}</ol>:<p>No reviewed passages are available in the current evidence packet.</p>}
      </section>
      <section aria-label="Verification status"><h2>Verification and cost</h2><JobGuidance job={job}/>
        <p>Exact per-analysis cost attribution is unavailable.</p>
        {report?.report&&<details><summary>Saved verification report</summary><pre className="review-json">{JSON.stringify(report.report,null,2)}</pre></details>}
      </section>
      <section aria-label="Publication history"><h2>Publication history</h2>{data.history?.items?.length?<ol>{data.history.items.map(event=><li key={event.id}>{event.action} · {new Date(event.occurredAtMs).toLocaleString()} · generation {event.generation}</li>)}</ol>:<p>{data.history?'No publication events.':'Publication history unavailable.'}</p>}</section>
      {job?.state==='done'&&report?.metadata?.id&&<PublicationReviewPanel claimId={data.version.version.claimId}
        analysisVersionId={Number(versionId)} reportId={report.metadata.id} report={report.report}/>}
    </>}
  </div></div>;
}

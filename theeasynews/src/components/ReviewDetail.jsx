import React,{useEffect,useRef,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {apiRequest} from '../api';
import PublicationReviewPanel from './PublicationReviewPanel';
import PdfPageReview from './PdfPageReview';

function SourceComparison({passage,draft}){
  const [record,setRecord]=useState(null),[extraction,setExtraction]=useState(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  const extractionId=passage.extractionQuality?.manifests?.find(item=>item.review?.status==='accepted')?.id;
  useEffect(()=>{
    const controller=new AbortController();setRecord(null);setExtraction(null);setError('');setLoading(true);
    (async()=>{
      const document=await apiRequest(`/api/v1/editor/documents/${passage.document_id}`,{signal:controller.signal});
      const detail=extractionId?await apiRequest(`/api/v1/editor/extractions/${extractionId}`,{signal:controller.signal}):null;
      if(!controller.signal.aborted){setRecord(document);setExtraction(detail);}
    })().catch(()=>{if(!controller.signal.aborted)setError('Private original or extraction context could not be loaded. Retry before reviewing this citation.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[passage.document_id,extractionId,revision]);
  const citedBlocks=(draft.blocks||[]).filter(block=>block.passageIds?.includes(passage.id));
  const citation=(draft.citations||[]).find(item=>item.passageId===passage.id);
  const sourceText=record?.source?.evidence;
  const start=passage.start_offset,end=passage.end_offset;
  const exact=typeof sourceText==='string'&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&
    start>=0&&end<=sourceText.length&&sourceText.slice(start,end)===passage.quote;
  return <section className="review-source-comparison" aria-label={`Private source comparison for passage ${passage.id}`}>
    <h4>Compare draft, extraction, and preserved original · passage {passage.id}</h4>
    {loading&&<p role="status">Loading private source context…</p>}
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setRevision(value=>value+1)}>Retry source context</button></p>}
    {record&&<>
      <p>Document: {record.source?.title||passage.document_id}. Extraction quality: {passage.extractionQuality?.status||'unverified'}.</p>
      {record.originals?.length>0&&<p>Preserved original objects: {record.originals.map(original=>
        `${original.sha256} (${original.size} bytes)`).join('; ')}.</p>}
      {!exact&&<p role="alert">The saved passage does not match the currently preserved extraction text. Resolve this before review.</p>}
      <div className="review-compare-grid">
        <div><h5>Saved draft</h5>{citedBlocks.length?citedBlocks.map((block,index)=><p key={index}><strong>{block.kind}:</strong> {block.text}</p>):<p>No draft block cites this passage.</p>}
          {citation?.quoteSpans?.length>0&&<p>Quoted spans: {citation.quoteSpans.map(span=>span.text).join(' · ')}</p>}</div>
        <div><h5>Preserved extracted text</h5><p>{exact?sourceText.slice(Math.max(0,start-300),Math.min(sourceText.length,end+300)):'Text unavailable or changed.'}</p>
          <p>Locator: {passage.locator||'not supplied'}; offsets {start}–{end} (end excluded).</p></div>
      </div>
      {extraction?<>
        <p>Extractor: {extraction.extractor_version}. Extraction review: {extraction.review?.status||'unreviewed'}.</p>
        {extraction.manifest?.quality?.warnings?.length>0&&<p>Extraction warnings: {extraction.manifest.quality.warnings.join(', ')}.</p>}
        <a href={`${process.env.REACT_APP_API_URL||''}/api/v1/editor/extractions/${extractionId}/original`} download>Download preserved original for private comparison</a>
        {extraction.manifest?.schemaVersion===2&&<PdfPageReview extractionId={extractionId} manifest={extraction.manifest} sourceText={sourceText}/>}
      </>:<p>No accepted extraction manifest is available for a preserved-original download. Compare the retained passage and source provenance before a decision.</p>}
    </>}
  </section>;
}

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
  const [selectedPassageId,setSelectedPassageId]=useState(null);
  function openPassage(event,passageId){
    const target=document.getElementById(`review-passage-${passageId}`);
    if(!target)return;
    event.preventDefault();citationReturn.current=event.currentTarget;setSelectedPassageId(passageId);
    target.scrollIntoView?.();target.focus();
  }
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!/^[1-9]\d*$/.test(versionId)){setError('Invalid analysis version.');setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError('');setData(null);setSelectedPassageId(null);
    (async()=>{
      const version=await apiRequest(`/api/v1/editor/analysis-versions/${versionId}`,{signal:controller.signal});
      const claimId=version.version.claimId;
      const results=await Promise.allSettled([
        apiRequest(`/api/v1/editor/claims/${claimId}/evidence-packet`,{signal:controller.signal}),
        apiRequest(`/api/v1/editor/analysis-versions/${versionId}/verification-jobs`,{signal:controller.signal}),
        apiRequest(`/api/v1/editor/claims/${claimId}/publication-history`,{signal:controller.signal})]);
      const [loadedPacket,jobs,history]=results.map(result=>result.status==='fulfilled'?result.value:null);
      const packet=loadedPacket?.claim?.id===claimId&&Array.isArray(loadedPacket.passages)?loadedPacket:null;
      const packetError=!packet?'Current evidence packet could not be loaded. Refresh before publication review.':'';
      const newest=jobs?.items?.at(-1)?.job;
      let detail=null;
      if(newest)try{detail=await apiRequest(`/api/v1/editor/analysis-verification-jobs/${newest.id}`,{signal:controller.signal});}catch{}
      if(!controller.signal.aborted)setData({version,packet,packetError,detail,history});
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
        {data.packetError&&<p role="alert">{data.packetError} <button type="button" onClick={()=>setRevision(value=>value+1)}>Refresh evidence context</button></p>}
        {citations.length>0&&<ul>{citations.map((citation,index)=><li key={index}><a href={`#review-passage-${citation.passageId}`} onClick={event=>openPassage(event,citation.passageId)}>Passage {citation.passageId}</a></li>)}</ul>}
        {passages.length?<ol>{passages.map(passage=><li key={passage.id} id={`review-passage-${passage.id}`} tabIndex="-1">
          <h3>Passage {passage.id} · {passage.locator||'locator unavailable'}</h3><blockquote>{passage.quote}</blockquote>
          <p>Original/extraction context: {passage.neighboringContext?.text||'Unavailable in the saved packet.'}</p>
          <p>Extraction quality: {passage.extractionQuality?.status||'unverified'}. Document {passage.document_id}.</p>
          {passage.url&&/^https?:\/\//i.test(passage.url)&&<a href={passage.url} target="_blank" rel="noopener noreferrer">Open source URL</a>}
          <p><button type="button" onClick={()=>setSelectedPassageId(passage.id)}>Compare draft, extraction, and original</button></p>
          {selectedPassageId===passage.id&&<SourceComparison passage={passage} draft={data.version.draft}/>}
          <p><button type="button" onClick={()=>citationReturn.current?.focus()}>Return to cited passage</button></p>
        </li>)}</ol>:<p>No reviewed passages are available in the current evidence packet.</p>}
      </section>
      <section aria-label="Verification status"><h2>Verification and cost</h2><JobGuidance job={job}/>
        <p>Exact per-analysis cost attribution is unavailable.</p>
        {report?.report&&<details><summary>Saved verification report</summary><pre className="review-json">{JSON.stringify(report.report,null,2)}</pre></details>}
      </section>
      <section aria-label="Publication history"><h2>Publication history</h2>{data.history?.items?.length?<ol>{data.history.items.map(event=><li key={event.id}>{event.action} · {new Date(event.occurredAtMs).toLocaleString()} · generation {event.generation}</li>)}</ol>:<p>{data.history?'No publication events.':'Publication history unavailable.'}</p>}</section>
      {data.packet&&job?.state==='done'&&report?.metadata?.id&&<PublicationReviewPanel claimId={data.version.version.claimId}
        analysisVersionId={Number(versionId)} reportId={report.metadata.id} report={report.report}/>}
    </>}
  </div></div>;
}

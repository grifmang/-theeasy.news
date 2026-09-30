import React, {useEffect, useState} from 'react';
import {apiRequest} from '../api';
import './ResearchDesk.css';
import ResearchCreateForm from './ResearchCreateForm';
import ClaimResearchPanel from './ClaimResearchPanel';
import RetrievalRunPanel from './RetrievalRunPanel';
import PassageEditor from './PassageEditor';
import SourceChainForm from './SourceChainForm';
import DocumentImportForm from './DocumentImportForm';
import EvidenceReview from './EvidenceReview';
import ClaimContextForm from './ClaimContextForm';
import ProviderPermissionForm from './ProviderPermissionForm';
import FetchSourceForm from './FetchSourceForm';
import FetchExtraction from './FetchExtraction';
import ExtractionReview from './ExtractionReview';
import BudgetPanel from './BudgetPanel';
import AnalysisVerificationPanel from './AnalysisVerificationPanel';

function errorMessage(error) {
  if(error.status===403) return 'Editor access is required. Ask an operator to review your account permissions.';
  if(error.status===401) return 'Your session has expired. Sign in again to continue.';
  return 'Could not load this research record. Retry to check the connection.';
}

function useRecord(path) {
  const [record,setRecord]=useState(null);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setRecord(null);setError('');
    apiRequest(path,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted) setRecord(data);
    }).catch(reason=>{if(!controller.signal.aborted) setError(errorMessage(reason));});
    return ()=>controller.abort();
  },[path,revision]);
  return {record,error,reload:()=>setRevision(value=>value+1)};
}

function Failure({message,retry}) {
  return <div><p role="alert">{message}</p><button onClick={retry}>Retry</button></div>;
}

// Each list is keyed by its parent record: changing topics discards both cursor
// and selection. Abort checks also reject responses arriving after navigation.
function RecordList({path,label,onSelect,describe,selected}) {
  const [items,setItems]=useState([]);
  const [cursor,setCursor]=useState(null);
  const [more,setMore]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    apiRequest(`${path}${cursor===null?'':`?after=${cursor}`}`,{signal:controller.signal}).then(data=>{
      if(controller.signal.aborted) return;
      setItems(previous=>cursor===null?data.items:[...previous,...data.items]);
      setMore(data.items.length===100);setLoading(false);
    }).catch(reason=>{
      if(!controller.signal.aborted) {setError(errorMessage(reason));setLoading(false);}
    });
    return ()=>controller.abort();
  },[path,cursor,revision]);
  return <section aria-label={label}>
    <h2>{label}</h2>
    {items.length>0 && <ul className="research-list">{items.map(item=><li key={item.id}>
      <button aria-pressed={selected===item.id} onClick={()=>onSelect(item)}>{describe(item)}</button>
    </li>)}</ul>}
    {loading && <p role="status">Loading {label.toLowerCase()}...</p>}
    {error && <Failure message={error} retry={()=>setRevision(value=>value+1)}/>}
    {!loading && !error && items.length===0 && <p>No {label.toLowerCase()} yet.</p>}
    {!loading && !error && more && <button onClick={()=>setCursor(items[items.length-1].id)}>Load more {label.toLowerCase()}</button>}
  </section>;
}

function SourceLink({url,children}) {
  // Imported URLs are untrusted even inside an authenticated workspace.
  let safe=false;
  try {safe=['http:','https:'].includes(new URL(url).protocol);} catch {}
  return safe?<a href={url} target="_blank" rel="noopener noreferrer">{children}</a>:<span>Source URL unavailable</span>;
}

function JsonDetails({label,value}) {
  return <details><summary>{label}</summary><pre>{JSON.stringify(value,null,2)}</pre></details>;
}

function JobView({id}) {
  const {record,error,reload}=useRecord(`/api/v1/editor/jobs/${id}`);
  if(error) return <Failure message={error} retry={reload}/>;
  if(!record) return <p role="status">Loading job...</p>;
  return <section className="research-decision" aria-label="Model recommendation">
    <h3>Job {id}: model recommendation</h3>
    <p>This is not a truth verdict or publication approval. Confidence is a model score, not verified accuracy.</p>
    <p>Provider disclosure: {record.permission.allowed?'Allowed':'Not allowed'}. {record.permission.reason}</p>
    <button onClick={reload}>Refresh job</button>
    <JsonDetails label="Inspect prepared model input" value={record.input}/>
    <ProviderPermissionForm key={`${record.permission.eventId}-${record.permission.inputHash}`} job={record.job} permission={record.permission} onChanged={reload}/>
    {record.decision ? <>
      {record.decision.currentEligibilityIssue && <p role="alert">This decision is no longer eligible: {record.decision.currentEligibilityIssue}</p>}
      <h4>Saved JEV response</h4><pre>{JSON.stringify(record.decision.result,null,2)}</pre>
      <JsonDetails label="Routing and audit metadata" value={{id:record.decision.id,reservationId:record.decision.reservationId,
        inputHash:record.decision.inputHash,policyVersion:record.decision.policyVersion,
        createdAt:record.decision.createdAt,routing:record.decision.routing}}/>
    </> : <p>No saved model decision. Browsing does not start a model call.</p>}
  </section>;
}

function ClaimView({id,topicId}) {
  const {record,error,reload}=useRecord(`/api/v1/editor/claims/${id}`);
  const [job,setJob]=useState(null);
  const [assessmentRevision,setAssessmentRevision]=useState(0);
  const [assessment,setAssessment]=useState(null);
  const [jobRevision,setJobRevision]=useState(0);
  function reloadContext() {setAssessment(null);setJob(null);reload();}
  if(error) return <Failure message={error} retry={reload}/>;
  if(!record) return <p role="status">Loading claim...</p>;
  return <article>
    <h2>Claim as recorded</h2><blockquote>{record.claim.wording}</blockquote>
    <dl><dt>Attributed to</dt><dd>{record.claim.attribution}</dd>
      <dt>Review status</dt><dd>{record.state.status}{record.state.restricted?' (restricted)':''}</dd></dl>
    <SourceLink url={record.claim.origin_url}>Open claim origin</SourceLink>
    {record.context ? <JsonDetails label="Current claim context" value={record.context}/> : <p>No context version has been recorded.</p>}
    <ClaimResearchPanel claimId={id} record={record} onChanged={reloadContext}/>
    <AnalysisVerificationPanel key={`analysis-${id}`} claimId={id}/>
    <RetrievalRunPanel claimId={id} contextVersionId={record.context?.id ?? null} onReload={reloadContext}/>
    {record.state.status!=='superseded' && <ClaimContextForm key={record.context?.id ?? 'original'} claim={record.claim} context={record.context} onSaved={reloadContext}/>}
    <EvidenceReview claimId={id} topicId={topicId} contextVersionId={record.context?.id ?? null}
      onSaved={()=>setAssessmentRevision(value=>value+1)} onReload={reloadContext}
      onJobPrepared={prepared=>{setJobRevision(value=>value+1);setJob(prepared.id);}}/>
    <RecordList key={assessmentRevision} path={`/api/v1/editor/claims/${id}/assessments`} label="Human assessments"
      selected={assessment?.id} onSelect={setAssessment}
      describe={item=>`Assessment ${item.id} — passage ${item.passage_id} — ${item.relation}${item.stale?' (stale context)':''}`}/>
    {assessment && <section aria-label="Assessment history detail"><h3>Human assessment {assessment.id}</h3>
      <p>Reviewer account: {assessment.actor_id}. {assessment.stale?'Stale context: do not apply to the current claim.':'Matches the loaded claim context.'}</p>
      <p>{assessment.relevance} / {assessment.relation} / {assessment.evidence_type}</p><p>{assessment.rationale}</p></section>}
    <RecordList key={jobRevision} path={`/api/v1/editor/claims/${id}/jobs`} label="Classification jobs" selected={job}
      onSelect={item=>setJob(item.id)} describe={item=>`Job ${item.id} — ${item.state || item.status} — ${item.model}`}/>
    {job && <JobView key={job} id={job}/>}
  </article>;
}

function DocumentView({id}) {
  const {record,error,reload}=useRecord(`/api/v1/editor/documents/${id}`);
  const [passageRevision,setPassageRevision]=useState(0);
  if(error) return <Failure message={error} retry={reload}/>;
  if(!record) return <p role="status">Loading source...</p>;
  const sourceChain=record.sourceChain || {documentId:Number(id),legacyOriginChain:record.document.origin_chain,
    parentDocumentIds:[],ancestorDocumentIds:[],rootDocumentIds:[Number(id)],links:[]};
  return <article>
    <h2>{record.source.title}</h2>
    <p>{record.source.source} / {record.document.kind}</p>
    <p>Document ID: {id}</p>
    <SourceLink url={record.source.url}>Open source</SourceLink>
    <p>Publication date: {record.source.published_at || 'Unknown'}</p>
    <section aria-labelledby={`source-chain-${id}`}><h3 id={`source-chain-${id}`}>Source-chain provenance</h3>
      <p>Legacy group: {sourceChain.legacyOriginChain}. Audited parent documents: {sourceChain.parentDocumentIds.join(', ') || 'none recorded'}.</p>
      <p>Root documents: {sourceChain.rootDocumentIds.join(', ')}. These links identify derivation; they do not prove source independence.</p>
      <JsonDetails label="Source-chain audit record" value={sourceChain}/>
      <SourceChainForm documentId={Number(id)} onSaved={reload}/>
    </section>
    <ExtractionReview extractions={record.extractions} sourceText={record.source.evidence}/>
    <h3>Preserved source text</h3>
    <PassageEditor documentId={id} text={record.source.evidence} onSaved={()=>setPassageRevision(value=>value+1)}/>
    <JsonDetails label="Original objects and retrieval history" value={{originals:record.originals,retrievals:record.retrievals}}/>
    <Passages key={passageRevision} id={id}/>
  </article>;
}

function Passages({id}) {
  const [selected,setSelected]=useState(null);
  return <><RecordList path={`/api/v1/editor/documents/${id}/passages`} label="Passages"
    selected={selected?.id} onSelect={setSelected} describe={item=>item.quote}/>
    {selected && <p>Locator: {selected.locator || 'Not supplied'}</p>}</>;
}

function FetchView({id,onExtracted,onRefresh}) {
  const {record,error,reload}=useRecord(`/api/v1/editor/fetch-jobs/${id}`);
  if(error) return <Failure message={error} retry={reload}/>;
  if(!record) return <p role="status">Loading fetch receipt...</p>;
  return <section aria-label="Fetched source record">
    <h2>Source retrieval {id}</h2>
    <p>Download status: {record.job.state}</p>
    <p>A download receipt is not a factual assessment or publication approval.</p>
    <SourceLink url={record.job.url}>Open requested source</SourceLink>
    <p><button onClick={()=>{reload();onRefresh();}}>Refresh retrieval</button></p>
    {record.job.last_error&&<p>Last retrieval issue: {record.job.last_error}</p>}
    {record.receipt?<JsonDetails label="Inspect retrieval provenance" value={record.receipt}/>:<p>No completed retrieval yet.</p>}
    <FetchExtraction jobId={id} receipt={record.receipt} extractionAvailable={record.extractionAvailable} onSaved={onExtracted}/>
  </section>;
}

function TopicView({topic}) {
  const [selection,setSelection]=useState(null);
  const [claimRevision,setClaimRevision]=useState(0);
  const [documentRevision,setDocumentRevision]=useState(0);
  const [fetchRevision,setFetchRevision]=useState(0);
  return <><h2 className="research-topic-title">{topic.title}</h2><div className="research-columns">
    <div className="research-index">
      <ResearchCreateForm kind="claim" topicId={topic.id} onSaved={record=>{
        setClaimRevision(value=>value+1);setSelection({type:'claim',id:record.id});
      }}/>
      <RecordList key={`claims-${claimRevision}`} path={`/api/v1/editor/topics/${topic.id}/claims`} label="Claims"
        selected={selection?.type==='claim'?selection.id:null}
        onSelect={item=>setSelection({type:'claim',id:item.id})} describe={item=>item.wording}/>
      <DocumentImportForm topicId={topic.id} onSaved={record=>{
        setDocumentRevision(value=>value+1);setSelection({type:'document',id:record.id});
      }}/>
      <details><summary>Fetch an approved source URL</summary>
        <FetchSourceForm topicId={topic.id} onSaved={job=>{setFetchRevision(value=>value+1);setSelection({type:'fetch',id:job.id});}}/>
      </details>
      <RecordList key={`fetch-${fetchRevision}`} path={`/api/v1/editor/topics/${topic.id}/fetch-jobs`} label="Fetch jobs"
        selected={selection?.type==='fetch'?selection.id:null}
        onSelect={item=>setSelection({type:'fetch',id:item.id})} describe={item=>`Fetch ${item.id} — ${item.state} — ${item.url}`}/>
      <RecordList key={`documents-${documentRevision}`} path={`/api/v1/editor/topics/${topic.id}/documents`} label="Documents"
        selected={selection?.type==='document'?selection.id:null}
        onSelect={item=>setSelection({type:'document',id:item.id})} describe={item=>item.title}/>
    </div>
    <div className="research-reading" aria-label="Research record">
      {!selection ? <p>Select a claim or document to inspect its record.</p> : selection.type==='claim'
        ? <ClaimView key={`claim-${selection.id}`} id={selection.id} topicId={topic.id}/>
        : selection.type==='fetch'?<FetchView key={`fetch-${selection.id}`} id={selection.id} onRefresh={()=>setFetchRevision(value=>value+1)} onExtracted={document=>{
          setFetchRevision(value=>value+1);setDocumentRevision(value=>value+1);setSelection({type:'document',id:document.id});
        }}/>
        : <DocumentView key={`document-${selection.id}`} id={selection.id}/>}
    </div>
  </div></>;
}

export default function ResearchDesk() {
  const [topic,setTopic]=useState(null);
  const [topicRevision,setTopicRevision]=useState(0);
  return <div className="research-desk">
    <header><h1>Research desk</h1><p>Trace a claim back to its evidence.</p>
      <p>Private editor workspace. An allegation is not a finding; an archived copy is not independent corroboration.</p></header>
    <BudgetPanel />
    <ResearchCreateForm kind="topic" onSaved={record=>{setTopicRevision(value=>value+1);setTopic(record);}}/>
    <RecordList key={topicRevision} path="/api/v1/editor/topics" label="Topics" selected={topic?.id} onSelect={setTopic} describe={item=>item.title}/>
    {topic ? <TopicView key={topic.id} topic={topic}/> : <p>Choose a topic to inspect claims, source documents, and saved classification decisions.</p>}
  </div>;
}

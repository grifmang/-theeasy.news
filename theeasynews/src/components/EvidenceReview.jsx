import React,{useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';

const questions=[
  ['relevance','Relevance',[['direct','Direct'],['background','Background'],['unrelated','Unrelated'],['uncertain','Uncertain']]],
  ['relation','Relation to claim',[['supports','Supports'],['contradicts','Contradicts'],['mentions_only','Mentions only'],['insufficient','Insufficient']]],
  ['evidenceType','Evidence type',[['mention','Mention'],['allegation','Allegation'],['testimony','Testimony'],['finding','Finding'],['other','Other'],['uncertain','Uncertain']]]
];

function AssessmentForm({claimId,contextVersionId,passage,onSaved,onReload,onJobPrepared}) {
  const prefix=useId();
  const [values,setValues]=useState({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [stale,setStale]=useState(false);
  const [saved,setSaved]=useState(null);
  const [document,setDocument]=useState(null);
  const [documentError,setDocumentError]=useState('');
  const [documentRevision,setDocumentRevision]=useState(0);
  const pending=useRef(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  useEffect(()=>{
    const controller=new AbortController();setDocument(null);setDocumentError('');
    apiRequest(`/api/v1/editor/documents/${passage.document_id}`,{signal:controller.signal}).then(record=>{
      if(controller.signal.aborted) return;
      const text=record.source?.evidence;
      if(record.document?.id!==passage.document_id || typeof text!=='string' ||
        !Number.isInteger(passage.start_offset) || !Number.isInteger(passage.end_offset) ||
        passage.start_offset<0 || passage.end_offset<=passage.start_offset || passage.end_offset>text.length ||
        text.slice(passage.start_offset,passage.end_offset)!==passage.quote) {
        setDocumentError('The passage does not match the preserved document. Reload the claim and investigate before assessing.');return;
      }
      setDocument(record);
    }).catch(()=>{if(!controller.signal.aborted) setDocumentError('Could not load the preserved document. Assessment is disabled until its text can be checked.');});
    return ()=>controller.abort();
  },[passage.document_id,passage.start_offset,passage.end_offset,passage.quote,documentRevision]);
  async function prepareJob() {
    if(pending.current || stale || !document) return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try {
      const job=await apiRequest(`/api/v1/editor/claims/${claimId}/jobs`,{method:'POST',signal:controller.signal,
        body:{passageId:passage.id,contextVersionId}});
      if(!controller.signal.aborted) onJobPrepared(job);
    } catch(failure) {
      if(!controller.signal.aborted) setError('Could not prepare or confirm this job. Refresh the claim and check its existing jobs before retrying.');
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }
  async function submit(event) {
    event.preventDefault();
    if(pending.current || stale || !document || !values.rationale?.trim() || questions.some(([key])=>!values[key])) return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setSaved(null);
    try {
      const result=await apiRequest(`/api/v1/editor/claims/${claimId}/assessments`,{method:'POST',signal:controller.signal,
        body:{...values,passageId:passage.id,expectedVersionId:contextVersionId}});
      if(controller.signal.aborted) return;
      setSaved(result.id);onSaved();
    } catch(reason) {
      if(controller.signal.aborted) return;
      setStale(reason.status===409);
      setError(reason.status===409?'The claim context changed. Reload and review it before submitting again.':
        reason.status===401?'Session expired. Sign in again.':reason.status===403?'Editor access is required.':
        'Could not save or confirm the assessment. Input retained; check assessment history before retrying.');
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }
  return <section aria-label="Human passage assessment">
    <h3>Review passage {passage.id}</h3>
    <p>{passage.title} / {passage.source} / {passage.kind}</p>
    <blockquote>{passage.quote}</blockquote>
    <p>Locator: {passage.locator}. Originating chain: {passage.origin_chain}.</p>
    <p>Read the full document and surrounding context before judging this passage. An allegation or mention is not a finding.</p>
    {!document && !documentError && <p role="status">Checking passage against its preserved document...</p>}
    {documentError && <><p role="alert">{documentError}</p><button onClick={()=>setDocumentRevision(value=>value+1)}>Retry document check</button></>}
    {document && <details open><summary>Full preserved document, with selected passage highlighted</summary>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- This bounded overflow region must be focusable for keyboard scrolling. */}
      <div className="research-source" role="region" aria-label="Full preserved document" tabIndex={0}>
        {document.source.evidence.slice(0,passage.start_offset)}<mark>{passage.quote}</mark>{document.source.evidence.slice(passage.end_offset)}
      </div></details>}
    <p>Prepare a JEV job to inspect its input. This does not grant provider permission; an existing job retains its existing permission.</p>
    <button disabled={busy || stale || !document} onClick={prepareJob}>Prepare JEV classification</button>
    <form onSubmit={submit}><fieldset disabled={busy || stale || !document}><legend>Your assessment</legend>
      {questions.map(([key,label,options])=><div className="research-field" key={key}>
        <label htmlFor={`${prefix}-${key}`}>{label}</label>
        <select id={`${prefix}-${key}`} required value={values[key]||''} onChange={event=>setValues(previous=>({...previous,[key]:event.target.value}))}>
          <option value="">Choose a label</option>{options.map(([value,name])=><option key={value} value={value}>{name}</option>)}
        </select>
      </div>)}
      <div className="research-field"><label htmlFor={`${prefix}-rationale`}>Assessment rationale</label>
        <textarea id={`${prefix}-rationale`} rows={4} required maxLength={8000} value={values.rationale||''}
          onChange={event=>setValues(previous=>({...previous,rationale:event.target.value}))}/></div>
      <button type="submit">{busy?'Saving...':'Save human assessment'}</button>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}
    {stale && <button onClick={onReload}>Reload claim context</button>}
    {saved && <p role="status">Human assessment {saved} saved. This does not approve the claim or publication.</p>}
  </section>;
}

export default function EvidenceReview({claimId,topicId,contextVersionId,onSaved,onReload,onJobPrepared}) {
  const prefix=useId();
  const [query,setQuery]=useState('');
  const [results,setResults]=useState(null);
  const [selected,setSelected]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const pending=useRef(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function search(event) {
    event.preventDefault();if(!query.trim()) return;
    pending.current?.abort();const controller=new AbortController();pending.current=controller;
    setBusy(true);setError('');setResults(null);setSelected(null);
    try {
      const result=await apiRequest(`/api/v1/editor/topics/${topicId}/search?q=${encodeURIComponent(query)}&limit=30`,{signal:controller.signal});
      if(!controller.signal.aborted) setResults(result);
    } catch(reason) {
      if(!controller.signal.aborted) setError(reason.status===400?'Use up to 30 search terms.':
        reason.status===401?'Session expired. Sign in again.':reason.status===403?'Editor access is required.':'Search failed. Try again.');
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }
  return <section aria-label="Find claim evidence">
    <h3>Find evidence in this topic</h3>
    <p>Search is lexical, not a relevance judgment. Search for counterevidence too; no matches does not mean a claim is false.</p>
    <form onSubmit={search}><div className="research-field"><label htmlFor={`${prefix}-query`}>Search saved passages</label>
      <input id={`${prefix}-query`} required maxLength={500} value={query} onChange={event=>setQuery(event.target.value)}/></div>
      <button disabled={busy} type="submit">{busy?'Searching...':'Find passages'}</button></form>
    {error && <p role="alert">{error}</p>}
    {results && <><p>{results.items.length} candidates for “{results.query}” (up to 30). This is not an exhaustive search.</p>
      <ul className="research-list">{results.items.map(passage=><li key={passage.id}>
        <button aria-pressed={selected?.id===passage.id} onClick={()=>setSelected(passage)}>Review passage {passage.id}: {passage.title} — {passage.locator}</button>
      </li>)}</ul></>}
    {selected && <AssessmentForm key={`${selected.id}-${contextVersionId}`} claimId={claimId} contextVersionId={contextVersionId}
      passage={selected} onSaved={onSaved} onReload={onReload} onJobPrepared={onJobPrepared}/>}
  </section>;
}

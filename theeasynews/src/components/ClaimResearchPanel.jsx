import React, {useEffect, useId, useRef, useState} from 'react';
import {apiRequest} from '../api';

const dimensions=['origin','context','support','counterevidence','source_independence','identity'];
const dimensionLabels={origin:'Origin',context:'Context',support:'Support',counterevidence:'Counterevidence',source_independence:'Source independence',identity:'Identity'};
const coverageStates=['unknown','needs_work','reviewed','disputed','inaccessible','deferred'];
function requestId() {
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`;
}
function errorText(error) {
  if(error.status===404) return 'This research action is not supported by the current API version.';
  if(error.status===403) return 'Editor access is required to record research.';
  if(error.status===401) return 'Your session expired. Sign in again before saving.';
  return error.message || 'Could not save this research record. Your entries are retained.';
}

export default function ClaimResearchPanel({claimId,record,onChanged}) {
  const prefix=useId();
  const [research,setResearch]=useState(record.research||null);
  const [fallback,setFallback]=useState({state:record.research?'ready':'loading',message:''});
  const [fallbackRevision,setFallbackRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [relationship,setRelationship]=useState({otherClaimId:'',type:'related',reason:''});
  const [attempt,setAttempt]=useState({query:'',sourceUrl:'',outcome:'results',note:''});
  const [coverage,setCoverage]=useState({dimension:'origin',state:'needs_work',reason:''});
  const [actionReason,setActionReason]=useState({});
  const [corrections,setCorrections]=useState({});
  const requestIds=useRef(new Map());

  useEffect(()=>{
    if(record.research) {
      setResearch(record.research);
      setFallback({state:'ready',message:''});
      return;
    }
    setResearch(null);
    setFallback({state:'loading',message:''});
    const controller=new AbortController();
    Promise.all([
      apiRequest(`/api/v1/editor/claims/${claimId}/relationships`,{signal:controller.signal}),
      apiRequest(`/api/v1/editor/claims/${claimId}/search-attempts`,{signal:controller.signal}),
      apiRequest(`/api/v1/editor/claims/${claimId}/coverage-events`,{signal:controller.signal})
    ]).then(([relationships,attempts,events])=>{
      if(controller.signal.aborted) return;
      const coverageByDimension=Object.fromEntries(dimensions.map(dimension=>{
        const event=[...events.items].reverse().find(item=>item.dimension===dimension);
        return [dimension,event?{...event,state:event.state}:{dimension,state:'unknown',id:null,contextVersionId:record.context?.id??null}];
      }));
      setResearch({relationships:relationships.items.filter(item=>item.active),relationshipHistory:relationships.items,
        searchAttempts:attempts.items,searchOutcomes:attempts.items.reduce((summary,item)=>({...summary,[item.outcome]:(summary[item.outcome]||0)+1}),{}),coverage:coverageByDimension});
      setFallback({state:'ready',message:''});
    }).catch(reason=>{
      if(controller.signal.aborted) return;
      setFallback({state:reason.status===404?'unsupported':'error',message:reason.message||'Research history is not available.'});
    });
    return ()=>controller.abort();
  },[claimId,record.research,record.context?.id,fallbackRevision]);

  async function submit(path,body,successText) {
    if(busy) return;
    setBusy(true);setError('');setNotice('');
    const signature=JSON.stringify(body);
    const prior=requestIds.current.get(path);
    const id=prior?.signature===signature?prior.id:requestId();
    requestIds.current.set(path,{signature,id});
    try {
      await apiRequest(path,{method:'POST',body:{...body,requestId:id}});
      if(requestIds.current.get(path)?.signature===signature) requestIds.current.delete(path);
      setNotice(successText);
      await onChanged();
    } catch(reason) {
      if(reason.status && reason.status<500 && reason.status!==408 && reason.status!==429 && requestIds.current.get(path)?.signature===signature) {
        requestIds.current.delete(path);
      }
      setError(errorText(reason));
    }
    finally {setBusy(false);}
  }

  return <section className="claim-research" aria-labelledby={`${prefix}-heading`}>
    <h2 id={`${prefix}-heading`}>Research ledger</h2>
    <p>Research entries describe work and coverage. They do not establish truth, source independence, or publication readiness.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {fallback.state==='loading'&&<p role="status">Loading claim research history…</p>}
    {fallback.state==='unsupported'&&<div role="status"><p>Claim research history is not supported by this API version.</p><button type="button" onClick={()=>setFallbackRevision(value=>value+1)}>Retry loading research history</button></div>}
    {fallback.state==='error'&&<div><p role="alert">Could not load claim research history: {fallback.message}</p><button type="button" onClick={()=>setFallbackRevision(value=>value+1)}>Retry loading research history</button></div>}
    {research&&<>
      <section aria-labelledby={`${prefix}-coverage`}>
        <h3 id={`${prefix}-coverage`}>Coverage dimensions</h3>
        <ul className="claim-coverage">{dimensions.map(dimension=>{
          const item=research.coverage?.[dimension]||{state:'unknown'};
          const stale=item.staleEventId!==undefined;
          return <li key={dimension}><strong>{dimensionLabels[dimension]}</strong>
            <span>{stale?`Stale — previously ${item.staleState}; current state unknown`:item.state==='unknown'?'Unknown':item.state.replaceAll('_',' ')}</span>
            {item.reason&&<small>{item.reason}</small>}
          </li>;
        })}</ul>
      </section>
      <details><summary>Record a coverage update</summary>
        <form onSubmit={event=>{event.preventDefault();const current=research.coverage?.[coverage.dimension];
          submit(`/api/v1/editor/claims/${claimId}/coverage-events`,{...coverage,expectedEventId:current?.id??null,
            expectedContextVersionId:record.context?.id??null},'Coverage update recorded.');}}>
          <fieldset disabled={busy}><legend>Append coverage event</legend>
            <div className="research-field"><label htmlFor={`${prefix}-dimension`}>Dimension</label><select id={`${prefix}-dimension`} value={coverage.dimension} onChange={event=>setCoverage(value=>({...value,dimension:event.target.value}))}>{dimensions.map(item=><option key={item} value={item}>{dimensionLabels[item]}</option>)}</select></div>
            <div className="research-field"><label htmlFor={`${prefix}-coverage-state`}>State</label><select id={`${prefix}-coverage-state`} value={coverage.state} onChange={event=>setCoverage(value=>({...value,state:event.target.value}))}>{coverageStates.map(item=><option key={item} value={item}>{item.replaceAll('_',' ')}</option>)}</select></div>
            <div className="research-field"><label htmlFor={`${prefix}-coverage-reason`}>Reason for this state</label><textarea id={`${prefix}-coverage-reason`} required maxLength={8000} value={coverage.reason} onChange={event=>setCoverage(value=>({...value,reason:event.target.value}))}/></div>
            <p>The save binds to the currently loaded coverage event and context version. A concurrent change will be reported for review.</p>
            <button type="submit">Append coverage event</button>
          </fieldset>
        </form>
      </details>
      <details><summary>Search attempt history ({research.searchAttempts?.length||0})</summary>
        <ul className="claim-ledger-list">{(research.searchAttempts||[]).map(item=><li key={item.id}><strong>{item.outcome.replaceAll('_',' ')}</strong> — {item.query}
          {item.source_url&&<> — <a href={item.source_url} target="_blank" rel="noopener noreferrer">source URL</a></>}
          <p>{item.note}</p><small>Recorded {item.created_at}</small>
        </li>)}</ul>
        {(research.searchAttempts||[]).length===0&&<p>No search attempts recorded.</p>}
        <form onSubmit={event=>{event.preventDefault();submit(`/api/v1/editor/claims/${claimId}/search-attempts`,{...attempt,sourceUrl:attempt.sourceUrl.trim()||null},'Search attempt recorded.');}}>
          <fieldset disabled={busy}><legend>Record a search attempt</legend>
            <div className="research-field"><label htmlFor={`${prefix}-query`}>Search query</label><input id={`${prefix}-query`} required maxLength={2000} value={attempt.query} onChange={event=>setAttempt(value=>({...value,query:event.target.value}))}/></div>
            <div className="research-field"><label htmlFor={`${prefix}-attempt-outcome`}>Outcome</label><select id={`${prefix}-attempt-outcome`} value={attempt.outcome} onChange={event=>setAttempt(value=>({...value,outcome:event.target.value}))}><option value="results">Results found</option><option value="no_results">No results</option><option value="inaccessible">Source inaccessible</option><option value="deferred">Deferred</option></select></div>
            <div className="research-field"><label htmlFor={`${prefix}-source-url`}>Source URL (optional)</label><input id={`${prefix}-source-url`} type="url" maxLength={2048} value={attempt.sourceUrl} onChange={event=>setAttempt(value=>({...value,sourceUrl:event.target.value}))}/></div>
            <div className="research-field"><label htmlFor={`${prefix}-attempt-note`}>Notes</label><textarea id={`${prefix}-attempt-note`} required maxLength={8000} value={attempt.note} onChange={event=>setAttempt(value=>({...value,note:event.target.value}))}/></div>
            <button type="submit">Append search attempt</button>
          </fieldset>
        </form>
      </details>
      <details><summary>Claim relationships ({research.relationshipHistory?.length||0} recorded)</summary>
        <ul className="claim-ledger-list">{(research.relationshipHistory||[]).map(item=>{
          const other=item.claim_id===Number(claimId)?item.other_claim_id:item.claim_id;
          const stale=item.inactiveReason==='stale_review';
          return <li key={item.id}><strong>{item.type.replaceAll('_',' ')}</strong> — Claim {other} — {item.active?'Active':stale?'Stale after review change':`Inactive (${item.inactiveReason})`}
            <p>{item.reason}</p>{item.revocation_reason&&<p>Correction history: {item.revocation_reason}</p>}
            {item.active&&<details><summary>Revoke or correct this relationship</summary>
              <div className="research-field"><label htmlFor={`${prefix}-relationship-reason-${item.id}`}>Reason for change</label><textarea id={`${prefix}-relationship-reason-${item.id}`} required value={actionReason[item.id]||''} onChange={event=>setActionReason(value=>({...value,[item.id]:event.target.value}))}/></div>
              <button type="button" disabled={busy||!actionReason[item.id]?.trim()} onClick={()=>submit(`/api/v1/editor/claims/${claimId}/relationships/${item.id}/revoke`,{reason:actionReason[item.id]},'Relationship revoked; its history is retained.')}>Revoke relationship</button>
              <details><summary>Append a corrected relationship</summary>
                <div className="research-field"><label htmlFor={`${prefix}-correct-other-${item.id}`}>Other claim ID</label><input id={`${prefix}-correct-other-${item.id}`} type="number" min="1" value={corrections[item.id]?.otherClaimId??other} onChange={event=>setCorrections(value=>({...value,[item.id]:{...value[item.id],otherClaimId:event.target.value}}))}/></div>
                <div className="research-field"><label htmlFor={`${prefix}-correct-type-${item.id}`}>Relationship</label><select id={`${prefix}-correct-type-${item.id}`} value={corrections[item.id]?.type??item.type} onChange={event=>setCorrections(value=>({...value,[item.id]:{...value[item.id],type:event.target.value}}))}><option value="related">Related</option><option value="duplicate">Duplicate</option><option value="component_of">Component of</option></select></div>
                <button type="button" disabled={busy||!actionReason[item.id]?.trim()} onClick={()=>submit(`/api/v1/editor/claims/${claimId}/relationships/${item.id}/correct`,{otherClaimId:Number(corrections[item.id]?.otherClaimId??other),type:corrections[item.id]?.type??item.type,reason:actionReason[item.id]},'Relationship correction recorded with history.')}>Record correction</button>
              </details>
            </details>}
          </li>;
        })}</ul>
        {(research.relationshipHistory||[]).length===0&&<p>No claim relationships recorded.</p>}
        <form onSubmit={event=>{event.preventDefault();submit(`/api/v1/editor/claims/${claimId}/relationships`,{...relationship,otherClaimId:Number(relationship.otherClaimId)},'Relationship recorded.');}}>
          <fieldset disabled={busy}><legend>Append claim relationship</legend>
            <div className="research-field"><label htmlFor={`${prefix}-other-claim`}>Other claim ID</label><input id={`${prefix}-other-claim`} type="number" min="1" required value={relationship.otherClaimId} onChange={event=>setRelationship(value=>({...value,otherClaimId:event.target.value}))}/></div>
            <div className="research-field"><label htmlFor={`${prefix}-relation-type`}>Relationship type</label><select id={`${prefix}-relation-type`} value={relationship.type} onChange={event=>setRelationship(value=>({...value,type:event.target.value}))}><option value="related">Related</option><option value="duplicate">Duplicate</option><option value="component_of">Component of</option></select></div>
            <div className="research-field"><label htmlFor={`${prefix}-relationship-note`}>Reason for the link</label><textarea id={`${prefix}-relationship-note`} required maxLength={8000} value={relationship.reason} onChange={event=>setRelationship(value=>({...value,reason:event.target.value}))}/></div>
            <button type="submit">Append relationship</button>
          </fieldset>
        </form>
        <p>Links organize claims. They do not establish matching identities or combine claim records.</p>
      </details>
    </>}
  </section>;
}

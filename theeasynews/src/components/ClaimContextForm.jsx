import React,{useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';

const fields=[['normalizedWording','Normalized wording',4000],['timeframe','Claim timeframe',1000],
  ['location','Claim location',1000],['observedAt','Observed at (UTC, optional)',24],['reason','Reason for context change',8000]];

export default function ClaimContextForm({claim,context,onSaved}) {
  const prefix=useId();
  const [values,setValues]=useState(()=>({normalizedWording:context?.normalizedWording || claim.wording,
    timeframe:context?.timeframe || '',location:context?.location || '',observedAt:context?.observedAt || '',reason:''}));
  const [entities,setEntities]=useState(()=>context?.entities?.map(entity=>({...entity,identifier:entity.identifier||''})) || []);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [conflict,setConflict]=useState(false);
  const pending=useRef(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function submit(event) {
    event.preventDefault();if(pending.current || conflict) return;
    setError('');
    if(fields.some(([key])=>key!=='observedAt' && !values[key].trim()) || entities.some(entity=>!entity.name.trim())) {
      setError('Complete the required fields and each entity name. State unknown scope explicitly instead of guessing.');return;
    }
    if(values.observedAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(values.observedAt) ||
      !Number.isFinite(Date.parse(values.observedAt)) || new Date(values.observedAt).toISOString()!==values.observedAt)) {
      setError('Use an exact UTC timestamp or leave the unknown observation date blank.');return;
    }
    const controller=new AbortController();pending.current=controller;setBusy(true);
    try {
      await apiRequest(`/api/v1/editor/claims/${claim.id}/context`,{method:'POST',signal:controller.signal,
        body:{...values,expectedVersionId:context?.id ?? null,observedAt:values.observedAt || null,
          entities:entities.map(entity=>({name:entity.name,identifier:entity.identifier.trim() || null}))}});
      if(!controller.signal.aborted) onSaved();
    } catch(reason) {
      if(controller.signal.aborted) return;
      setConflict(reason.status===409);
      setError(reason.status===409?'The claim changed. Copy any edits you need, then reload the current version before continuing.':
        reason.status===401?'Session expired. Sign in again.':reason.status===403?'Editor access is required.':
        'Could not save or confirm this context. Input retained; check the current version before retrying.');
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }
  return <details className="research-create"><summary>Edit claim context</summary>
    <p>Preserve the original meaning, quantifiers and uncertainty. A new version resets review and makes earlier assessments stale; it does not overwrite the original claim.</p>
    <form onSubmit={submit}><fieldset disabled={busy || conflict}><legend>New context version</legend>
      {fields.map(([key,label,limit])=><div className="research-field" key={key}>
        <label htmlFor={`${prefix}-${key}`}>{label}</label>
        <textarea id={`${prefix}-${key}`} rows={key==='normalizedWording'||key==='reason'?3:1} maxLength={limit}
          required={key!=='observedAt'} value={values[key]} onChange={event=>setValues(previous=>({...previous,[key]:event.target.value}))}/>
      </div>)}
      <p>Entity identifiers are optional. A matching name alone does not establish identity.</p>
      {entities.map((entity,index)=><div key={index}>
        {['name','identifier'].map(key=><div className="research-field" key={key}>
          <label htmlFor={`${prefix}-${index}-${key}`}>Entity {index+1} {key}</label>
          <input id={`${prefix}-${index}-${key}`} required={key==='name'} maxLength={key==='name'?500:1000}
            value={entity[key]} onChange={event=>setEntities(previous=>previous.map((row,i)=>i===index?{...row,[key]:event.target.value}:row))}/>
        </div>)}
        <button type="button" onClick={()=>setEntities(previous=>previous.filter((_,i)=>i!==index))}>Remove entity {index+1}</button>
      </div>)}
      <button type="button" disabled={entities.length>=50} onClick={()=>setEntities(previous=>[...previous,{name:'',identifier:''}])}>Add named entity</button>
      <button type="submit">{busy?'Saving...':'Save new context version'}</button>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}
    {conflict && <button onClick={onSaved}>Reload current context</button>}
  </details>;
}

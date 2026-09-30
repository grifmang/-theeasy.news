import React, {useEffect, useId, useRef, useState} from 'react';
import {apiRequest} from '../api';

const topicFields=[
  {name:'title',label:'Topic title',maxLength:500},
  {name:'slug',label:'Topic slug',maxLength:200,pattern:'[a-z0-9]+(-[a-z0-9]+)*',hint:'Use lowercase letters, numbers, and single hyphens.'}
];
const claimFields=[
  {name:'original',label:'Original claim wording',maxLength:4000,multiline:true},
  {name:'attribution',label:'Attribution',maxLength:1000,hint:'Who made this claim? Do not attribute it to the research team.'},
  {name:'originUrl',label:'Claim origin URL',maxLength:8000,type:'url'}
];

export default function ResearchCreateForm({kind,topicId,onSaved}) {
  const fields=kind==='topic'?topicFields:claimFields;
  const prefix=useId();
  const [values,setValues]=useState({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  const inFlight=useRef(null);
  const observationGroup=useRef(null);
  useEffect(()=>()=>{inFlight.current?.abort();},[]);

  async function submit(event) {
    event.preventDefault();
    if(inFlight.current) return;
    setError('');setSaved(false);
    if(kind==='claim' && !['yes','no'].includes(values.observationKnown)) {
      setError('Choose whether the observation date and time are known or unknown.');
      observationGroup.current?.querySelector('input')?.focus();
      return;
    }
    if(fields.some(field=>!values[field.name]?.trim())) {
      setError('Complete every field before saving.');return;
    }
    let body={...values};
    if(kind==='claim') {
      try {
        const url=new URL(values.originUrl);
        if(!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch {setError('Use an HTTP or HTTPS source URL without embedded credentials.');return;}
      if(!values.normalizedWording?.trim()||!values.timeframe?.trim()||!values.location?.trim()||!values.reason?.trim()) {
        setError('Complete normalized wording, timeframe, location, and reason.');return;
      }
      let observedAt=null;
      if(values.observationKnown==='yes') {
        if(!values.observedAt) {setError('Enter the observed date and time, or choose that it is unknown.');return;}
        const date=new Date(values.observedAt);
        if(!Number.isFinite(date.getTime())) {setError('Enter a valid observation date and time.');return;}
        observedAt=date.toISOString();
      }
      const entities=(values.entities||'').split('\n').map(name=>name.trim()).filter(Boolean)
        .map(name=>({name,identifier:null}));
      body={topicId,original:values.original,attribution:values.attribution,originUrl:values.originUrl,
        qualifiers:{normalizedWording:values.normalizedWording,observedAt,entities,
          timeframe:values.timeframe,location:values.location,reason:values.reason}};
    }
    const controller=new AbortController();
    inFlight.current=controller;setBusy(true);
    try {
      const record=await apiRequest(`/api/v1/editor/${kind==='topic'?'topics':'claims'}`,{
        method:'POST',body:kind==='claim'?body:{...values},signal:controller.signal
      });
      if(controller.signal.aborted) return;
      setValues({});setSaved(true);onSaved(kind==='claim'?(record.claim||record):record);
    } catch(reason) {
      if(controller.signal.aborted) return;
      setError(reason.status===403?'Editor access is required to save research.':
        reason.status===401?'Your session expired. Sign in again before saving.':
        reason.status===400?'Check the fields: the server rejected this research record.':
        'Could not save or confirm this record. Your input is retained; check the list before retrying.');
    } finally {
      if(!controller.signal.aborted) {inFlight.current=null;setBusy(false);}
    }
  }

  return <details className="research-create"><summary>Add a {kind}</summary>
    <form onSubmit={submit} aria-label={`Create ${kind}`}>
      <p>{kind==='claim'?'Record the allegation as stated. Saving does not verify, classify, or publish it.':'Organize related claims and source documents under a stable topic.'}</p>
      <fieldset disabled={busy}>
        <legend>{kind==='topic'?'New topic':'New attributed claim'}</legend>
        {fields.map(field=>{
          const props={id:`${prefix}-${field.name}`,name:field.name,required:true,
            maxLength:field.maxLength,value:values[field.name]||'',
            'aria-describedby':field.hint?`${prefix}-${field.name}-hint`:undefined,
            onChange:event=>{setValues(previous=>({...previous,[field.name]:event.target.value}));setSaved(false);}};
          return <div className="research-field" key={field.name}>
            <label htmlFor={props.id}>{field.label}</label>
            {field.multiline?<textarea {...props} rows={5}/>:<input {...props} type={field.type||'text'} pattern={field.pattern}/>}
            {field.hint && <small id={`${props.id}-hint`}>{field.hint}</small>}
          </div>;
        })}
        {kind==='claim' && <>
          <div className="research-field"><label htmlFor={`${prefix}-normalized`}>Normalized wording for this proposal</label>
            <textarea id={`${prefix}-normalized`} required maxLength={4000} rows={3} value={values.normalizedWording||''}
              onChange={event=>setValues(previous=>({...previous,normalizedWording:event.target.value}))}/>
            <small>Editorial wording for this version. The original wording above is preserved verbatim.</small>
          </div>
          <fieldset ref={observationGroup} className="research-observation" aria-describedby={error.includes('observation date and time')?`${prefix}-error`:undefined}>
            <legend>When was this observed?</legend>
            <label><input type="radio" name={`${prefix}-observation`} value="yes" required checked={values.observationKnown==='yes'}
              onChange={()=>{setValues(previous=>({...previous,observationKnown:'yes'}));setError('');}}/> Date and time are known</label>
            <label><input type="radio" name={`${prefix}-observation`} value="no" required checked={values.observationKnown==='no'}
              onChange={()=>{setValues(previous=>({...previous,observationKnown:'no',observedAt:''}));setError('');}}/> Unknown</label>
            {values.observationKnown==='yes'&&<div className="research-field"><label htmlFor={`${prefix}-observedAt`}>Observed date and time</label>
              <input id={`${prefix}-observedAt`} type="datetime-local" required value={values.observedAt||''}
                onChange={event=>setValues(previous=>({...previous,observedAt:event.target.value}))}/>
              <small>Saved as an ISO date and time.</small>
            </div>}
          </fieldset>
          <div className="research-field"><label htmlFor={`${prefix}-entities`}>Entities (one name per line)</label>
            <textarea id={`${prefix}-entities`} rows={3} value={values.entities||''}
              onChange={event=>setValues(previous=>({...previous,entities:event.target.value}))}/>
            <small>Names are recorded as supplied; matching identities is not implied.</small>
          </div>
          <div className="research-field"><label htmlFor={`${prefix}-timeframe`}>Timeframe</label><input id={`${prefix}-timeframe`} required maxLength={1000} value={values.timeframe||''} onChange={event=>setValues(previous=>({...previous,timeframe:event.target.value}))}/></div>
          <div className="research-field"><label htmlFor={`${prefix}-location`}>Location</label><input id={`${prefix}-location`} required maxLength={1000} value={values.location||''} onChange={event=>setValues(previous=>({...previous,location:event.target.value}))}/></div>
          <div className="research-field"><label htmlFor={`${prefix}-reason`}>Why record this claim?</label><textarea id={`${prefix}-reason`} required maxLength={8000} rows={3} value={values.reason||''} onChange={event=>setValues(previous=>({...previous,reason:event.target.value}))}/></div>
        </>}
        <button type="submit">{busy?'Saving...':`Create ${kind}`}</button>
      </fieldset>
      {error && <p id={`${prefix}-error`} role="alert">{error}</p>}
      {saved && <p role="status">{kind==='topic'?'Topic opened.':'Claim saved as unreviewed.'}</p>}
    </form>
    </details>;
}

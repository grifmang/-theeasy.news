import React,{useCallback,useEffect,useId,useState} from 'react';
import {apiRequest} from '../api';
import {cleanReason,errorText,requestKey} from './publication-utils';

export default function PublicationRetractionPanel({claimId,onChanged}){
  const prefix=useId();
  const [headState,setHeadState]=useState(null),[loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState('');
  const [reason,setReason]=useState(''),[pending,setPending]=useState(null),[revision,setRevision]=useState(0);
  const validClaimId=(typeof claimId==='number'&&Number.isSafeInteger(claimId)&&claimId>0)||
    (typeof claimId==='string'&&/^[1-9]\d*$/.test(claimId)&&Number.isSafeInteger(Number(claimId)));
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    if(!validClaimId){setHeadState(null);setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError(null);setHeadState(null);
    apiRequest(`/api/v1/editor/claims/${claimId}/publication-state`,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted){setHeadState(data);
        setPending(previous=>previous&&(
          previous.expectedGeneration!==data.head?.generation||
          previous.expectedHeadEventId!==data.head?.eventId)?null:previous);}})
      .catch(failure=>{if(!controller.signal.aborted)setError(failure);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[claimId,validClaimId,revision]);
  const head=headState?.head;
  const available=headState?.isPublicationOwner===true&&head?.state==='active'&&
    Number.isSafeInteger(head.generation)&&head.generation>0&&Number.isSafeInteger(head.eventId)&&head.eventId>0;
  async function submit(payload){
    setBusy(true);setError(null);setNotice('');
    try{
      const result=await apiRequest(`/api/v1/editor/claims/${claimId}/publication-retraction`,{method:'POST',body:payload});
      if(!Number.isSafeInteger(result.event?.id)||result.event.id<1||result.event.action!=='retract'||
        result.event.claimId!==Number(claimId)||result.event.generation!==payload.expectedGeneration+1)
        throw new Error('The retraction response could not be confirmed.');
      setPending(null);setReason('');setNotice('Retraction recorded. Refreshing claim state.');
      refresh();onChanged?.();
    }catch(failure){
      setError(failure);
      if(failure.status===409){setPending(null);setNotice(errorText(failure));refresh();onChanged?.();}
      else setPending(payload);
    }finally{setBusy(false);}
  }
  function dispatch(){
    if(!available||busy||loading||!cleanReason(reason))return;
    let payload;
    try{payload=pending||{expectedGeneration:head.generation,expectedHeadEventId:head.eventId,
      reason:reason.trim(),requestKey:requestKey()};}
    catch(failure){setError(failure);return;}
    if(!window.confirm(`Retract active publication for claim ${claimId}? This creates a public invalidation event.`))return;
    submit(payload);
  }
  return <section className="publication-retraction" aria-labelledby={`${prefix}-heading`}>
    <h4 id={`${prefix}-heading`}>Claim publication retraction</h4>
    <p>Retraction uses current claim head and publication-owner authority. It remains available when a draft, evidence packet, or report cannot be reviewed.</p>
    {loading&&<p role="status">Loading claim publication state…</p>}
    {error&&<p role="alert">{errorText(error)}</p>}
    {notice&&<p role="status">{notice}</p>}
    <button type="button" onClick={refresh} disabled={busy}>Refresh claim publication state</button>
    {headState&&<p>Current claim head: {head?`${head.state}, generation ${head.generation}, event ${head.eventId}`:'none'}.</p>}
    {available&&<form onSubmit={event=>{event.preventDefault();dispatch();}}>
      <fieldset disabled={busy||loading}><legend>Retract active publication</legend>
        <p>This invalidates the active public generation for the claim.</p>
        <div className="research-field"><label htmlFor={`${prefix}-reason`}>Retraction reason</label>
          <textarea id={`${prefix}-reason`} value={reason} maxLength="500" required rows="3"
            onChange={event=>{setReason(event.target.value);setPending(null);}}/></div>
        <button type="submit" disabled={!cleanReason(reason)}>{pending?'Retry same retraction':'Retract publication'}</button>
      </fieldset>
    </form>}
  </section>;
}

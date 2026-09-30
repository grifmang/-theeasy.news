import React,{useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';
export default function FetchSourceForm({topicId,onSaved}) {
  const prefix=useId(),pending=useRef(null);
  const [sourceId,setSourceId]=useState(''),[url,setUrl]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function submit(event) {
    event.preventDefault();if(pending.current) return;
    setError('');setSuccess(false);
    try {
      const parsed=new URL(url);
      if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||url.trim()!==url) throw new Error();
    } catch {setError('Use an HTTPS document URL without credentials or a custom port.');return;}
    if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(sourceId)) {setError('Enter the approved source policy ID supplied by your operator.');return;}
    const controller=new AbortController();pending.current=controller;setBusy(true);
    try {
      const job=await apiRequest(`/api/v1/editor/topics/${topicId}/fetch-jobs`,{method:'POST',body:{sourceId,url},signal:controller.signal});
      if(controller.signal.aborted) return;
      setSuccess(true);onSaved(job);
    } catch(reason) {
      if(!controller.signal.aborted) setError(reason.status===503?'Source ingestion is not configured. Ask an operator to approve sources and enable it.':
        reason.status===401?'Session expired. Sign in again.':reason.status===403?'Editor access and a valid session are required.':
        reason.status===400?'This URL or source policy is not approved. Check both values.':
        'Could not confirm submission. Input retained; refresh fetch jobs before retrying.');
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }
  return <form className="research-create" aria-label="Fetch source document" onSubmit={submit}>
    <p>Retrieve a document from an operator-approved source. Downloading does not verify a claim, publish content, or call a model.</p>
    <fieldset disabled={busy}><legend>Approved source</legend>
      <div className="research-field"><label htmlFor={`${prefix}-policy`}>Approved source policy ID</label>
        <input id={`${prefix}-policy`} required maxLength={80} value={sourceId} onChange={event=>{setSourceId(event.target.value);setSuccess(false);}}/>
      </div>
      <div className="research-field"><label htmlFor={`${prefix}-url`}>Document URL</label>
        <input id={`${prefix}-url`} type="url" required maxLength={8192} value={url} onChange={event=>{setUrl(event.target.value);setSuccess(false);}}/>
      </div>
      <button type="submit">{busy?'Submitting...':'Queue document'}</button>
    </fieldset>
    {error&&<p role="alert">{error}</p>}
    <p role="status">{success?'Queued for retrieval (or an existing matching job selected). Not verified evidence.':''}</p>
  </form>;
}

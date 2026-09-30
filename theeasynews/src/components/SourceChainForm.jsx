import React,{useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';

export default function SourceChainForm({documentId,onSaved}) {
  const prefix=useId();
  const [parentId,setParentId]=useState('');
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  const pending=useRef(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function submit(event) {
    event.preventDefault();if(pending.current)return;
    setError('');setSaved(false);
    if(!/^[1-9]\d*$/.test(parentId)||Number(parentId)===documentId||!reason.trim()) {
      setError('Enter a different existing parent document ID and explain the provenance relationship.');return;
    }
    const controller=new AbortController();pending.current=controller;setBusy(true);
    try {
      await apiRequest(`/api/v1/editor/documents/${documentId}/source-chain/parents`,{
        method:'POST',signal:controller.signal,body:{parentId:Number(parentId),reason}
      });
      if(controller.signal.aborted)return;
      setParentId('');setReason('');setSaved(true);onSaved();
    } catch(cause) {
      if(!controller.signal.aborted)setError(cause.status===401?'Session expired. Sign in again.':
        cause.status===403?'Editor access is required.':cause.status===409?'The provenance record changed. Reload before retrying.':
        'Could not record this source relationship. Check the parent ID, existing links, and direction before retrying.');
    } finally {if(!controller.signal.aborted){pending.current=null;setBusy(false);}}
  }
  return <details className="research-create"><summary>Record a parent source</summary>
    <p>Use this when the current document copies, republishes, quotes, or derives from an earlier document. The link is immutable and prevents copied reporting from appearing independent.</p>
    <form onSubmit={submit} aria-label="Record source-chain parent"><fieldset disabled={busy}>
      <legend>Provenance relationship</legend>
      <div className="research-field"><label htmlFor={`${prefix}-parent`}>Parent document ID</label>
        <input id={`${prefix}-parent`} inputMode="numeric" pattern="[1-9][0-9]*" required value={parentId}
          aria-describedby={`${prefix}-parent-hint`} onChange={event=>{setParentId(event.target.value);setSaved(false);}}/>
        <small id={`${prefix}-parent-hint`}>The earlier or originating document. A document cannot be its own parent, and cycles are rejected.</small>
      </div>
      <div className="research-field"><label htmlFor={`${prefix}-reason`}>Why these documents are linked</label>
        <textarea id={`${prefix}-reason`} required rows={3} maxLength={8000} value={reason}
          onChange={event=>{setReason(event.target.value);setSaved(false);}}/>
      </div>
      <button type="submit">{busy?'Recording...':'Record immutable source link'}</button>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Source relationship recorded.</p>}
  </details>;
}

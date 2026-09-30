import React,{useEffect,useRef,useState} from 'react';
import {apiRequest} from '../api';
export default function FetchExtraction({jobId,receipt,extractionAvailable,onSaved}) {
  const pending=useRef(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
  useEffect(()=>()=>pending.current?.abort(),[]);
  if(!receipt) return null;
  if(receipt.retention!=='private') return <p>Metadata-only receipt: no original body is retained for extraction.</p>;
  if(!['text/plain','text/html','application/pdf'].includes(receipt.mime)) return <p>This format requires an extraction path that is not available yet.</p>;
  if(extractionAvailable===false||(receipt.mime!=='text/plain'&&extractionAvailable!==true))
    return <p>Extraction is not enabled for this original on the current server.</p>;
  async function extract() {
    if(pending.current) return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setSuccess(false);
    try {
      const document=await apiRequest(`/api/v1/editor/fetch-jobs/${jobId}/extract`,{method:'POST',body:{},signal:controller.signal});
      if(!controller.signal.aborted) {setSuccess(true);onSaved(document);}
    } catch(reason) {
      if(!controller.signal.aborted) setError(reason.status===401?'Session expired. Sign in again.':
        reason.status===403?'Editor access and a valid session are required.':
        reason.status===429?'The document parser is busy. Wait a moment, then retry.':
        reason.status===503?'Extraction is temporarily unavailable. Refresh the receipt before retrying.':
        'Could not confirm extraction. Check the document list before retrying.');
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }
  return <section aria-label="Extract downloaded document">
    <p>Extract the preserved text for review. This does not verify, classify, or publish its claims.</p>
    <button disabled={busy} onClick={extract}>{busy?'Extracting...':'Extract preserved text'}</button>
    {error&&<p role="alert">{error}</p>}
    <p role="status">{success?'Extracted for review. No factual verdict was generated.':''}</p>
  </section>;
}

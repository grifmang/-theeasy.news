import React, {useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';

// Textareas normalize CRLF to LF. Storage offsets address the untouched UTF-16
// source, so map selection boundaries before sending them to the server.
function originalOffset(text,displayOffset) {
  let original=0,display=0;
  while(original<text.length && display<displayOffset) {
    if(text[original]==='\r' && text[original+1]==='\n') original++;
    original++;display++;
  }
  return original;
}

export default function PassageEditor({documentId,text,onSaved}) {
  const prefix=useId();
  const [range,setRange]=useState(null);
  const [locator,setLocator]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(null);
  const pending=useRef(null);
  const sourceField=useRef(null);
  useEffect(()=>()=>pending.current?.abort(),[]);

  function select(target) {
    if(pending.current) return;
    const start=originalOffset(text,target.selectionStart);
    const end=originalOffset(text,target.selectionEnd);
    // A collapsed selection after focus moves must not erase the chosen range.
    if(end>start && (range?.start!==start || range?.end!==end)) {
      setRange({start,end});setSaved(null);setError('');
    }
  }
  async function submit(event) {
    event.preventDefault();
    if(pending.current || !range || !locator.trim()) return;
    const controller=new AbortController();pending.current=controller;
    setBusy(true);setError('');setSaved(null);
    try {
      const passage=await apiRequest(`/api/v1/editor/documents/${documentId}/passages`,{
        method:'POST',body:{...range,locator},signal:controller.signal
      });
      if(controller.signal.aborted) return;
      setSaved(passage.id);onSaved(passage);
    } catch(reason) {
      if(!controller.signal.aborted) setError(reason.status===401?'Session expired. Sign in again.':
        reason.status===403?'Editor access is required.':
        'Could not save or confirm this passage. Selection retained; check existing passages before retrying.');
    } finally {
      if(!controller.signal.aborted) {pending.current=null;setBusy(false);}
    }
  }
  return <form onSubmit={submit} aria-label="Save source passage">
    <div className="research-field">
      <label htmlFor={`${prefix}-source`}>Select source text</label>
      <small id={`${prefix}-help`}>Select a passage with your mouse or Shift and arrow keys, then choose Use selected text. This preserved text cannot be edited.</small>
      <textarea id={`${prefix}-source`} aria-describedby={`${prefix}-help`} readOnly rows={12}
        ref={sourceField} value={text.replace(/\r\n?/g,'\n')} onSelect={event=>select(event.target)}/>
    </div>
    <button type="button" disabled={busy} onClick={()=>select(sourceField.current)}>Use selected text</button>
    {range && <><h4>Selected passage</h4><blockquote>{text.slice(range.start,range.end)}</blockquote>
      <p>Original text offsets: {range.start}–{range.end} (end excluded).</p></>}
    <div className="research-field"><label htmlFor={`${prefix}-locator`}>Passage locator</label>
      <input id={`${prefix}-locator`} required maxLength={1000} value={locator} disabled={busy}
        placeholder="For example: page 3, paragraph 2" onChange={event=>setLocator(event.target.value)}/></div>
    <button disabled={busy || !range || !locator.trim()} type="submit">{busy?'Saving...':'Save passage'}</button>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Passage {saved} saved. It has not been assessed or published.</p>}
  </form>;
}

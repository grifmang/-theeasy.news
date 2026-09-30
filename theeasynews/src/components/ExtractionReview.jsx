import React,{useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';
import PdfPageReview from './PdfPageReview';
const warningLabels={plain_text_not_rendered:'Original layout has not been checked.',
  reading_order_and_rendered_original_require_review:'Compare reading order and transcription with the original PDF and preserved page images.',
  native_text_incomplete_requires_ocr:'One or more pages need OCR; native text alone is incomplete.',
  ocr_text_requires_original_comparison:'OCR-derived text must be compared with the preserved page image before use.',
  ocr_english_only:'OCR currently recognizes English only; other languages may be missing or incorrect.',
  ocr_found_no_text:'OCR found no readable text on one or more pages.',
  not_rendered:'This HTML was parsed without rendering the page.',
  layout_and_css_unverified:'Page styling and visual order have not been verified.',
  source_offsets_are_utf16:'Source positions refer to decoded text, not file-byte offsets.'};

function ReviewForm({extractionId,sourceText}) {
  const prefix=useId(),pending=useRef(null);
  const [record,setRecord]=useState(null),[revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reloadRequired,setReloadRequired]=useState(false);
  const [decision,setDecision]=useState(''),[reason,setReason]=useState(''),[compared,setCompared]=useState(false);
  const [saved,setSaved]=useState('');
  useEffect(()=>{
    const controller=new AbortController();pending.current=controller;
    setRecord(null);setError('');setBusy(true);setSaved('');setCompared(false);
    apiRequest(`/api/v1/editor/extractions/${extractionId}`,{signal:controller.signal}).then(value=>{
      if(controller.signal.aborted) return;
      if(value.id!==extractionId||!value.manifest||!value.review||!Array.isArray(value.manifest.quality?.warnings))
        throw new Error('Invalid extraction response');
      setRecord(value);setReloadRequired(false);
    }).catch(failure=>{
      if(!controller.signal.aborted) setError(failure.status===401?'Session expired. Sign in again.':
        failure.status===403?'Editor access is required.':'Could not load extraction provenance. Reload before reviewing.');
    }).finally(()=>{if(!controller.signal.aborted) {pending.current=null;setBusy(false);}});
    return ()=>{controller.abort();pending.current?.abort();};
  },[extractionId,revision]);

  async function submit(event) {
    event.preventDefault();
    if(pending.current||!record||reloadRequired||!decision||!reason.trim()||(decision==='accepted'&&!compared)) return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setSaved('');
    try {
      const result=await apiRequest(`/api/v1/editor/extractions/${extractionId}/reviews`,{method:'POST',signal:controller.signal,
        body:{expectedManifestSha256:record.manifest_sha256,expectedEventId:record.review.eventId,
          decision,originalCompared:compared,reason}});
      if(controller.signal.aborted) return;
      if(!Number.isSafeInteger(result.id)||result.id<1||result.decision!==decision) throw new Error('Invalid saved review');
      setRecord(previous=>({...previous,review:{status:result.decision,eventId:result.id}}));
      setSaved(result.decision);setDecision('');setReason('');setCompared(false);
    } catch(failure) {
      if(!controller.signal.aborted) {
        setReloadRequired(true);
        setError(failure.status===409?'This review changed. Reload and read the current decision before saving again.':
          failure.status===401?'Session expired. Sign in again.':failure.status===403?'Editor access is required.':
            'Could not confirm the review was saved. Notes retained; reload its status before trying again.');
      }
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }

  return <div className="extraction-review-body">
    {busy&&!record&&<p role="status">Loading extraction provenance...</p>}
    {error&&<p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>Reload extraction review</button>
    {record&&<>
      <p className={`extraction-status extraction-status-${record.review.status}`}>Current extraction review: {record.review.status}</p>
      <dl className="extraction-provenance">
        <div><dt>Extractor</dt><dd>{record.extractor_version}</dd></div>
        <div><dt>Preserved text</dt><dd>{record.manifest.textLength} UTF-16 units; {record.manifest.spans?.length??0} source {record.manifest.spans?.length===1?'span':'spans'}</dd></div>
        <div><dt>Original SHA-256</dt><dd className="research-hash">{record.original_sha256}</dd></div>
        <div><dt>Extraction SHA-256</dt><dd className="research-hash">{record.manifest_sha256}</dd></div>
      </dl>
      {record.manifest.quality.warnings.length>0&&<><h4>Extraction limitations</h4>
        <ul>{record.manifest.quality.warnings.map((warning,index)=><li key={`${index}-${warning}`}>{warningLabels[warning]||warning}</li>)}</ul></>}
      <a href={`${process.env.REACT_APP_API_URL||''}/api/v1/editor/extractions/${extractionId}/original`} download>Download preserved original</a>
      {record.manifest.schemaVersion===2&&<PdfPageReview extractionId={extractionId} manifest={record.manifest} sourceText={sourceText}/>}
      <p>Compare the preserved original with the source text below. Check names, dates, amounts, tables, footnotes, and missing or reordered text. Do not use a changed live page as a substitute.</p>
      <form onSubmit={submit}><fieldset disabled={busy||reloadRequired}><legend>Record extraction quality</legend>
        <div className="research-field"><label htmlFor={`${prefix}-decision`}>Extraction decision</label>
          <select id={`${prefix}-decision`} required value={decision} onChange={event=>setDecision(event.target.value)}>
            <option value="">Choose a decision</option><option value="accepted">Accept extraction quality</option>
            <option value="rejected">Reject extraction quality</option>
          </select></div>
        <label className="extraction-attestation"><input type="checkbox" checked={compared} onChange={event=>setCompared(event.target.checked)}/>
          I compared the preserved original with this extracted text.</label>
        <div className="research-field"><label htmlFor={`${prefix}-reason`}>Review notes</label>
          <textarea id={`${prefix}-reason`} rows={4} required maxLength={8000} value={reason} onChange={event=>setReason(event.target.value)}/></div>
        <button type="submit" disabled={!decision||!reason.trim()||(decision==='accepted'&&!compared)}>{busy?'Saving review...':'Save extraction review'}</button>
      </fieldset></form>
      <p className="extraction-boundary">This reviews transcription quality only. It does not establish whether a claim is true or approve publication.</p>
      {saved&&<p role="status">Review saved: {saved}. Claim and publication approval are unchanged.</p>}
    </>}
  </div>;
}

export default function ExtractionReview({extractions,sourceText}) {
  const prefix=useId();
  const [selected,setSelected]=useState(null);
  const items=extractions||[];
  const extractionId=selected??items[0]?.id;
  return <section className="extraction-review" aria-label="Extraction quality review">
    <h3>Check the extraction</h3>
    {!items.length?<p>No extraction manifest is recorded. Extraction quality is unverified; a passage assessment alone does not verify the transcription.</p>:<>
      {items.length>1&&<div className="research-field"><label htmlFor={`${prefix}-version`}>Extraction version</label>
        <select id={`${prefix}-version`} value={extractionId} onChange={event=>setSelected(Number(event.target.value))}>
          {items.map(item=><option key={item.id} value={item.id}>Extraction {item.id}: {item.extractor_version}</option>)}
        </select></div>}
      <ReviewForm key={extractionId} extractionId={extractionId} sourceText={sourceText}/>
    </>}
  </section>;
}

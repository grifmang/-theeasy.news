import React,{useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';

const fields=[
  {name:'title',label:'Document title',limit:32000},
  {name:'source',label:'Source publisher',limit:32000},
  {name:'url',label:'Source URL',limit:8000,type:'url'},
  {name:'originChain',label:'Originating source chain',limit:1000,hint:'Use the same identifier for copies of one original source. Copies are not independent corroboration.'},
  {name:'retrievedAt',label:'Retrieved at (UTC)',limit:24,hint:'When you obtained this text, e.g. 2020-01-01T00:00:00.000Z. This is not the archive capture date.'},
  {name:'publishedAt',label:'Publication timestamp (UTC, optional)',limit:24,optional:true,hint:'Leave unknown dates blank; do not substitute retrieval or archive dates.'},
  {name:'text',label:'Document text',limit:1000000,multiline:true}
];
const kinds=[['web_page','Web page'],['court_filing','Court filing'],['official_release','Official release'],
  ['transcript','Transcript'],['report','Report'],['social_post','Social post'],['other','Other']];
function validTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
}

export default function DocumentImportForm({topicId,onSaved}) {
  const prefix=useId();
  const [values,setValues]=useState({kind:'web_page'});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState(false);
  const pending=useRef(null);
  useEffect(()=>()=>pending.current?.abort(),[]);
  async function submit(event) {
    event.preventDefault();if(pending.current) return;
    setError('');setSuccess(false);
    if(fields.some(field=>!field.optional && !values[field.name]?.trim())) {setError('Complete all required fields.');return;}
    if(!validTimestamp(values.retrievedAt) || (values.publishedAt && !validTimestamp(values.publishedAt))) {
      setError('Use exact UTC timestamps such as 2020-01-01T00:00:00.000Z, or leave an unknown publication timestamp blank.');return;
    }
    try {
      const url=new URL(values.url);
      if(!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {setError('Use an HTTP or HTTPS source URL without embedded credentials.');return;}
    const controller=new AbortController();pending.current=controller;setBusy(true);
    try {
      const result=await apiRequest('/api/v1/editor/documents/text',{method:'POST',signal:controller.signal,
        body:{...values,topicId,publishedAt:values.publishedAt || null}});
      if(controller.signal.aborted) return;
      setValues({kind:'web_page'});setSuccess(true);onSaved(result.document);
    } catch(reason) {
      if(!controller.signal.aborted) setError(reason.status===503?'The private document archive is not configured. Ask an operator to enable it. Your text is retained.':
        reason.status===401?'Session expired. Sign in again before importing.':
        reason.status===403?'Editor access and a valid session are required.':
        reason.status===413?'Document exceeds the request limit. Your text is retained.':
        'Could not import or confirm this document. Input retained; check existing documents before retrying.');
    } finally {if(!controller.signal.aborted) {pending.current=null;setBusy(false);}}
  }
  return <details className="research-create"><summary>Import document text</summary>
    <form onSubmit={submit} aria-label="Import document text">
      <p>Paste text you are authorized to store. This preserves the submitted text, not the original web page or PDF. The URL is attribution only and will not be fetched. Import does not verify, publish, or send text to a model.</p>
      <fieldset disabled={busy}><legend>Source and preserved text</legend>
        <div className="research-field"><label htmlFor={`${prefix}-kind`}>Document type</label>
          <select id={`${prefix}-kind`} value={values.kind} onChange={event=>setValues(previous=>({...previous,kind:event.target.value}))}>
            {kinds.map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></div>
        {fields.map(field=>{
          const props={id:`${prefix}-${field.name}`,value:values[field.name]||'',required:!field.optional,maxLength:field.limit,
            'aria-describedby':field.hint?`${prefix}-${field.name}-hint`:undefined,
            onChange:event=>{setValues(previous=>({...previous,[field.name]:event.target.value}));setSuccess(false);}};
          return <div className="research-field" key={field.name}><label htmlFor={props.id}>{field.label}</label>
            {field.multiline?<textarea {...props} rows={10}/>:<input {...props} type={field.type||'text'}/>}
            {field.hint && <small id={`${props.id}-hint`}>{field.hint}</small>}
          </div>;
        })}
        <button type="submit">{busy?'Importing...':'Import text'}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {success && <p role="status">Document imported for private review.</p>}
    </form>
  </details>;
}

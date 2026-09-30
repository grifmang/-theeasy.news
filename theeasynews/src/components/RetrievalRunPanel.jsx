import React,{useEffect,useId,useRef,useState} from 'react';
import {apiRequest} from '../api';

function makeRequestId() {
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,14)}`;
}

function display(value) {
  return value===null||value===undefined||value===''?'Unknown/not proven':String(value);
}

function normalizeQuery(value) {
  let folded;
  try {folded=value.normalize('NFKC').toLocaleLowerCase('und');}
  catch {folded=value.normalize('NFKC').toLowerCase();}
  return folded
    .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/gu,' ');
}

function queryValidation(queries) {
  const queryVariants=queries.split(/\r?\n/).map(query=>query.trim()).filter(Boolean);
  if(queryVariants.length<1) return {queryVariants,message:'Enter at least one non-empty query variant.'};
  if(queryVariants.length>8) return {queryVariants,message:'Enter no more than 8 variants; remove variant 9 or later.'};
  let totalBytes=0;
  for(let index=0;index<queryVariants.length;index++) {
    const query=queryVariants[index];
    const variantNumber=index+1;
    const bytes=new TextEncoder().encode(query).length;
    totalBytes+=bytes;
    if(bytes>500) return {queryVariants,message:`Variant ${variantNumber} is ${bytes} bytes; shorten it to 500 bytes or fewer.`};
    const normalized=normalizeQuery(query);
    const tokens=normalized.match(/[\p{L}\p{N}]+/gu)||[];
    if(!normalized) return {queryVariants,message:`Variant ${variantNumber} has no searchable letters or numbers; add at least one.`};
    if(normalized.length>500)
      return {queryVariants,message:`Variant ${variantNumber} normalizes to ${normalized.length} characters; shorten it to 500 or fewer.`};
    if(tokens.length>30) return {queryVariants,message:`Variant ${variantNumber} has ${tokens.length} search tokens; reduce it to 30 or fewer.`};
  }
  if(totalBytes>2000) return {queryVariants,message:`The variants total ${totalBytes} bytes; reduce the combined query text to 2,000 bytes or fewer.`};
  return {queryVariants,message:''};
}

function SafeSourceLink({url}) {
  let safe=false;
  try {safe=['http:','https:'].includes(new URL(url).protocol);} catch {}
  return safe?<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>:<span>{display(url)}</span>;
}

function Provenance({passage}) {
  const retrieval=passage.retrieval||{};
  const extraction=passage.extraction||{};
  const chainFields=['auditedChainGroup','audited_chain_group','sourceChainGroup','source_chain_group',
    'originChainGroup','origin_chain_group','chainGroup','chain_group'];
  const availableChainFields=chainFields.filter(field=>passage[field]!==undefined);
  return <dl className="retrieval-provenance">
    <dt>Passage ID</dt><dd>{display(passage.passageId??passage.id)}</dd>
    <dt>Document ID</dt><dd>{display(passage.documentId??passage.document_id)}</dd>
    <dt>Source ID</dt><dd>{display(passage.sourceId??passage.source_id)}</dd>
    <dt>Original SHA-256</dt><dd>{display(passage.originalSha256)}</dd>
    <dt>Retrieval ID</dt><dd>{display(passage.retrievalId??retrieval.id)}</dd>
    <dt>Extraction ID</dt><dd>{display(extraction.id??passage.extractionId)}</dd>
    <dt>Receipt ID</dt><dd>{display(passage.receiptId)}</dd>
    <dt>Page ID</dt><dd>{display(passage.page?.id??passage.pageId)}</dd>
    <dt>Page provenance</dt><dd>{display(passage.pageProvenance)}</dd>
    <dt>Source URL</dt><dd><SafeSourceLink url={passage.sourceUrl??passage.url}/></dd>
    <dt>Title</dt><dd>{display(passage.sourceTitle??passage.title)}</dd>
    <dt>Publisher</dt><dd>{display(passage.publisher??passage.source)}</dd>
    <dt>Published</dt><dd>{display(passage.publishedAt??passage.published_at)}</dd>
    <dt>Source snapshot stored</dt><dd>{display(passage.sourceSnapshotStoredAt??passage.fetched_at)}</dd>
    <dt>Retrieved</dt><dd>{display(passage.retrievedAt??retrieval.retrieved_at)}</dd>
    <dt>Retrieval URL</dt><dd><SafeSourceLink url={retrieval.url}/></dd>
    <dt>Final retrieval URL</dt><dd><SafeSourceLink url={retrieval.final_url}/></dd>
    <dt>Retrieval status</dt><dd>{display(retrieval.status??passage.retrievalStatus)}</dd>
    <dt>Retrieval method</dt><dd>{display(retrieval.method)}</dd>
    <dt>Retrieved object SHA-256</dt><dd>{display(retrieval.sha256??passage.retrievalSha256)}</dd>
    <dt>Retrieved MIME type</dt><dd>{display(retrieval.mime)}</dd>
    <dt>Offsets</dt><dd>{display(passage.start_offset)}–{display(passage.end_offset)}</dd>
    <dt>Locator</dt><dd>{display(passage.locator)}</dd>
    <dt>Legacy origin chain</dt><dd>{display(passage.origin_chain)}</dd>
    <dt>Extraction method</dt><dd>{display(passage.extraction_method)}</dd>
    <dt>Extraction version</dt><dd>{display(extraction.version??passage.extractionVersion)}</dd>
    <dt>Extraction manifest SHA-256</dt><dd>{display(extraction.manifestSha256)}</dd>
    <dt>Match tier</dt><dd>{display(passage.tier)}</dd>
    <dt>Query variant ordinal</dt><dd>{display(passage.variantOrdinal)}</dd>
    {availableChainFields.map(field=><React.Fragment key={field}><dt>{field}</dt><dd>{display(passage[field])}</dd></React.Fragment>)}
    <dt>Audited chain/group details</dt><dd>{availableChainFields.length?'Returned with passage':
      'Not included in this retrieval response; no audited group or ancestry is proven here.'}</dd>
  </dl>;
}

function Coverage({coverage}) {
  const history=coverage.manualSearchHistory||{};
  const gaps=coverage.gaps||[];
  return <section className="retrieval-coverage" aria-label="Retrieval coverage and limits">
    <h4>Coverage and limits</h4>
    <p>Retrieval rank communicates result order and does not determine claim truth. Source-chain groups do not prove independence.
      Gaps or cutoffs mean completeness and recall are unverified.</p>
    <p>Coverage: {coverage.current?'current':'not current or eligibility changed'}; {coverage.returnedCount??0} returned of {coverage.candidateCount??0} candidates, limit {coverage.requestedLimit??'unknown'}.</p>
    <p>Cutoff or exclusions recorded: {coverage.cutoff?'Yes':'No'}.</p>
    <ul>{gaps.map((gap,index)=><li key={`${gap}-${index}`}>{gap.replaceAll('_',' ')}</li>)}</ul>
    <p>Manual inaccessible/deferred history ({history.inaccessible??0} inaccessible, {history.deferred??0} deferred) may belong to other contexts; scope: {display(history.scope)}.</p>
  </section>;
}

function SearchLog({searchLog}) {
  const scope=searchLog.scope||{};
  return <details className="retrieval-search-log">
    <summary>Immutable search log ({searchLog.variants?.length||0} query variants)</summary>
    <p>Run identifier {display(searchLog.runId)} · claim identifier {display(searchLog.claimId)} · context version {display(searchLog.contextVersionId)} · created {display(searchLog.createdAt)}</p>
    <p>Actor account identifier: {display(searchLog.actorId)}. Request identifier: {display(searchLog.requestId)}. These labels do not independently prove actor identity.</p>
    {(searchLog.variants||[]).map(variant=><article className="retrieval-variant" key={variant.ordinal}>
      <h5>Variant {variant.ordinal+1}: {display(variant.query)}</h5>
      <dl>
        <dt>Executed normalized query</dt><dd>{display(variant.normalizedQuery)}</dd>
        <dt>Outcome</dt><dd>{display(variant.outcome)}</dd>
        <dt>Counts (scope: {display(variant.countScope||'hydrated_pool')})</dt>
        <dd>Exact {variant.tiers?.exact??0}; phrase {variant.tiers?.phrase??0}; normalized {variant.tiers?.normalized??0}; FTS {variant.tiers?.fts??0}; discovered {variant.discoveredCount??0}.</dd>
        <dt>Scanned</dt><dd>Raw {variant.rawScanned??0}; normalized {variant.normalizedScanned??0}; FTS {variant.ftsScanned??0}.</dd>
        <dt>Cutoffs</dt><dd>Raw {variant.rawCutoff?'reached':'not reached'}; normalized {variant.normalizedCutoff?'reached':'not reached'}; discovery {variant.discoveryCutoff?'reached':'not reached'}.</dd>
      </dl>
    </article>)}
    <h4>Run limits and resource exclusions</h4>
    <dl>
      <dt>Scope</dt><dd>{display(scope.kind)}</dd>
      <dt>FTS scanned / discovered</dt><dd>{scope.ftsScanned??0} / {scope.discoveredCount??0}</dd>
      <dt>Index cap</dt><dd>{display(scope.maxPerIndex)}</dd>
      <dt>Discovery cap / cutoff</dt><dd>{display(scope.maxDiscovered)} / {scope.discoveryCutoff?'reached':'not reached'}</dd>
      <dt>Pool count / cap / cutoff</dt><dd>{scope.poolCount??0} / {display(scope.maxPool)} / {scope.poolCutoff?'reached':'not reached'}</dd>
      <dt>Result cutoff</dt><dd>{searchLog.coverage?.returnedCount??0} returned from {searchLog.coverage?.candidateCount??0} candidates; limit {searchLog.coverage?.requestedLimit??'unknown'}; {Number(searchLog.coverage?.candidateCount||0)>Number(searchLog.coverage?.requestedLimit||0)?'reached':'not reached'}.</dd>
      <dt>Oversized exclusions</dt><dd>{scope.oversizedExcluded??0}</dd>
      <dt>Byte-budget exclusions</dt><dd>{scope.byteBudgetExcluded??0}</dd>
      <dt>Quote bytes used</dt><dd>{scope.quoteBytes??0} of {display(scope.maxPoolQuoteBytes)}</dd>
      <dt>Maximum individual quote bytes</dt><dd>{display(scope.maxQuoteBytes)}</dd>
      <dt>Ancestry node count / cap</dt><dd>{display(scope.chainNodes)} / {display(scope.maxChainNodes)}</dd>
      <dt>Ancestry link count / cap</dt><dd>{display(scope.chainLinks)} / {display(scope.maxChainLinks)}</dd>
      <dt>Ancestry reason bytes / cap</dt><dd>{display(scope.chainReasonBytes)} / {display(scope.maxChainReasonBytes)}</dd>
    </dl>
  </details>;
}

export default function RetrievalRunPanel({claimId,contextVersionId,onReload}) {
  const prefix=useId();
  const [queries,setQueries]=useState('');
  const [limit,setLimit]=useState(30);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const [validationNotice,setValidationNotice]=useState('');
  const [result,setResult]=useState(null);
  const pending=useRef(null);
  const queryInput=useRef(null);
  const requestIds=useRef(new Map());

  useEffect(()=>{
    pending.current?.abort();pending.current=null;
    requestIds.current.clear();setBusy(false);setError(null);setResult(null);
  },[claimId]);
  useEffect(()=>()=>pending.current?.abort(),[]);

  const {queryVariants,message:queryError}=queryValidation(queries);
  const path=`/api/v1/editor/claims/${claimId}/retrieval-runs`;

  async function run(event) {
    event.preventDefault();
    if(pending.current) return;
    if(queryError) {setValidationNotice(queryError);queryInput.current?.focus();return;}
    setValidationNotice('');
    if(!Number.isInteger(Number(limit))||Number(limit)<1||Number(limit)>30||!contextVersionId) return;
    const payload={queryVariants,limit:Number(limit),expectedContextVersionId:contextVersionId};
    const signature=JSON.stringify(payload);
    const prior=requestIds.current.get(path);
    const id=prior?.signature===signature?prior.id:makeRequestId();
    requestIds.current.set(path,{signature,id});
    const controller=new AbortController();pending.current=controller;setBusy(true);setError(null);
    try {
      const response=await apiRequest(path,{method:'POST',signal:controller.signal,body:{...payload,requestId:id}});
      if(controller.signal.aborted) return;
      if(requestIds.current.get(path)?.signature===signature) requestIds.current.delete(path);
      setResult(response);
    } catch(reason) {
      if(controller.signal.aborted) return;
      const stale=reason.status===409;
      const ambiguous=!reason.status||reason.status>=500||reason.status===408||reason.status===429;
      const kind=reason.status===404?'unsupported':reason.status===422?'resource':
        reason.status===400?'invalid':stale?'stale':
        reason.status===401?'session':reason.status===403?'access':'general';
      if(reason.status&&reason.status<500&&reason.status!==408&&reason.status!==429&&requestIds.current.get(path)?.signature===signature) requestIds.current.delete(path);
      setError({kind,message:kind==='stale'?'The claim context changed or is unavailable. Reload the claim before running retrieval.':
        kind==='resource'?'The bounded retrieval resource limit was exceeded. Reduce the query scope and retry.':
        kind==='unsupported'?'Retrieval runs are not supported by this server version. A server upgrade is required.':
        kind==='invalid'?'The server rejected the query or request bounds. Review the highlighted query limits and input, then submit again. Entries are retained; a definite rejection does not reuse the prior request ID.':
        kind==='session'?'Your session expired. Sign in again before running retrieval.':
        kind==='access'?'Editor access is required to run retrieval.':
        ambiguous?'Could not confirm whether this retrieval run completed. Inputs are retained; retrying unchanged input will reuse its request ID.':
        `The server rejected this retrieval request (HTTP ${reason.status}). Review the input and submit again; entries are retained, but this definite rejection does not reuse the prior request ID.`});
    } finally {
      if(!controller.signal.aborted){pending.current=null;setBusy(false);}
    }
  }

  const coverage=result?.coverage;
  const log=result?.searchLog;
  return <section className="retrieval-run" aria-labelledby={`${prefix}-heading`}>
    <h3 id={`${prefix}-heading`}>Bounded claim retrieval</h3>
    <p>Search saved passages with up to eight query variants. Retrieval rank communicates result order and does not determine claim truth.</p>
    {!contextVersionId&&<p role="status">Record a claim context before running retrieval.</p>}
    <form onSubmit={run}>
      <fieldset disabled={busy||!contextVersionId}>
        <legend>Retrieval request</legend>
        <div className="research-field">
          <label htmlFor={`${prefix}-queries`}>Query variants (one per line)</label>
          <textarea id={`${prefix}-queries`} ref={queryInput} rows={5} required maxLength={4000} value={queries}
            onChange={event=>{setQueries(event.target.value);setValidationNotice('');}}
            aria-invalid={Boolean(queryError||validationNotice)} aria-describedby={`${prefix}-query-help ${prefix}-query-error`}/>
          <small id={`${prefix}-query-help`}>{queryVariants.length} non-empty variant{queryVariants.length===1?'':'s'}; enter 1–8, at most 500 original UTF-8 bytes per variant and 2,000 bytes total. After normalization, each variant must be at most 500 JavaScript characters and contain 1–30 tokens.</small>
          <p id={`${prefix}-query-error`} role="status" aria-live="polite">{validationNotice||queryError}</p>
        </div>
        <div className="research-field">
          <label htmlFor={`${prefix}-limit`}>Passage limit</label>
          <input id={`${prefix}-limit`} type="number" min="1" max="30" step="1" required value={limit}
            onChange={event=>setLimit(event.target.value)}/>
        </div>
        <p>Claim context version: {display(contextVersionId)}</p>
        <button type="submit" disabled={busy||!contextVersionId}>
          {busy?'Running retrieval…':error?'Retry retrieval run':'Run retrieval'}
        </button>
      </fieldset>
    </form>
    <p role="status" aria-live="polite" aria-atomic="true">{busy?'Retrieval is running.':result?`${result.passages?.length||0} retrieval passages loaded in rank order.`:''}</p>
    {error&&<div><p role="alert">{error.message}</p>
      {(error.kind==='stale'||error.kind==='unsupported')&&<button type="button" onClick={onReload}>{error.kind==='stale'?'Reload claim before retry':'Retry after server upgrade'}</button>}
      {error.kind==='resource'&&<p>Shorten the query variants or lower the passage limit, then submit the bounded run again.</p>}
    </div>}
    {result&&<section className="retrieval-results" aria-label="Retrieval results">
      <h4>Passages in retrieval rank order</h4>
      <p>{result.passages?.length||0} returned passage{result.passages?.length===1?'':'s'}. Rank does not establish truth.</p>
      {result.passages?.length?<ol>{result.passages.map((passage,index)=><li key={`${passage.passageId??passage.id}-${index}`}>
        <article className="retrieval-passage">
          <h5>Rank {index+1} · passage {display(passage.passageId??passage.id)}</h5>
          <h6>Exact immutable passage quote</h6>
          <blockquote>{display(passage.quote)}</blockquote>
          <details className="retrieval-neighbor-details">
            <summary>Neighboring source context</summary>
            {passage.neighboringContext&&typeof passage.neighboringContext.text==='string'?
              <>
                <p>This is the returned source context around the exact passage quote above; it is a separate excerpt.</p>
                <dl>
                  <dt>Context start offset</dt><dd>{display(passage.neighboringContext.start)}</dd>
                  <dt>Context end offset</dt><dd>{display(passage.neighboringContext.end)}</dd>
                  <dt>Context scope</dt><dd>{display(passage.neighboringContext.scope)}</dd>
                </dl>
                {/* This complete context excerpt is scrollable and keyboard accessible. */}
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard scrolling is needed for this bounded overflow region. */}
                <div className="research-source retrieval-neighbor-context" role="region" aria-label={`Neighboring source context for passage ${passage.passageId??passage.id}`} tabIndex={0}>
                  {passage.neighboringContext.text}
                </div>
              </>:
              <p>No neighboring source context was returned. The exact immutable passage quote above remains available.</p>}
          </details>
          <details><summary>Passage provenance</summary><Provenance passage={passage}/></details>
        </article>
      </li>)}</ol>:<p>No passages returned for these variants.</p>}
      {coverage&&<Coverage coverage={coverage}/>}
      {log&&<SearchLog searchLog={{...log,coverage}}/>}
    </section>}
  </section>;
}

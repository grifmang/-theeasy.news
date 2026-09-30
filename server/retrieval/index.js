const {createHash}=require('crypto');
const {getClaimState}=require('../research-lifecycle');
const {normalizePassage}=require('./normalize');

const LIMITS=Object.freeze({variants:8,variantBytes:500,totalQueryBytes:2000,tokens:30,
  perIndexIds:2048,discoveredIds:32768,poolIds:1000,quoteBytes:32768,
  chainCandidateDocuments:4096,chainNodes:8192,chainLinks:16384,chainReasonBytes:4194304,
  poolQuoteBytes:4194304,sourceBodyBytes:4194304,sourceScanBytes:67108864,
  responseBytes:2097152});
const TIERS=['exact','phrase','normalized','fts'];
function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function validate(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    !Number.isSafeInteger(input.claimId)||input.claimId<1||
    !Number.isSafeInteger(input.limit??30)||(input.limit??30)<1||(input.limit??30)>30||
    !Array.isArray(input.queryVariants)||input.queryVariants.length<1||input.queryVariants.length>LIMITS.variants)
    fail('retrieval_invalid','Invalid retrieval request');
  let bytes=0;
  const variants=input.queryVariants.map(query=>{
    if(typeof query!=='string'||!query.trim()||query.length>LIMITS.variantBytes||
      Buffer.byteLength(query)>LIMITS.variantBytes)fail('retrieval_invalid','Invalid retrieval query');
    bytes+=Buffer.byteLength(query);
    const normalized=normalizePassage(query),tokens=normalized.match(/[\p{L}\p{N}]+/gu)||[];
    if(!normalized||normalized.length>LIMITS.variantBytes||tokens.length>LIMITS.tokens)
      fail('retrieval_invalid','Invalid retrieval query tokens');
    return {query,normalized,tokens};
  });
  if(bytes>LIMITS.totalQueryBytes)fail('retrieval_invalid','Invalid retrieval queries');
  if(input.expectedContextVersionId!==undefined&&
    (!Number.isSafeInteger(input.expectedContextVersionId)||input.expectedContextVersionId<1))
    fail('retrieval_invalid','Invalid context version');
  if(input.actorId!==undefined&&(!Number.isSafeInteger(input.actorId)||input.actorId<1))
    fail('retrieval_invalid','Invalid actor');
  if(input.requestId!==undefined&&
    (typeof input.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(input.requestId)))
    fail('retrieval_invalid','Invalid requestId');
  return {claimId:input.claimId,limit:input.limit??30,variants,
    actorId:input.actorId??null,requestId:input.requestId??null,
    expectedContextVersionId:input.expectedContextVersionId};
}
function eligibilitySql(){return `
  COALESCE((SELECT a.policy FROM source_access_events a WHERE a.source_id=s.id
    ORDER BY a.id DESC LIMIT 1),'private')<>'restricted'
  AND NOT EXISTS(SELECT 1 FROM extraction_manifests em WHERE em.document_id=d.id
    AND (SELECT er.decision FROM extraction_review_events er WHERE er.extraction_id=em.id
      ORDER BY er.id DESC LIMIT 1)='rejected')`;
}
function discover(db,topicId,variants){
  const found=new Map(),logs=[];
  function scopedHits(index,match){
    return db.prepare(`SELECT p.id,p.document_id,d.origin_chain,
        n.quote_bytes,n.passage_id AS mapping_id
      FROM ${index} JOIN research_passages p ON p.id=${index}.rowid
      LEFT JOIN passage_normalizations n ON n.passage_id=p.id
      JOIN research_documents d ON d.id=p.document_id JOIN source_items s ON s.id=d.source_id
      WHERE ${index} MATCH ? AND EXISTS(SELECT 1 FROM research_topic_documents td
        WHERE td.topic_id=? AND td.document_id=d.id) AND ${eligibilitySql()}
      ORDER BY p.id LIMIT ?`).all(match,topicId,LIMITS.perIndexIds+1);
  }
  variants.forEach((variant,ordinal)=>{
    // No user-controlled FTS syntax survives normalization; every token is quoted.
    const match=variant.tokens.map(token=>`"${token}"`).join(' AND ');
    const raw=scopedHits('passage_search',match),normalized=scopedHits('passage_normalized_search',match);
    const rawCutoff=raw.length>LIMITS.perIndexIds,normalizedCutoff=normalized.length>LIMITS.perIndexIds;
    if(rawCutoff)raw.pop();
    if(normalizedCutoff)normalized.pop();
    const rows=new Map();
    for(const row of [...raw,...normalized]){
      if(row.mapping_id!==row.id||!Number.isSafeInteger(row.quote_bytes)||row.quote_bytes<1||
        row.quote_bytes>LIMITS.sourceBodyBytes)fail('retrieval_integrity','Passage normalization missing or invalid');
      rows.set(row.id,row);
    }
    logs.push({ordinal,query:variant.query,normalized:variant.normalized,
      rawScanned:raw.length,normalizedScanned:normalized.length,
      ftsScanned:raw.length+normalized.length,discoveredCount:rows.size,
      rawCutoff,normalizedCutoff,discoveryCutoff:rawCutoff||normalizedCutoff,counts:[0,0,0,0]});
    for(const row of rows.values()){
      let item=found.get(row.id);
      if(!item){item={...row,variants:new Set()};found.set(row.id,item);}
      item.variants.add(ordinal);
    }
  });
  if(found.size>LIMITS.discoveredIds)fail('retrieval_resource','Retrieval discovery budget exceeded');
  return {found,logs,discoveryCutoff:logs.some(log=>log.discoveryCutoff)};
}
function roundRobin(groups,maximum=Infinity){
  const queues=[...groups.values()].map(items=>({items,next:0})),ordered=[];
  while(ordered.length<maximum){
    let progressed=false;
    for(const queue of queues){
      if(queue.next<queue.items.length){ordered.push(queue.items[queue.next++]);progressed=true;}
      if(ordered.length>=maximum)break;
    }
    if(!progressed)break;
  }
  return ordered;
}
function resolveChains(db,found){
  const documentIds=[...new Set([...found.values()].map(item=>item.document_id))].sort((a,b)=>a-b);
  if(documentIds.length>LIMITS.chainCandidateDocuments)
    fail('retrieval_resource','Retrieval chain document budget exceeded');
  const parent=new Map(documentIds.map(id=>[id,id]));
  function root(id){
    let current=id;
    while(parent.get(current)!==current)current=parent.get(current);
    while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,current);id=next;}
    return current;
  }
  function join(a,b){a=root(a);b=root(b);if(a!==b)parent.set(Math.max(a,b),Math.min(a,b));}
  const queue=[...documentIds],seen=new Set(queue),edges=[];
  let links=0,reasonBytes=0;
  const linkQuery=db.prepare(`SELECT parent_document_id,
    length(CAST(reason AS BLOB)) AS reason_bytes FROM source_chain_links
    WHERE document_id=? ORDER BY parent_document_id LIMIT ?`);
  for(let cursor=0;cursor<queue.length;cursor++){
    const child=queue[cursor],rows=linkQuery.all(child,LIMITS.chainLinks-links+1);
    if(rows.length>LIMITS.chainLinks-links)fail('retrieval_resource','Retrieval chain link budget exceeded');
    for(const link of rows){
      links++;reasonBytes+=link.reason_bytes;
      if(reasonBytes>LIMITS.chainReasonBytes)
        fail('retrieval_resource','Retrieval chain audit budget exceeded');
      const ancestor=link.parent_document_id;
      if(!seen.has(ancestor)){
        seen.add(ancestor);queue.push(ancestor);parent.set(ancestor,ancestor);
        if(seen.size>LIMITS.chainNodes)
          fail('retrieval_resource','Retrieval chain node budget exceeded');
      }
      join(child,ancestor);edges.push(child);
    }
  }
  const audited=new Set(edges.map(child=>root(child)));
  for(const item of found.values()){
    const group=root(item.document_id);
    item.chainKey=audited.has(group)?`audited:${group}`:`legacy:${item.origin_chain}`;
  }
  return {nodes:seen.size,links,reasonBytes};
}
function selectPool(db,found,variants){
  const chainWork=resolveChains(db,found);
  const perVariant=variants.map((_,ordinal)=>{
    const chains=new Map();
    for(const item of found.values())if(item.variants.has(ordinal)){
      if(!chains.has(item.chainKey))chains.set(item.chainKey,[]);
      chains.get(item.chainKey).push(item);
    }
    return roundRobin(chains);
  });
  const queues=new Map(perVariant.map((items,index)=>[index,items]));
  const ordered=roundRobin(queues),seen=new Set(),pool=[];
  let quoteBytes=0,oversizedExcluded=0,byteBudgetExcluded=0;
  for(const item of ordered){
    if(seen.has(item.id))continue;
    seen.add(item.id);
    if(item.quote_bytes>LIMITS.quoteBytes){oversizedExcluded++;continue;}
    if(quoteBytes+item.quote_bytes>LIMITS.poolQuoteBytes){byteBudgetExcluded++;continue;}
    pool.push(item);quoteBytes+=item.quote_bytes;
    if(pool.length===LIMITS.poolIds)break;
  }
  const poolCutoff=found.size>seen.size;
  return {pool,poolCutoff,quoteBytes,oversizedExcluded,byteBudgetExcluded,chainWork};
}
function rank(db,pool,variants,logs){
  const quote=db.prepare(`SELECT id,document_id,start_offset,end_offset,locator,quote
    FROM research_passages WHERE id=?`),best=[];
  for(const item of pool){
    const row=quote.get(item.id);
    if(!row||Buffer.byteLength(row.quote)!==item.quote_bytes)
      fail('retrieval_integrity','Passage changed during retrieval');
    const normalizedQuote=normalizePassage(row.quote);
    let winner=null;
    for(const ordinal of item.variants){
      const variant=variants[ordinal];
      const tier=row.quote===variant.query?0:row.quote.includes(variant.query)?1:
        normalizedQuote.includes(variant.normalized)?2:3;
      logs[ordinal].counts[tier]++;
      if(!winner||tier<winner.tier||tier===winner.tier&&ordinal<winner.ordinal)
        winner={tier,ordinal};
    }
    best.push({...item,row,...winner});
  }
  best.sort((a,b)=>a.tier-b.tier||a.ordinal-b.ordinal||a.id-b.id);
  const groups=new Map();
  for(const item of best){
    const key=item.chainKey;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  return roundRobin(groups);
}
function sourceRetrieval(db,sourceId,sha256,url,mime,method,receipt=null){
  const rows=db.prepare(`SELECT id FROM source_retrievals WHERE source_id=? AND sha256=?
    AND final_url=? AND status=200 AND mime=? AND method IN (${method==='manual'?'?':'?,?'})
    ${receipt?'AND url=? AND retrieved_at=?':'AND url=?'} ORDER BY id LIMIT 2`)
    .all(...(receipt?[sourceId,sha256,url,mime,'http','wayback',receipt.url,receipt.retrieved_at]:
      [sourceId,sha256,url,mime,'manual_import',url]));
  return rows.length===1?rows[0].id:null;
}
function provenance(db,row){
  const blank={retrievalId:null,extractionId:null,receiptId:null,originalSha256:null};
  const extraction=db.prepare(`SELECT em.id,em.receipt_id,em.original_sha256,
      receipt.url,receipt.final_url,receipt.status,receipt.retrieved_at,receipt.sha256,
      receipt.mime,receipt.retention,receipt.size,object.mime AS original_mime,object.size AS original_size,
      job.source_policy_id
    FROM extraction_manifests em JOIN fetch_receipts receipt ON receipt.id=em.receipt_id
    JOIN fetch_jobs job ON job.id=receipt.job_id
    JOIN document_originals origin ON origin.document_id=em.document_id AND origin.sha256=em.original_sha256
    JOIN original_objects object ON object.sha256=origin.sha256
    WHERE em.document_id=? ORDER BY em.id DESC LIMIT 1`).get(row.document_id);
  if(extraction){
    if(extraction.status!==200||extraction.retention!=='private'||
      extraction.sha256!==extraction.original_sha256||extraction.final_url!==row.url||
      extraction.mime!==extraction.original_mime||extraction.size!==extraction.original_size||
      extraction.source_policy_id!==row.source)return blank;
    return {extractionId:extraction.id,receiptId:extraction.receipt_id,
      originalSha256:extraction.original_sha256,
      retrievalId:sourceRetrieval(db,row.source_id,extraction.sha256,row.url,
        extraction.mime,'fetch',extraction)};
  }
  if(row.extraction_method!=='utf8-v1')return blank;
  const originals=db.prepare(`SELECT origin.sha256,object.mime FROM document_originals origin
    JOIN original_objects object ON object.sha256=origin.sha256
    WHERE origin.document_id=? ORDER BY origin.sha256 LIMIT 2`).all(row.document_id);
  if(originals.length!==1)return blank;
  const original=originals[0];
  const retrievalId=sourceRetrieval(db,row.source_id,original.sha256,row.url,original.mime,'manual');
  return retrievalId===null?blank:{...blank,retrievalId,originalSha256:original.sha256};
}
function finalPassage(db,id,ids,tier,variantOrdinal,work){
  const lengths=db.prepare(`SELECT length(CAST(s.url AS BLOB)) AS url_bytes,
      length(CAST(s.title AS BLOB)) AS title_bytes,
      length(CAST(s.source AS BLOB)) AS publisher_bytes,
      length(CAST(d.origin_chain AS BLOB)) AS chain_bytes,
      length(CAST(d.extraction_method AS BLOB)) AS method_bytes,
      length(CAST(p.locator AS BLOB)) AS locator_bytes,
      length(CAST(s.evidence AS BLOB)) AS evidence_bytes
    FROM research_passages p JOIN research_documents d ON d.id=p.document_id
    JOIN source_items s ON s.id=d.source_id WHERE p.id=?`).get(id);
  if(!lengths||lengths.evidence_bytes>LIMITS.sourceBodyBytes||
    Object.entries(lengths).some(([key,length])=>key!=='evidence_bytes'&&length>8192))
    fail('retrieval_resource','Passage metadata exceeds retrieval budget');
  work.sourceScanBytes+=lengths.evidence_bytes;
  if(work.sourceScanBytes>LIMITS.sourceScanBytes)
    fail('retrieval_resource','Retrieval source excerpt budget exceeded');
  const row=db.prepare(`SELECT p.id,p.document_id,p.start_offset,p.end_offset,p.locator,p.quote,
      d.source_id,d.kind,d.origin_chain,d.extraction_method,
      s.url,s.title,s.source,s.published_at,s.fetched_at,
      substr(s.evidence,CASE WHEN p.start_offset>300 THEN p.start_offset-299 ELSE 1 END,
        length(p.quote)+600) AS neighbor
    FROM research_passages p JOIN research_documents d ON d.id=p.document_id
    JOIN source_items s ON s.id=d.source_id WHERE p.id=?`).get(id);
  if(!row||Buffer.byteLength(row.quote)>LIMITS.quoteBytes)fail('retrieval_resource','Passage exceeds retrieval quote budget');
  const extraction=ids.extractionId===null?null:db.prepare(`SELECT id,extractor_version,manifest_sha256
    FROM extraction_manifests WHERE id=?`).get(ids.extractionId);
  const retrieval=ids.retrievalId===null?null:db.prepare(`SELECT id,url,final_url,status,retrieved_at,sha256,mime,method
    FROM source_retrievals WHERE id=?`).get(ids.retrievalId);
  const contextStart=Math.max(0,row.start_offset-300),localStart=row.start_offset-contextStart;
  const exact=row.neighbor.slice(localStart,localStart+row.quote.length)===row.quote;
  const neighboringContext=exact?{start:contextStart,end:contextStart+row.neighbor.length,
    text:row.neighbor,scope:'verified_utf16_offsets'}:
    {start:row.start_offset,end:row.end_offset,text:row.quote,scope:'passage_only_offset_mismatch'};
  const {neighbor,...passage}=row;
  return {...passage,passageId:row.id,documentId:row.document_id,sourceId:row.source_id,
    sourceUrl:row.url,sourceTitle:row.title,publisher:row.source,publishedAt:row.published_at,
    sourceSnapshotStoredAt:row.fetched_at,retrievalId:ids.retrievalId,
    retrievedAt:retrieval?.retrieved_at??null,retrievalStatus:retrieval?.status??null,
    retrievalSha256:retrieval?.sha256??null,retrieval,
    receiptId:ids.receiptId,originalSha256:ids.originalSha256,
    extraction:extraction?{id:extraction.id,version:extraction.extractor_version,
      manifestSha256:extraction.manifest_sha256}:null,
    page:null,pageProvenance:'unknown_no_exact_passage_page_mapping',
    neighboringContext,tier,variantOrdinal};
}
function present(db,run,variants,results){
  const current=db.prepare('SELECT MAX(id) id FROM claim_context_versions WHERE claim_id=?').get(run.claim_id).id;
  const state=getClaimState(db,run.claim_id);
  const stale=current!==run.context_version_id||state.restricted||state.status==='superseded';
  const policyChanged=results.length<Math.min(run.candidate_count,run.requested_limit);
  const work={sourceScanBytes:0};
  const passages=stale?[]:results.map(item=>finalPassage(db,item.passage_id,
    {retrievalId:item.source_retrieval_id,extractionId:item.extraction_id,
      receiptId:item.receipt_id,originalSha256:item.original_sha256},item.tier,item.variant_ordinal,work));
  let responseBytes=0;
  for(const passage of passages){
    responseBytes+=Buffer.byteLength(JSON.stringify(passage));
    if(responseBytes>LIMITS.responseBytes)fail('retrieval_resource','Retrieval response budget exceeded');
  }
  const manual=db.prepare(`SELECT outcome,COUNT(*) AS count FROM claim_search_attempts WHERE claim_id=?
    AND outcome IN ('inaccessible','deferred') GROUP BY outcome`).all(run.claim_id);
  const historical=Object.fromEntries(manual.map(row=>[row.outcome,row.count]));
  const gaps=['completeness_unknown','source_independence_unverified',
    ...(run.discovery_cutoff?['discovery_cutoff']:[]),...(run.pool_cutoff?['pool_cutoff']:[]),
    ...(run.candidate_cutoff?['result_cutoff']:[]),...(stale?['stale_or_ineligible_claim']:[]),
    ...(run.oversized_excluded?['oversized_passages_excluded']:[]),
    ...(run.byte_budget_excluded?['quote_byte_budget_exclusions']:[]),
    ...(policyChanged?['source_eligibility_changed']:[]),
    ...(manual.length?['manual_search_history_not_context_bound']:[])];
  return {passages,searchLog:{runId:run.id,claimId:run.claim_id,actorId:run.actor_id,
    requestId:run.request_id,contextVersionId:run.context_version_id,createdAt:run.created_at,
    variants:variants.map(v=>({ordinal:v.ordinal,query:v.query,normalizedQuery:v.normalized_query,
      rawScanned:v.raw_scanned,normalizedScanned:v.normalized_scanned,
      ftsScanned:v.fts_scanned,discoveredCount:v.discovered_count,
      rawCutoff:Boolean(v.raw_cutoff),normalizedCutoff:Boolean(v.normalized_cutoff),
      discoveryCutoff:Boolean(v.discovery_cutoff),
      countScope:'hydrated_pool',tiers:{exact:v.exact_count,phrase:v.phrase_count,
        normalized:v.normalized_count,fts:v.fts_count},outcome:v.outcome})),
    scope:{kind:'local_topic_fts_candidates',ftsScanned:run.fts_scanned,
      discoveredCount:run.discovered_count,
      maxPerIndex:LIMITS.perIndexIds,maxDiscovered:LIMITS.discoveredIds,
      poolCount:run.pool_count,maxPool:LIMITS.poolIds,quoteBytes:run.quote_bytes,
      oversizedExcluded:run.oversized_excluded,byteBudgetExcluded:run.byte_budget_excluded,
      chainNodes:run.chain_nodes,chainLinks:run.chain_links,chainReasonBytes:run.chain_reason_bytes,
      maxChainDocuments:LIMITS.chainCandidateDocuments,maxChainNodes:LIMITS.chainNodes,
      maxChainLinks:LIMITS.chainLinks,maxChainReasonBytes:LIMITS.chainReasonBytes,
      maxQuoteBytes:LIMITS.quoteBytes,maxPoolQuoteBytes:LIMITS.poolQuoteBytes,
      discoveryCutoff:Boolean(run.discovery_cutoff),poolCutoff:Boolean(run.pool_cutoff)}},
    coverage:{current:!stale&&!policyChanged,staleContext:current!==run.context_version_id,
      claimIneligible:state.restricted||state.status==='superseded',policyChanged,
      candidateCount:run.candidate_count,returnedCount:passages.length,
      requestedLimit:run.requested_limit,
      cutoff:Boolean(run.discovery_cutoff||run.pool_cutoff||run.candidate_cutoff||
        run.oversized_excluded||run.byte_budget_excluded),gaps,
      manualSearchHistory:{scope:'all_contexts_unbound',inaccessible:historical.inaccessible??0,
        deferred:historical.deferred??0}}};
}
function retrieveCandidates(input,db){
  const req=validate(input);
  if((req.actorId===null)!==(req.requestId===null))fail('retrieval_invalid','Actor and requestId required together');
  const payload=createHash('sha256').update(JSON.stringify([req.claimId,req.limit,
    req.variants.map(v=>v.query),req.expectedContextVersionId??null])).digest('hex');
  return db.transaction(()=>{
    const prior=req.actorId===null?null:db.prepare(`SELECT * FROM claim_retrieval_runs
      WHERE actor_id=? AND request_id=?`).get(req.actorId,req.requestId);
    if(prior){
      if(prior.payload_sha256!==payload)fail('retrieval_conflict','RequestId already used');
      return present(db,prior,db.prepare(`SELECT * FROM claim_retrieval_variants WHERE run_id=?
        ORDER BY ordinal`).all(prior.id),savedResults(db,prior.id));
    }
    const claim=db.prepare('SELECT id,topic_id FROM research_claims WHERE id=?').get(req.claimId);
    if(!claim)fail('retrieval_invalid','Unknown claim');
    if(req.actorId!==null&&db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(req.actorId)?.role!=='editor')
      fail('retrieval_invalid','Invalid actor');
    const context=db.prepare('SELECT MAX(id) id FROM claim_context_versions WHERE claim_id=?').get(req.claimId).id;
    if(context===null||req.expectedContextVersionId!==undefined&&context!==req.expectedContextVersionId)
      fail('retrieval_stale','Claim context changed');
    const state=getClaimState(db,req.claimId);
    if(state.restricted||state.status==='superseded')fail('retrieval_ineligible','Claim unavailable');
    const discovery=discover(db,claim.topic_id,req.variants);
    const selected=selectPool(db,discovery.found,req.variants);
    const ranked=rank(db,selected.pool,req.variants,discovery.logs),final=ranked.slice(0,req.limit);
    const candidateCutoff=ranked.length>req.limit;
    const run={id:null,claim_id:req.claimId,context_version_id:context,actor_id:req.actorId,
      request_id:req.requestId,created_at:null,requested_limit:req.limit,
      fts_scanned:discovery.logs.reduce((sum,log)=>sum+log.ftsScanned,0),
      discovered_count:discovery.found.size,pool_count:selected.pool.length,
      chain_nodes:selected.chainWork.nodes,chain_links:selected.chainWork.links,
      chain_reason_bytes:selected.chainWork.reasonBytes,
      candidate_count:ranked.length,quote_bytes:selected.quoteBytes,
      oversized_excluded:selected.oversizedExcluded,byte_budget_excluded:selected.byteBudgetExcluded,
      discovery_cutoff:Number(discovery.discoveryCutoff),pool_cutoff:Number(selected.poolCutoff),
      candidate_cutoff:Number(candidateCutoff)};
    const variants=discovery.logs.map(log=>({ordinal:log.ordinal,query:log.query,
      normalized_query:log.normalized,raw_scanned:log.rawScanned,
      normalized_scanned:log.normalizedScanned,fts_scanned:log.ftsScanned,
      discovered_count:log.discoveredCount,
      raw_cutoff:Number(log.rawCutoff),normalized_cutoff:Number(log.normalizedCutoff),
      discovery_cutoff:Number(log.discoveryCutoff),exact_count:log.counts[0],
      phrase_count:log.counts[1],normalized_count:log.counts[2],fts_count:log.counts[3],
      outcome:log.counts.some(Boolean)?'results':'no_results'}));
    if(req.actorId!==null){
      run.id=Number(db.prepare(`INSERT INTO claim_retrieval_runs
        (claim_id,context_version_id,actor_id,request_id,payload_sha256,requested_limit,
          fts_scanned,discovered_count,pool_count,chain_nodes,chain_links,chain_reason_bytes,
          candidate_count,quote_bytes,oversized_excluded,byte_budget_excluded,
          discovery_cutoff,pool_cutoff,candidate_cutoff)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.claimId,context,req.actorId,req.requestId,payload,
          req.limit,run.fts_scanned,run.discovered_count,run.pool_count,
          run.chain_nodes,run.chain_links,run.chain_reason_bytes,run.candidate_count,run.quote_bytes,
          run.oversized_excluded,run.byte_budget_excluded,
          run.discovery_cutoff,run.pool_cutoff,run.candidate_cutoff).lastInsertRowid);
      const insertVariant=db.prepare(`INSERT INTO claim_retrieval_variants
        (run_id,ordinal,query,normalized_query,raw_scanned,normalized_scanned,
          fts_scanned,discovered_count,raw_cutoff,normalized_cutoff,discovery_cutoff,
          exact_count,phrase_count,normalized_count,fts_count,outcome)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for(const v of variants)insertVariant.run(run.id,v.ordinal,v.query,v.normalized_query,
        v.raw_scanned,v.normalized_scanned,v.fts_scanned,v.discovered_count,
        v.raw_cutoff,v.normalized_cutoff,v.discovery_cutoff,v.exact_count,v.phrase_count,
        v.normalized_count,v.fts_count,v.outcome);
      const insertResult=db.prepare(`INSERT INTO claim_retrieval_results
        (run_id,ordinal,passage_id,source_retrieval_id,extraction_id,receipt_id,original_sha256,tier,variant_ordinal)
        VALUES(?,?,?,?,?,?,?,?,?)`);
      final.forEach((item,ordinal)=>{
        const source=db.prepare(`SELECT d.source_id,d.extraction_method,s.url,s.source FROM research_documents d
          JOIN source_items s ON s.id=d.source_id WHERE d.id=?`).get(item.document_id);
        const ids=provenance(db,{document_id:item.document_id,...source});
        insertResult.run(run.id,ordinal,item.id,ids.retrievalId,ids.extractionId,
          ids.receiptId,ids.originalSha256,TIERS[item.tier],item.ordinal);
      });
      return present(db,db.prepare('SELECT * FROM claim_retrieval_runs WHERE id=?').get(run.id),
        variants,savedResults(db,run.id));
    }
    const direct=final.map((item,ordinal)=>{
      const source=db.prepare(`SELECT d.source_id,d.extraction_method,s.url,s.source FROM research_documents d
        JOIN source_items s ON s.id=d.source_id WHERE d.id=?`).get(item.document_id);
      const ids=provenance(db,{document_id:item.document_id,...source});
      return {ordinal,passage_id:item.id,source_retrieval_id:ids.retrievalId,
        extraction_id:ids.extractionId,receipt_id:ids.receiptId,original_sha256:ids.originalSha256,
        tier:TIERS[item.tier],variant_ordinal:item.ordinal};
    });
    return present(db,run,variants,direct);
  }).immediate();
}
function savedResults(db,runId){
  return db.prepare(`SELECT rr.* FROM claim_retrieval_results rr
    JOIN research_passages p ON p.id=rr.passage_id
    JOIN research_documents d ON d.id=p.document_id JOIN source_items s ON s.id=d.source_id
    WHERE rr.run_id=? AND ${eligibilitySql()} ORDER BY rr.ordinal`).all(runId);
}
module.exports={retrieveCandidates,LIMITS};

const {createHash}=require('crypto');
const {getClaimContext}=require('../claim-context');
const {getClaimState}=require('../research-lifecycle');
const {getSourceAccess}=require('../source-provenance');
const {listDocumentExtractions,getExtraction}=require('./extraction-review');
const {projectSourceChains}=require('../source-chains');
const {projectClaimResearch}=require('../claim-research');

function sha256(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function pageMapProjection(db,extractions,passage,evidence) {
  const textSha256=createHash('sha256').update(evidence).digest('hex');
  const candidate=[...extractions].reverse().find(extraction=>
    extraction.review.status==='accepted'&&
    extraction.extractor_version.startsWith('poppler-')&&
    extraction.text_sha256===textSha256);
  if(!candidate)return null;
  const extraction=getExtraction(db,candidate.id);
  const manifest=extraction?.manifest;
  if(!manifest||manifest.schemaVersion!==2||manifest.offsetUnit!=='utf16'||
    manifest.extractorVersion!==candidate.extractor_version||manifest.originalSha256!==candidate.original_sha256||
    manifest.textSha256!==candidate.text_sha256||manifest.textLength!==evidence.length||
    manifest.coordinateUnit!=='pdf-point'||manifest.coordinateOrigin!=='top-left'||
    !Array.isArray(manifest.pages)||!manifest.pages.length||manifest.pages.length>200||
    !Array.isArray(manifest.spans)||manifest.spans.length>50000||
    !Array.isArray(manifest.renders)||manifest.renders.length!==manifest.pages.length||
    passage.start_offset<0||passage.end_offset<=passage.start_offset||passage.end_offset>manifest.textLength)
    throw new Error('Invalid PDF page map');
  const renders=db.prepare(`SELECT page,sha256,size,mime,width,height,renderer_version
    FROM extraction_renders WHERE extraction_id=? ORDER BY page LIMIT 201`).all(candidate.id);
  if(renders.length!==manifest.pages.length||renders.length>200)throw new Error('Invalid PDF render map');
  const renderByPage=new Map(renders.map(render=>[render.page,render]));
  const pageByNumber=new Map();let previousEnd=-1;
  for(const [index,page] of manifest.pages.entries()) {
    const render=renderByPage.get(page?.page),declared=manifest.renders[index];
    if(!Number.isSafeInteger(page?.page)||page.page!==index+1||!Number.isSafeInteger(page.start)||
      !Number.isSafeInteger(page.end)||page.start<0||page.end<page.start||page.end>manifest.textLength||
      page.start<previousEnd||!Number.isFinite(page.width)||!Number.isFinite(page.height)||
      page.width<=0||page.height<=0||page.width>14400||page.height>14400||
      !['native','ocr'].includes(page.textMethod)||!render||!declared||declared.page!==page.page||
      declared.mime!=='image/png'||!sha256(declared.sha256)||declared.sha256!==render.sha256||
      declared.size!==render.size||declared.width!==render.width||declared.height!==render.height||
      declared.rendererVersion!==render.renderer_version||
      render.mime!=='image/png'||render.width<1||render.width>1600||render.height<1||render.height>1600||
      !Number.isSafeInteger(render.size)||render.size<1||render.size>8388608||
      render.renderer_version!==candidate.extractor_version)
      throw new Error('Invalid PDF page map');
    previousEnd=page.end;pageByNumber.set(page.page,page);
  }
  const relevantPages=manifest.pages.filter(page=>page.start<passage.end_offset&&page.end>passage.start_offset);
  if(!relevantPages.length)throw new Error('Passage has no PDF page map');
  const pageNumbers=relevantPages.map(page=>page.page);
  const contiguous=pageNumbers.every((page,index)=>index===0||page===pageNumbers[index-1]+1);
  const canonicalLocator=pageNumbers.length===1?`page ${pageNumbers[0]}`:
    contiguous?`pages ${pageNumbers[0]}-${pageNumbers.at(-1)}`:`pages ${pageNumbers.join(', ')}`;
  if(passage.locator!==null&&passage.locator!==canonicalLocator)
    throw new Error('PDF passage locator conflicts with page map');
  const words=[];
  for(const word of manifest.spans) {
    if(!Number.isSafeInteger(word?.start)||!Number.isSafeInteger(word.end)||word.start<0||
      word.end<=word.start||word.end>manifest.textLength||!Number.isSafeInteger(word.page)||
      !pageByNumber.has(word.page)||!['native','ocr'].includes(word.method)||
      ![word.xMin,word.yMin,word.xMax,word.yMax].every(Number.isFinite))
      throw new Error('Invalid PDF word map');
    const page=pageByNumber.get(word.page);
    if(word.start<page.start||word.end>page.end||word.xMin<0||word.yMin<0||
      word.xMax<word.xMin||word.yMax<word.yMin||word.xMax>page.width||word.yMax>page.height)
      throw new Error('Invalid PDF word map');
    if(word.start<passage.end_offset&&word.end>passage.start_offset)words.push({
      start:word.start,end:word.end,page:word.page,xMin:word.xMin,yMin:word.yMin,
      xMax:word.xMax,yMax:word.yMax,method:word.method});
  }
  if(!words.length||words.length>5000)throw new Error('Invalid PDF passage map size');
  return {extractionId:candidate.id,manifestSha256:candidate.manifest_sha256,
    originalSha256:candidate.original_sha256,textSha256:candidate.text_sha256,textLength:manifest.textLength,
    passageSha256:createHash('sha256').update(evidence.slice(passage.start_offset,passage.end_offset)).digest('hex'),
    extractorVersion:candidate.extractor_version,offsetUnit:'utf16',coordinateUnit:'pdf-point',
    coordinateOrigin:'top-left',passageStart:passage.start_offset,passageEnd:passage.end_offset,canonicalLocator,
    pages:relevantPages.map(page=>{const render=renderByPage.get(page.page);return {
      page:page.page,start:page.start,end:page.end,width:page.width,height:page.height,textMethod:page.textMethod,
      render:{sha256:render.sha256,size:render.size,mime:render.mime,width:render.width,
        height:render.height,rendererVersion:render.renderer_version}};}),words};
}

// Editor-only snapshot. Private evidence here is not permission to send it to a
// model or publish it. No coverage/independence claim is inferred from a count.
function buildEvidencePacket(db,claimId) {
  if(!Number.isSafeInteger(claimId) || claimId<1) throw new Error('Invalid claim');
  return db.transaction(()=>{
    const state=getClaimState(db,claimId);
    const claim=db.prepare('SELECT * FROM research_claims WHERE id=?').get(claimId);
    const context=getClaimContext(db,claimId);
    const history=db.prepare(`SELECT a.*,r.actor_id,r.context_version_id FROM research_assessments a
      JOIN human_assessment_reviews r ON r.assessment_id=a.id
      WHERE a.claim_id=? ORDER BY a.id LIMIT 1001`).all(claimId);
    if(history.length>1000) throw new Error('Invalid packet size; narrow review scope');
    const gaps=new Set(['search_coverage_unverified','source_independence_unverified']);
    const latest=new Map();
    for(const row of history) {
      if(row.context_version_id!==(context?.id ?? null)) {gaps.add('stale_assessments');continue;}
      latest.set(`${row.actor_id}:${row.passage_id}`,row);
    }
    const passages=new Map(),chains=new Map();
    let size=0;
    for(const assessment of latest.values()) {
      const row=db.prepare(`SELECT p.*,d.source_id,d.kind,d.origin_chain,d.extraction_method,
        s.url,s.title,s.published_at,s.evidence FROM research_passages p
        JOIN research_documents d ON d.id=p.document_id JOIN source_items s ON s.id=d.source_id WHERE p.id=?`).get(assessment.passage_id);
      const access=getSourceAccess(db,row.source_id);
      if(access.policy==='restricted') {gaps.add('restricted_evidence');continue;}
      if(!passages.has(row.id)) {
        const {evidence,...passage}=row;
        const contextStart=Math.max(0,row.start_offset-300),contextEnd=Math.min(evidence.length,row.end_offset+300);
        size+=row.quote.length+(contextEnd-contextStart);
        if(size>2000000) throw new Error('Invalid packet size; narrow review scope');
        const extractions=listDocumentExtractions(db,row.document_id);
        const qualityStatus=!extractions.length?'unverified':extractions.some(e=>e.review.status==='rejected')?'rejected':
          extractions.every(e=>e.review.status==='accepted')?'accepted':'unreviewed';
        if(qualityStatus!=='accepted') gaps.add(`extraction_quality_${qualityStatus}`);
        const extractionQuality={status:qualityStatus,manifests:extractions.map(e=>({id:e.id,
          sha256:e.manifest_sha256,extractorVersion:e.extractor_version,textSha256:e.text_sha256,
          originalSha256:e.original_sha256,review:{status:e.review.status,eventId:e.review.eventId}})),
          pageMap:pageMapProjection(db,extractions,row,evidence)};
        if(extractionQuality.pageMap&&passage.locator===null)
          passage.locator=extractionQuality.pageMap.canonicalLocator;
        size+=Buffer.byteLength(JSON.stringify(extractionQuality),'utf8');
        if(size>2000000) throw new Error('Invalid packet size; narrow review scope');
        passages.set(row.id,{...passage,access,extractionQuality,
          neighboringContext:{start:contextStart,end:contextEnd,text:evidence.slice(contextStart,contextEnd)},assessments:[]});
        if(!chains.has(row.origin_chain)) chains.set(row.origin_chain,new Set());
        chains.get(row.origin_chain).add(row.document_id);
      }
      passages.get(row.id).assessments.push(assessment);
    }
    const ordered=[...passages.values()].sort((a,b)=>a.id-b.id);
    if(!ordered.length) gaps.add('no_current_reviewed_evidence');
    const counterevidence=ordered.filter(p=>p.assessments.some(a=>a.relation==='contradicts')).map(p=>p.id);
    const sourceChainProjection=projectSourceChains(db,[...new Set(ordered.map(p=>p.document_id))]);
    const claimResearch=projectClaimResearch(db,claimId);
    if(claimResearch.relationshipHistory.some(row=>row.type==='component_of'&&row.inactiveReason==='stale_review'))
      gaps.add('stale_component_relationship');
    for(const dimension of ['origin','context','support','counterevidence','source_independence','identity']) {
      if(claimResearch.coverage[dimension].state!=='reviewed')gaps.add(`${dimension}_coverage_${claimResearch.coverage[dimension].state}`);
    }
    if((claimResearch.searchOutcomes.inaccessible??0)>0)gaps.add('inaccessible_sources_recorded');
    if((claimResearch.searchOutcomes.deferred??0)>0)gaps.add('deferred_searches_recorded');
    const packet={schemaVersion:2,claim:{...claim,...state},context,passages:ordered,counterevidence,
      sources:[...chains].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([originChain,ids])=>({originChain,documentIds:[...ids].sort((a,b)=>a-b)})),
      sourceChainProjection,claimResearch,
      coverage:{complete:false,gaps:[...gaps].sort()}};
    return {...packet,version:createHash('sha256').update(JSON.stringify(packet)).digest('hex')};
  }).deferred();
}
module.exports={buildEvidencePacket};

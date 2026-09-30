const {createHash}=require('crypto');
const MAX_REQUEST_BYTES=131072;
const MAX_OUTPUT_BYTES=65536;
const MAX_PASSAGES=100;

function failure(code) { return Object.assign(new Error(`Grounded draft ${code}`),{code}); }
function record(value) { return value!==null&&typeof value==='object'&&!Array.isArray(value); }
function exact(value,names) { return record(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)); }
function string(value,max=4000) { return typeof value==='string'&&value.trim().length>0&&value.length<=max; }
function id(value) { return Number.isSafeInteger(value)&&value>0; }
function ids(value,allowed,max=20) {
  return Array.isArray(value)&&value.length<=max&&new Set(value).size===value.length&&value.every(item=>id(item)&&allowed.has(item));
}
function boundedJson(value,limit,code) {
  let json;
  try {json=JSON.stringify(value);} catch {throw failure(code);}
  if(typeof json!=='string'||Buffer.byteLength(json,'utf8')>limit)throw failure(code);
  return JSON.parse(json);
}
function packetInput({claimVersionId,evidencePacket,model,promptVersion}) {
  const packet=boundedJson(evidencePacket,2400000,'invalid_request');
  if(!exact(packet,['schemaVersion','claim','context','passages','counterevidence','sources',
    'sourceChainProjection','claimResearch','coverage','version']))throw failure('invalid_request');
  const {version,...unsigned}=packet;
  if(createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')!==version)
    throw failure('invalid_request');
  if(!id(claimVersionId)||!string(model,120)||!string(promptVersion,120)||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/.test(model)||
    !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/.test(promptVersion)||
    packet.schemaVersion!==2||!/^[a-f0-9]{64}$/.test(packet.version)||
    !record(packet.claim)||!id(packet.claim.id)||!string(packet.claim.wording,16000)||
    !record(packet.context)||!id(packet.context.id)||
    packet.context.claimId!==packet.claim.id||
    claimVersionId!==packet.context.id||
    !Array.isArray(packet.passages)||packet.passages.length<1||
    packet.passages.length>MAX_PASSAGES||
    !Array.isArray(packet.counterevidence)||
    !exact(packet.coverage,['complete','gaps'])||packet.coverage.complete!==false||
    !Array.isArray(packet.coverage.gaps)||packet.coverage.gaps.length>100||
    packet.coverage.gaps.some(gap=>!string(gap,120)))throw failure('invalid_request');
  const contextId=packet.context.id;
  const passages=packet.passages.map(passage=>{
    if(!id(passage?.id)||!string(passage.quote,16000)||
      !id(passage.document_id)||!id(passage.source_id)||
      !record(passage.access)||
      !['private','excerpt_only','public_original'].includes(passage.access.policy)||
      (passage.access.eventId!==null&&!id(passage.access.eventId))||
      !record(passage.extractionQuality)||
      !['accepted','unverified','unreviewed','rejected'].includes(passage.extractionQuality.status)||
      !Array.isArray(passage.extractionQuality.manifests)||
      passage.extractionQuality.manifests.length>50||
      !record(passage.neighboringContext)||
      !string(passage.neighboringContext.text,20000)||
      !Array.isArray(passage.assessments)||!passage.assessments.length||
      passage.assessments.length>20)throw failure('invalid_request');
    const reviews=passage.extractionQuality.manifests.map(manifest=>{
      if(!id(manifest?.id)||!record(manifest.review)||
        !['accepted','rejected','unreviewed'].includes(manifest.review.status))
        throw failure('invalid_request');
      return manifest.review.status;
    });
    const actualQuality=!reviews.length?'unverified':reviews.includes('rejected')?'rejected':
      reviews.every(status=>status==='accepted')?'accepted':'unreviewed';
    if(actualQuality!==passage.extractionQuality.status)
      throw failure('invalid_request');
    for(const a of passage.assessments)if(!record(a)||!id(a.id)||
      a.claim_id!==packet.claim.id||a.passage_id!==passage.id||!id(a.actor_id)||
      a.context_version_id!==contextId||
      !['direct','background','unrelated','uncertain'].includes(a.relevance)||
      !['supports','contradicts','mentions_only','insufficient'].includes(a.relation)||
      !['mention','allegation','testimony','finding','other','uncertain'].includes(a.evidence_type))
      throw failure('invalid_request');
    return {id:passage.id,quote:passage.quote,context:passage.neighboringContext.text,
      sourceUrl:typeof passage.url==='string'?passage.url:null,
      publishedAt:typeof passage.published_at==='string'?passage.published_at:null,
      locator:typeof passage.locator==='string'?passage.locator:null,
      extractionQuality:passage.extractionQuality?.status||'unverified',
      relations:passage.assessments.map(a=>a.relation)};
  });
  const allowed=new Set(passages.map(p=>p.id));
  const passageQuotes=new Map(packet.passages.map(p=>[p.id,p.quote]));
  const derivedCounterevidence=packet.passages.filter(p=>
    p.assessments.some(a=>a.relation==='contradicts')).map(p=>p.id);
  if(allowed.size!==passages.length||!ids(packet.counterevidence,allowed,MAX_PASSAGES)||
    JSON.stringify(packet.counterevidence)!==JSON.stringify(derivedCounterevidence))
    throw failure('invalid_request');
  const qualificationReasons=['coverage_incomplete','search_date_unverified'];
  if(passages.length<2)qualificationReasons.push('sparse_evidence');
  if(derivedCounterevidence.length)qualificationReasons.push('contradictory_evidence');
  if(passages.some(p=>p.extractionQuality!=='accepted'))
    qualificationReasons.push('extraction_not_accepted');
  const request={claimVersionId,packetVersion:packet.version,
    claim:{wording:packet.claim.wording,
      attribution:packet.claim.attribution||null,
      normalizedWording:packet.context?.normalizedWording||null},
    passages,counterevidence:derivedCounterevidence,
    coverageGaps:packet.coverage.gaps,qualificationReasons,
    asOfDate:null};
  return {request:boundedJson(request,MAX_REQUEST_BYTES,'request_too_large'),allowed,
    counterevidence:derivedCounterevidence,coverageGaps:packet.coverage.gaps,
    qualificationReasons,passageQuotes};
}
function validateDraft(output,boundary) {
  const bad=()=>{throw failure('invalid_response');};
  if(!exact(output,['blocks','assertions','citations','uncertainties','chronology','summary'])||
    !Array.isArray(output.blocks)||output.blocks.length<1||output.blocks.length>30||
    !Array.isArray(output.assertions)||output.assertions.length>40||
    !Array.isArray(output.citations)||output.citations.length>80||
    !Array.isArray(output.uncertainties)||output.uncertainties.length<1||output.uncertainties.length>30||
    !Array.isArray(output.chronology)||output.chronology.length>30||
    !exact(output.summary,['support','contradiction','unknown','disposition'])||
    output.summary.disposition!=='unresolved'||
    !['support','contradiction','unknown'].every(key=>string(output.summary[key],3000)))bad();
  for(const block of output.blocks)
    if(!exact(block,['kind','text','passageIds'])||!['evidence','inference','limitation'].includes(block.kind)||
      !string(block.text)||!ids(block.passageIds,boundary.allowed)||
      (block.kind==='evidence'&&!block.passageIds.length))bad();
  for(const assertion of output.assertions)
    if(!exact(assertion,['text','status','passageIds'])||!string(assertion.text)||
      !['supported','contradicted','uncertain'].includes(assertion.status)||
      !ids(assertion.passageIds,boundary.allowed)||!assertion.passageIds.length)bad();
  for(const citation of output.citations) {
    if(!exact(citation,['passageId','quoteSpans'])||!boundary.allowed.has(citation.passageId)||
      !Array.isArray(citation.quoteSpans)||citation.quoteSpans.length>10)bad();
    const source=boundary.passageQuotes.get(citation.passageId);
    for(const span of citation.quoteSpans)
      if(!exact(span,['text','start','end'])||!string(span.text,16000)||
        !Number.isSafeInteger(span.start)||!Number.isSafeInteger(span.end)||span.start<0||
        span.end<=span.start||span.end>source.length||source.slice(span.start,span.end)!==span.text)bad();
  }
  if(new Set(output.citations.map(c=>c.passageId)).size!==output.citations.length)bad();
  const cited=new Set(output.citations.map(c=>c.passageId));
  if(output.blocks.some(b=>b.passageIds.some(p=>!cited.has(p)))||
    output.assertions.some(a=>a.passageIds.some(p=>!cited.has(p))))bad();
  for(const uncertainty of output.uncertainties)
    if(!exact(uncertainty,['text','passageIds'])||!string(uncertainty.text)||
      !ids(uncertainty.passageIds,boundary.allowed))bad();
  for(const event of output.chronology)
    if(!exact(event,['date','text','passageIds'])||
      (event.date!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(event.date))||
      !string(event.text)||!ids(event.passageIds,boundary.allowed)||!event.passageIds.length)bad();
  if(boundary.counterevidence.some(id=>
    !output.uncertainties.some(u=>u.passageIds.includes(id))&&
    !output.assertions.some(a=>a.status==='contradicted'&&a.passageIds.includes(id))))bad();
  // The current packet does not certify comprehensive research or its search date.
  if(!output.blocks.some(b=>b.kind==='limitation')||
    output.assertions.some(a=>a.status==='supported'))bad();
  return {...output,limitations:{asOfDate:null,coverageComplete:false,
    coverageGaps:[...boundary.coverageGaps],searchDateVerified:false},
  qualification:{status:'editor_only_unresolved',reasons:[...boundary.qualificationReasons],
    findingEstablished:false},publicationAllowed:false,requiresHumanReview:true};
}
async function complete(client,request,model,promptVersion) {
  if(typeof client?.complete!=='function')throw failure('invalid_request');
  let response;
  try {response=await client.complete(request);} catch {throw failure('provider_error');}
  const bounded=boundedJson(response,MAX_OUTPUT_BYTES,'response_too_large');
  if(!exact(bounded,['model','promptVersion','output'])||
    bounded.model!==model||bounded.promptVersion!==promptVersion)throw failure('invalid_response');
  return bounded.output;
}
async function writeAnalysis(input,client) {
  if(arguments.length!==2)throw failure('invalid_request');
  return createWriterSession(input,client).write();
}
function createWriterSession(input,client) {
  const boundary=packetInput(input);
  let writes=0;
  async function run(revision) {
    if(writes>=2||(!revision&&writes!==0)||(revision&&writes!==1))
      throw failure('revision_limit');
    writes++;
  const request=boundedJson({stage:revision?'revise':'draft',model:input.model,
    promptVersion:input.promptVersion,maxOutputBytes:MAX_OUTPUT_BYTES,
    instructions:'Use only packet passages. Preserve contradiction and uncertainty. Attribute allegations. State search scope and source limitations. The search as-of date is unverified. Never claim publication approval. Every direct quotation must use double quotation marks and include an exact UTF-16 quote span from the cited passage.',
    evidence:boundary.request,revision},MAX_REQUEST_BYTES,'request_too_large');
  const output=await complete(client,request,input.model,input.promptVersion);
  return validateDraft(output,boundary);
  }
  return {write:()=>run(null),revise:review=>{
    if(!record(review)||!Array.isArray(review.corrections)||!review.corrections.length||
      review.corrections.length>20||review.publicationAllowed!==false||
      review.corrections.some(correction=>!exact(correction,['target','reason','passageIds'])||
        !string(correction.target,160)||!string(correction.reason,2000)||
        !ids(correction.passageIds,boundary.allowed,20)||!correction.passageIds.length))
      throw failure('invalid_request');
    return run({corrections:review.corrections});
  }};
}
module.exports={writeAnalysis,createWriterSession,packetInput,validateDraft,complete,failure,MAX_OUTPUT_BYTES};

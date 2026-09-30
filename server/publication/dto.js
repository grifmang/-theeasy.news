'use strict';
const {createHash}=require('node:crypto');
const {buildEvidencePacket}=require('../evidence/packet');
const {getClaimState}=require('../research-lifecycle');
function fail(code){throw Object.assign(new Error(`Publication DTO ${code}`),{code});}
function plain(value,max){
  if(typeof value!=='string'||!value.trim()||value.length>max||
    /[\x00-\x1f\x7f<>]/.test(value)||/\]\s*\(/.test(value)||
    /(?:javascript|data|file):/i.test(value))fail('invalid_public_text');
  return value;
}
function publicUrl(value){
  if(typeof value!=='string'||value.length>2048)fail('invalid_public_url');
  let url;try{url=new URL(value);}catch{fail('invalid_public_url');}
  const host=url.hostname.toLowerCase();
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||url.search||
    !/^[a-z0-9.-]+$/.test(host)||!host.includes('.')||host.endsWith('.local')||
    host==='localhost'||/\d$/.test(host)&&/^\d+\.\d+\.\d+\.\d+$/.test(host)||
    /%[0-9a-f]{2}/i.test(url.pathname)||
    /(?:archive|originals|storage|private|\.bin(?:$|\/))/i.test(url.pathname))fail('invalid_public_url');
  return url.href;
}
function sha(value){return createHash('sha256').update(value).digest('hex');}
function projectPublicationDto(db,version){
  if(!db?.prepare||!version?.draft||!Number.isSafeInteger(version.id))fail('invalid_request');
  const packet=buildEvidencePacket(db,version.claim_id),state=getClaimState(db,version.claim_id);
  if(packet.version!==version.packet_version||(packet.context?.id??null)!==version.claim_context_version_id||
    state.restricted||state.status==='superseded')fail('version_changed');
  const draft=version.draft,passages=new Map(packet.passages.map(passage=>[passage.id,passage]));
  if(!Array.isArray(draft.blocks)||draft.blocks.length<1||draft.blocks.length>30||
    !Array.isArray(draft.citations)||draft.citations.length<1||draft.citations.length>40||
    draft.publicationAllowed!==false||draft.requiresHumanReview!==true||
    draft.qualification?.findingEstablished!==false)fail('invalid_draft');
  const cited=new Set(),dependencies=new Map();
  // The verifier sees the whole packet, including uncited counterevidence.
  // Track every source that could have influenced its report, not only the
  // excerpts admitted to the public DTO.
  for(const passage of packet.passages){
    if(!['excerpt_only','public_original'].includes(passage.access?.policy))fail('source_not_public');
    const prior=dependencies.get(passage.source_id);
    if(prior&&prior.sourceAccessEventId!==passage.access.eventId)fail('version_changed');
    dependencies.set(passage.source_id,{sourceId:passage.source_id,
      sourceAccessEventId:passage.access.eventId,claimEventId:state.eventId});
  }
  const citations=draft.citations.map(citation=>{
    const passage=passages.get(citation?.passageId);
    if(!passage||!['excerpt_only','public_original'].includes(passage.access?.policy)||
      passage.extractionQuality?.status!=='accepted'||
      !Array.isArray(citation.quoteSpans)||!citation.quoteSpans.length||citation.quoteSpans.length>5)
      fail('source_not_public');
    const excerpts=citation.quoteSpans.map(span=>{
      if(!Number.isSafeInteger(span?.start)||!Number.isSafeInteger(span?.end)||
        span.start<0||span.end<=span.start||span.end>passage.quote.length||
        passage.quote.slice(span.start,span.end)!==span.text)
        fail('citation_changed');
      return plain(span.text,1000);
    });
    const url=passage.access.policy==='public_original'?publicUrl(passage.url):null;
    cited.add(passage.id);
    return {passageId:passage.id,locator:plain(passage.locator,200),excerpts,url};
  });
  const sections=draft.blocks.map(block=>{
    if(!['evidence','inference','limitation'].includes(block?.kind)||
      !Array.isArray(block.passageIds)||block.passageIds.length>20||
      block.passageIds.some(id=>!cited.has(id)))fail('invalid_draft');
    return {kind:block.kind,text:plain(block.text,4000),citationPassageIds:[...block.passageIds]};
  });
  const summary=draft.summary;
  if(!summary||summary.disposition!=='unresolved')fail('invalid_draft');
  const dto={schemaVersion:1,analysisVersionId:version.id,claimId:version.claim_id,
    title:plain(packet.claim.wording,300),attribution:packet.claim.attribution===null?null:
      plain(packet.claim.attribution,300),status:'unresolved',findingEstablished:false,
    summary:{support:plain(summary.support,3000),contradiction:plain(summary.contradiction,3000),
      unknown:plain(summary.unknown,3000)},sections,citations,
    limitations:{coverageComplete:packet.coverage.complete,asOfDate:null,searchDateVerified:false,
      gaps:packet.coverage.gaps.map(gap=>plain(gap,120))}};
  const dtoJson=JSON.stringify(dto),dependencyInventory=[...dependencies.values()]
    .sort((a,b)=>a.sourceId-b.sourceId);
  if(Buffer.byteLength(dtoJson,'utf8')>262144||dependencyInventory.length>40)
    fail('dto_too_large');
  return {dto,dtoJson,dtoSha256:sha(dtoJson),dependencies:dependencyInventory,
    dependencySha256:sha(JSON.stringify(dependencyInventory)),packet};
}
module.exports={projectPublicationDto};

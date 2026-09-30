'use strict';

const {createHash}=require('node:crypto');
const {packetInput,validateDraft}=require('../models/writer');

const MAX_SENTENCES=200;
function fail(code){throw Object.assign(new Error(`Assertion coverage ${code}`),{code});}
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function exact(value,names){return record(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(record(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
function hash(value){return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');}
function blockFingerprint(block){return hash({kind:block.kind,text:block.text,passageIds:block.passageIds});}
function splitSentences(text){
  if(typeof text!=='string'||!text.trim()||text.length>4000)fail('invalid_draft');
  const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
  const sentences=[...segmenter.segment(text)].map(item=>item.segment.trim()).filter(Boolean);
  if(!sentences.length||sentences.length>MAX_SENTENCES||sentences.some(sentence=>sentence.length>2000))
    fail('invalid_draft');
  return sentences;
}
function directQuotes(text){
  const quotes=[];let residue=text;
  for(const pattern of [/"([^"\r\n]{1,2000})"/g,/“([^”\r\n]{1,2000})”/g,/«([^»\r\n]{1,2000})»/g]){
    residue=residue.replace(pattern,(_match,quote)=>{quotes.push(quote);return '';});
  }
  residue=residue.replace(/(^|[\s(])'([^'\r\n]{2,2000})'(?=$|[\s,.;:!?)])/g,
    (_match,prefix,quote)=>{quotes.push(quote);return prefix;});
  const markdown=residue.match(/^>\s*([^\r\n]{1,2000})$/);
  if(markdown){quotes.push(markdown[1]);residue='';}
  if(quotes.length>20||/["“”«»]/.test(residue))fail('invalid_draft');
  return quotes;
}
function requiresPdfPageMap(passage){
  return (typeof passage?.extraction_method==='string'&&passage.extraction_method.startsWith('poppler-'))||
    passage?.extractionQuality?.manifests?.some(manifest=>
    typeof manifest.extractorVersion==='string'&&manifest.extractorVersion.startsWith('poppler-'))===true;
}
function pdfPageValidator(passage){
  if(!requiresPdfPageMap(passage))return ()=>true;
  const map=passage?.extractionQuality?.pageMap;
  if(!record(map)||passage.extractionQuality.status!=='accepted'||
    !Number.isSafeInteger(map.extractionId)||map.extractionId<1||
    ![map.manifestSha256,map.originalSha256,map.textSha256,map.passageSha256]
      .every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))||
    typeof passage.quote!=='string'||
    map.passageSha256!==createHash('sha256').update(passage.quote).digest('hex')||
    map.offsetUnit!=='utf16'||
    map.coordinateUnit!=='pdf-point'||map.coordinateOrigin!=='top-left'||
    map.passageStart!==passage.start_offset||map.passageEnd!==passage.end_offset||
    map.passageEnd-map.passageStart!==passage.quote.length||
    typeof map.canonicalLocator!=='string'||map.canonicalLocator!==passage.locator||
    !Number.isSafeInteger(map.textLength)||map.textLength<map.passageEnd||
    !Array.isArray(map.pages)||!map.pages.length||map.pages.length>200||
    !Array.isArray(map.words)||!map.words.length||map.words.length>5000||
    !Array.isArray(passage.extractionQuality.manifests)||
    !passage.extractionQuality.manifests.some(manifest=>manifest.id===map.extractionId&&
      manifest.sha256===map.manifestSha256&&manifest.textSha256===map.textSha256&&
      manifest.originalSha256===map.originalSha256&&manifest.extractorVersion===map.extractorVersion&&
      manifest.review?.status==='accepted'))return ()=>false;
  const pages=new Map();
  for(const [index,page] of map.pages.entries()){
    if(!Number.isSafeInteger(page?.page)||page.page<1||!Number.isSafeInteger(page.start)||!Number.isSafeInteger(page.end)||
      page.start<0||page.end>map.textLength||page.end<page.start||
      page.start>=map.passageEnd||page.end<=map.passageStart||
      (index>0&&(page.page<=map.pages[index-1].page||page.start<map.pages[index-1].end))||
      !Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0||
      !record(page.render)||!/^[a-f0-9]{64}$/.test(page.render.sha256)||page.render.mime!=='image/png'||
      !Number.isSafeInteger(page.render.size)||page.render.size<1||
      !Number.isSafeInteger(page.render.width)||!Number.isSafeInteger(page.render.height)||
      typeof page.render.rendererVersion!=='string'||page.render.rendererVersion!==map.extractorVersion)
      return ()=>false;
    if(pages.has(page.page))return ()=>false;
    pages.set(page.page,page);
  }
  const pageNumbers=map.pages.map(page=>page.page);
  const contiguous=pageNumbers.every((page,index)=>index===0||page===pageNumbers[index-1]+1);
  const canonicalLocator=pageNumbers.length===1?`page ${pageNumbers[0]}`:
    contiguous?`pages ${pageNumbers[0]}-${pageNumbers.at(-1)}`:`pages ${pageNumbers.join(', ')}`;
  if(map.canonicalLocator!==canonicalLocator)return ()=>false;
  const intervals=[];
  for(const word of map.words){
    const page=pages.get(word?.page);
    if(!page||!Number.isSafeInteger(word.start)||!Number.isSafeInteger(word.end)||word.start<page.start||
      word.end<=word.start||word.end>page.end||!['native','ocr'].includes(word.method)||
      ![word.xMin,word.yMin,word.xMax,word.yMax].every(Number.isFinite)||word.xMin<0||word.yMin<0||
      word.xMax<word.xMin||word.yMax<word.yMin||word.xMax>page.width||word.yMax>page.height)return ()=>false;
    intervals.push([word.start,word.end]);
  }
  if(!intervals.length)return ()=>false;
  intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const merged=[];
  for(const interval of intervals){
    const last=merged.at(-1);
    if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);
    else merged.push([...interval]);
  }
  const uncovered=new Uint32Array(passage.quote.length+1);
  let intervalIndex=0;
  for(let offset=0;offset<passage.quote.length;offset++){
    const absolute=map.passageStart+offset;
    while(intervalIndex<merged.length&&absolute>=merged[intervalIndex][1])intervalIndex++;
    uncovered[offset+1]=uncovered[offset]+(
      !/\s/u.test(passage.quote[offset])&&
      (intervalIndex>=merged.length||absolute<merged[intervalIndex][0])?1:0);
  }
  return span=>Number.isSafeInteger(span?.start)&&Number.isSafeInteger(span?.end)&&
    span.start>=0&&span.end>span.start&&span.end<=passage.quote.length&&
    uncovered[span.end]===uncovered[span.start];
}
function validPdfPageMap(passage,span={start:0,end:passage?.quote?.length}){
  return pdfPageValidator(passage)(span);
}

function buildAssertionInventory({draft,packet}){
  if(!record(draft)||!exact(draft.provenance,['claimVersionId','packetVersion','model','promptVersion'])||
    draft.provenance.packetVersion!==packet?.version||draft.publicationAllowed!==false||
    draft.requiresHumanReview!==true||draft.qualification?.findingEstablished!==false)
    fail('version_mismatch');
  let boundary;
  try{boundary=packetInput({claimVersionId:draft.provenance.claimVersionId,evidencePacket:packet,
    model:draft.provenance.model,promptVersion:draft.provenance.promptVersion});}
  catch{fail('invalid_packet');}
  const draftBody=Object.fromEntries(['blocks','assertions','citations','uncertainties','chronology','summary']
    .map(key=>[key,draft[key]]));
  try{validateDraft(draftBody,boundary);}catch{fail('invalid_draft');}
  const passages=new Map(packet.passages.map(passage=>[passage.id,passage]));
  const citationSpans=new Map(draft.citations.map(citation=>[citation.passageId,citation.quoteSpans]));
  const assertions=[];let sequence=0;
  for(let blockIndex=0;blockIndex<draft.blocks.length;blockIndex++){
    const block=draft.blocks[blockIndex];
    if(block.kind==='limitation')continue;
    const blockHash=blockFingerprint(block);
    const sentences=splitSentences(block.text);
    if(assertions.length+sentences.length>MAX_SENTENCES)fail('invalid_draft');
    for(const sentence of sentences){
      sequence++;
      const assertion={id:`sentence-${sequence}`,blockIndex,blockHash,kind:block.kind,text:sentence,
        passageIds:[...block.passageIds],directQuotes:directQuotes(sentence),status:'unchecked'};
      assertions.push({...assertion,assertionHash:hash({blockHash,text:assertion.text,
        passageIds:assertion.passageIds,directQuotes:assertion.directQuotes})});
    }
  }
  if(!assertions.length)fail('invalid_draft');
  const blockingIssues=[];
  const pdfValidationCache=new Map();
  const pdfValid=(passage,span)=>{
    if(!passage)return false;
    if(!pdfValidationCache.has(passage.id))pdfValidationCache.set(passage.id,pdfPageValidator(passage));
    return pdfValidationCache.get(passage.id)(span||{start:0,end:passage.quote.length});
  };
  for(const assertion of assertions){
    if(!assertion.passageIds.length)blockingIssues.push({code:'unmapped_assertion',assertionId:assertion.id});
    for(const quote of assertion.directQuotes){
      const matchingIds=assertion.passageIds.filter(id=>citationSpans.get(id)?.some(span=>span.text===quote));
      if(!matchingIds.length)
        blockingIssues.push({code:'unverified_quote',assertionId:assertion.id});
      for(const id of matchingIds){
        const passage=passages.get(id);
        const spans=citationSpans.get(id).filter(span=>span.text===quote);
        if(requiresPdfPageMap(passage)&&!spans.some(span=>pdfValid(passage,span)))
          blockingIssues.push({code:'pdf_page_map_required',assertionId:assertion.id,passageId:id});
      }
    }
    for(const passageId of assertion.passageIds){
      const passage=passages.get(passageId);
      if(!passage)blockingIssues.push({code:'unknown_passage',assertionId:assertion.id,passageId});
      else if(passage.extractionQuality?.status!=='accepted')
        blockingIssues.push({code:'extraction_review_required',assertionId:assertion.id,passageId});
      else if(requiresPdfPageMap(passage)&&!pdfValid(passage))
        blockingIssues.push({code:'pdf_page_map_required',assertionId:assertion.id,passageId});
    }
  }
  if(packet.coverage.complete!==true)blockingIssues.push({code:'coverage_incomplete'});
  if(boundary.counterevidence.length)blockingIssues.push({code:'counterevidence_requires_semantic_review'});
  blockingIssues.push({code:'semantic_review_required'});
  const uniqueIssues=[];const seen=new Set();
  for(const issue of blockingIssues){const key=JSON.stringify(issue);if(!seen.has(key)){seen.add(key);uniqueIssues.push(issue);}}
  const checkedVersionHash=hash({packetVersion:packet.version,provenance:draft.provenance,
    blocks:draft.blocks,assertions:draft.assertions,citations:draft.citations,policyStage:'mechanical-v1'});
  return {blockingIssues:uniqueIssues,assertions,coverage:{total:assertions.length,
    mapped:assertions.filter(assertion=>assertion.passageIds.length>0).length,
    acceptedExtraction:assertions.filter(assertion=>assertion.passageIds.length>0&&
      assertion.passageIds.every(id=>passages.get(id)?.extractionQuality?.status==='accepted')).length},
    checkedVersionHash,stage:'mechanical_only'};
}

function planChangedBlockRecheck({previousDraft,currentDraft,packet}){
  const current=buildAssertionInventory({draft:currentDraft,packet});
  if(!record(previousDraft)||!record(previousDraft.provenance))fail('invalid_previous_draft');
  const all=currentDraft.blocks.map((_block,index)=>index);
  const previousDraftHash=hash(previousDraft),currentDraftHash=hash(currentDraft);
  if(previousDraft.provenance.packetVersion!==packet.version)
    return {previousDraftHash,currentDraftHash,previousCheckedVersionHash:null,
      currentCheckedVersionHash:current.checkedVersionHash,
      recheckBlockIndexes:all,unchangedBlockPairs:[],reason:'packet_changed'};
  let previous;
  try{previous=buildAssertionInventory({draft:previousDraft,packet});}
  catch{fail('invalid_previous_draft');}
  const provenanceChanged=['claimVersionId','model','promptVersion'].some(key=>
    previousDraft.provenance[key]!==currentDraft.provenance[key]);
  const supportingStructureChanged=JSON.stringify(stable({assertions:previousDraft.assertions,
    citations:previousDraft.citations,uncertainties:previousDraft.uncertainties,
    chronology:previousDraft.chronology,summary:previousDraft.summary}))!==
    JSON.stringify(stable({assertions:currentDraft.assertions,citations:currentDraft.citations,
      uncertainties:currentDraft.uncertainties,chronology:currentDraft.chronology,summary:currentDraft.summary}));
  if(provenanceChanged||supportingStructureChanged)
    return {previousDraftHash,currentDraftHash,previousCheckedVersionHash:previous.checkedVersionHash,
      currentCheckedVersionHash:current.checkedVersionHash,recheckBlockIndexes:all,
      unchangedBlockPairs:[],reason:provenanceChanged?'provenance_changed':'supporting_structure_changed'};
  const previousHashes=previousDraft.blocks.map(blockFingerprint),currentHashes=currentDraft.blocks.map(blockFingerprint);
  const previousCounts=new Map(),currentCounts=new Map();
  for(const value of previousHashes)previousCounts.set(value,(previousCounts.get(value)||0)+1);
  for(const value of currentHashes)currentCounts.set(value,(currentCounts.get(value)||0)+1);
  const unchangedBlockPairs=[],recheckBlockIndexes=[];
  for(const [currentBlockIndex,blockHash] of currentHashes.entries()){
    if(previousCounts.get(blockHash)===1&&currentCounts.get(blockHash)===1)
      unchangedBlockPairs.push({previousBlockIndex:previousHashes.indexOf(blockHash),currentBlockIndex,blockHash});
    else recheckBlockIndexes.push(currentBlockIndex);
  }
  return {previousDraftHash,currentDraftHash,previousCheckedVersionHash:previous.checkedVersionHash,
    currentCheckedVersionHash:current.checkedVersionHash,recheckBlockIndexes,
    unchangedBlockPairs,reason:recheckBlockIndexes.length?'blocks_changed':'unchanged'};
}

module.exports={buildAssertionInventory,planChangedBlockRecheck,splitSentences,directQuotes,
  requiresPdfPageMap,validPdfPageMap,blockFingerprint,MAX_SENTENCES};

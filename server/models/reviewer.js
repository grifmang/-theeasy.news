const {packetInput,validateDraft,complete,failure,MAX_OUTPUT_BYTES}=require('./writer');

async function reviewAnalysis(input,draft,client) {
  const boundary=packetInput(input);
  if(!draft||typeof draft!=='object'||!Array.isArray(draft.blocks)||
    !Array.isArray(draft.citations))throw failure('invalid_request');
  const draftBody=Object.fromEntries(['blocks','assertions','citations','uncertainties','chronology','summary']
    .map(key=>[key,draft[key]]));
  try {validateDraft(draftBody,boundary);} catch {throw failure('invalid_request');}
  const request={stage:'review',model:input.model,promptVersion:input.promptVersion,
    maxOutputBytes:MAX_OUTPUT_BYTES,
    instructions:'Propose corrections only with packet passage references. Check attribution, contradictory evidence, unsupported assertions, uncertainty, chronology, as-of and coverage limitations. Do not approve publication.',
    evidence:boundary.request,draft:draftBody};
  let requestBytes;
  try {requestBytes=Buffer.byteLength(JSON.stringify(request),'utf8');}catch {throw failure('invalid_request');}
  if(requestBytes>131072)throw failure('request_too_large');
  const output=await complete(client,request,input.model,input.promptVersion);
  if(!output||typeof output!=='object'||Array.isArray(output)||
    Object.keys(output).length!==1||!Object.hasOwn(output,'corrections')||
    !Array.isArray(output.corrections)||output.corrections.length>20)throw failure('invalid_response');
  for(const correction of output.corrections) {
    if(!correction||typeof correction!=='object'||Array.isArray(correction)||
      Object.keys(correction).length!==3||
      !['target','reason','passageIds'].every(key=>Object.hasOwn(correction,key))||
      typeof correction.target!=='string'||!correction.target.trim()||correction.target.length>160||
      typeof correction.reason!=='string'||!correction.reason.trim()||correction.reason.length>2000||
      !Array.isArray(correction.passageIds)||!correction.passageIds.length||
      correction.passageIds.length>20||new Set(correction.passageIds).size!==correction.passageIds.length||
      correction.passageIds.some(id=>!boundary.allowed.has(id)))throw failure('invalid_response');
  }
  return {corrections:output.corrections,publicationAllowed:false};
}
module.exports={reviewAnalysis};

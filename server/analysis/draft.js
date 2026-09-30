const {createWriterSession}=require('../models/writer');
const {reviewAnalysis}=require('../models/reviewer');

// Offline contract only. The caller must own model selection, permission, budget,
// durable request identity, and transport. Nothing here stores or publishes text.
// Before provider admission, a future caller must rebuild and compare the current
// packet from trusted storage; this unwired contract cannot establish DB freshness.
async function draftAnalysis(input,client) {
  const writer=createWriterSession(input,client);
  let draft=await writer.write();
  let review=await reviewAnalysis(input,draft,client);
  let revisions=0;
  if(review.corrections.length) {
    draft=await writer.revise(review);
    revisions=1;
    review=await reviewAnalysis(input,draft,client);
  }
  return {...draft,
    provenance:{claimVersionId:input.claimVersionId,packetVersion:input.evidencePacket.version,
      model:input.model,promptVersion:input.promptVersion},
    review,revisions,publicationAllowed:false,
    requiresHumanReview:true};
}
module.exports={draftAnalysis};

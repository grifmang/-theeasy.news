const {finishClaimJob,reviewEvent,STAGE}=require('./claim-jobs');
const {hashPassageInput}=require('./models/jev');
const {routeDecision}=require('./models/policy');

// Builds evidence from immutable rows, not worker-supplied claim/passage text.
// This function does not authorize external disclosure of private evidence.
function prepareClaimEvaluation(db,jobId) {
  const job=db.prepare('SELECT * FROM claim_jobs WHERE id=?').get(jobId);
  if(!job) throw new Error('Unknown claim job');
  if(job.stage!==STAGE||job.model!=='jev-1.13.0'||job.question_version!=='passage-v1'||
    job.policy_version!=='passage-shadow-v1')throw new Error('Unsupported claim job identity');
  const claim=db.prepare('SELECT * FROM research_claims WHERE id=?').get(job.claim_id);
  const context=job.context_version_id===null?null:db.prepare('SELECT * FROM claim_context_versions WHERE id=? AND claim_id=?').get(job.context_version_id,claim.id);
  if(job.context_version_id!==null && !context) throw new Error('Invalid claim context');
  const passage=db.prepare(`SELECT p.*,d.kind,d.origin_chain,s.title,s.url,s.published_at,s.evidence
    FROM research_passages p JOIN research_documents d ON d.id=p.document_id
    JOIN source_items s ON s.id=d.source_id WHERE p.id=?`).get(job.passage_id);
  if(!passage) throw new Error('Unknown passage');
  return {model:job.model,questionVersion:job.question_version,
    claim:JSON.stringify({id:claim.id,original:claim.wording,attribution:claim.attribution,originUrl:claim.origin_url,
      contextVersionId:job.context_version_id,normalized:context?.normalized_wording ?? null}),
    passage:passage.quote,
    context:JSON.stringify({documentId:passage.document_id,passageId:passage.id,locator:passage.locator,
      kind:passage.kind,title:passage.title,url:passage.url,publishedAt:passage.published_at,originChain:passage.origin_chain,
      observedAt:context?.observed_at ?? null,entities:context?JSON.parse(context.entities_json):[],
      timeframe:context?.timeframe ?? null,location:context?.location ?? null,
      surroundingText:passage.evidence.slice(Math.max(0,passage.start_offset-300),Math.min(passage.evidence.length,passage.end_offset+300))})};
}
function commitClaimDecision(db,job,reservationId,{now=Date.now()}={}) {
  if(!Number.isSafeInteger(reservationId) || reservationId<1) throw new Error('Invalid reservation');
  return db.transaction(()=>{
    // finish validates the authoritative lease and current evidence eligibility.
    // Any subsequent error rolls this state change back with the decision insert.
    if(!finishClaimJob(db,job,{now})) return false;
    const current=db.prepare('SELECT * FROM claim_jobs WHERE id=?').get(job.id);
    const inputHash=hashPassageInput(prepareClaimEvaluation(db,current.id));
    const saved=db.prepare(`SELECT a.input_hash,r.result_json FROM model_call_attempts a
      JOIN model_call_results r ON r.reservation_id=a.reservation_id
      WHERE a.reservation_id=? AND r.status='succeeded'`).get(reservationId);
    if(!saved || saved.input_hash!==inputHash) throw new Error('Model result does not match claim job input');
    const result=JSON.parse(saved.result_json);
    // All claims remain human-review-required until a validated risk policy exists.
    const routing=routeDecision(result.answers.relation,{mode:'shadow',highRisk:true});
    if(routing.policyVersion!==current.policy_version) throw new Error('Decision policy does not match job');
    db.prepare('INSERT INTO claim_decisions(job_id,reservation_id,input_hash,policy_version,routing_json) VALUES(?,?,?,?,?)')
      .run(current.id,reservationId,inputHash,current.policy_version,JSON.stringify(routing));
    reviewEvent(db,{jobId:current.id,kind:'decision_recorded',reason:'shadow_review_required',
      key:`job:${current.id}:decision`,now});
    return true;
  }).immediate();
}
module.exports={prepareClaimEvaluation,commitClaimDecision};

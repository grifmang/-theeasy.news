const {assessPassage}=require('./research');
const {getClaimContext}=require('./claim-context');
const {getClaimState}=require('./research-lifecycle');

// Internal service: HTTP middleware supplies authorized editor identity.
function recordHumanAssessment(db,input) {
  const {claimId,actorId,expectedVersionId}=input;
  if(!Number.isSafeInteger(actorId) || actorId<1) throw new Error('Invalid actor');
  if(expectedVersionId!==null && (!Number.isSafeInteger(expectedVersionId) || expectedVersionId<1)) throw new Error('Invalid expected version');
  return db.transaction(()=>{
    const context=getClaimContext(db,claimId);
    if((context?.id ?? null)!==expectedVersionId) throw new Error('Claim context changed');
    if(getClaimState(db,claimId).status==='superseded') throw new Error('Claim already superseded');
    const assessment=assessPassage(db,{...input,reviewer:`user:${actorId}`});
    db.prepare('INSERT INTO human_assessment_reviews(assessment_id,actor_id,context_version_id) VALUES(?,?,?)')
      .run(assessment.id,actorId,expectedVersionId);
    return {...assessment,actor_id:actorId,context_version_id:expectedVersionId,stale:false};
  }).immediate();
}

function listHumanAssessments(db,claimId,after=0) {
  const context=getClaimContext(db,claimId);
  // Unauthenticated legacy assessments deliberately do not enter this projection.
  return db.prepare(`SELECT a.*,r.actor_id,r.context_version_id FROM research_assessments a
    JOIN human_assessment_reviews r ON r.assessment_id=a.id
    WHERE a.claim_id=? AND a.id>? ORDER BY a.id LIMIT 100`).all(claimId,after)
    .map(row=>({...row,stale:row.context_version_id!==(context?.id ?? null)}));
}
module.exports={recordHumanAssessment,listHumanAssessments};

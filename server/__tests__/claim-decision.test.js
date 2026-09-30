const {openStore,migrate}=require('../storage');
const {createTopic,addClaim,importDocument,addPassage}=require('../research');
const {enqueueClaimJob,claimNextJob}=require('../claim-jobs');
const {prepareClaimEvaluation,commitClaimDecision}=require('../claim-decision');
const {runJevCall}=require('../models/jev-call');
const {setSourceAccess}=require('../source-provenance');
const {setPublicationOwner}=require('../publication/owner-authority');
const fs=require('fs'),os=require('os'),path=require('path');
const {createBudgetGuard}=require('../models/budget-guard');
let db,job,document,guard,directory;
beforeEach(()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'en-guard-'));guard=createBudgetGuard(directory);
  db=openStore(':memory:');migrate(db);db.exec("INSERT INTO users(id,username,password) VALUES(1,'fixture','')");
  const topic=createTopic(db,'fixture','Fixture');
  const claim=addClaim(db,{topicId:topic.id,wording:'Fixture claim',attribution:'Fixture',originUrl:'https://example.com'});
  document=importDocument(db,{topicId:topic.id,source:'Fixture',url:'https://example.com',title:'Fixture',content:'Fixture evidence',kind:'report',originChain:'fixture',extractionMethod:'fixture'});
  const passage=addPassage(db,{documentId:document.id,start:0,end:16,locator:'first'});
  enqueueClaimJob(db,{claimId:claim.id,contextVersionId:null,passageId:passage.id,model:'jev-1.13.0',questionVersion:'passage-v1',policyVersion:'passage-shadow-v1'});
  job=claimNextJob(db,{now:0,leaseMs:100});
});
afterEach(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
async function evaluated(override={}) {
  const input={...prepareClaimEvaluation(db,job.id),...override};
  return runJevCall(db,{requestKey:'fixture',input,guard,limits:{dailyMicros:3000,monthlyMicros:3000},now:'2026-09-20T00:00:00.000Z'}, {
    evaluate:async request=>({body:{model:request.model,usage:{input_tokens:100,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,question])=>{
      const options=Object.keys(question.criteria);
      return [key,{type:'choice',choice:options[0],confidence:1,probabilities:Object.fromEntries(options.map((option,index)=>[option,index===0?1:0]))}];
    }))},requestId:'fixture'})
  });
}
test('validated matching result commits decision and job completion together without approving claim',async()=>{
  const call=await evaluated();
  expect(commitClaimDecision(db,job,call.reservationId,{now:1})).toBe(true);
  expect(db.prepare('SELECT state FROM claim_jobs').get().state).toBe('done');
  const decision=db.prepare('SELECT * FROM claim_decisions').get();
  expect(JSON.parse(decision.routing_json)).toMatchObject({route:'review',publicationAllowed:false});
  expect(db.prepare('SELECT COUNT(*) n FROM claim_events').get().n).toBe(0);
  expect(()=>db.exec('DELETE FROM claim_decisions')).toThrow(/immutable/);
});
test('stale lease cannot attach a paid result',async()=>{
  const call=await evaluated();claimNextJob(db,{now:100,leaseMs:100});
  expect(commitClaimDecision(db,job,call.reservationId,{now:101})).toBe(false);
  expect(db.prepare('SELECT COUNT(*) n FROM claim_decisions').get().n).toBe(0);
});
test('a result for different evidence cannot be attached to this job',async()=>{
  const call=await evaluated({passage:'Different evidence'});
  expect(()=>commitClaimDecision(db,job,call.reservationId,{now:1})).toThrow(/match/);
  expect(db.prepare('SELECT state FROM claim_jobs').get().state).toBe('leased');
});
test('new restriction prevents decision persistence and blocks completion',async()=>{
  const call=await evaluated();
  db.exec("INSERT INTO user_roles(user_id,role) VALUES(1,'editor'); INSERT INTO google_identities(subject,user_id) VALUES('fixture-decision-owner',1)");
  setPublicationOwner(db,{subject:'fixture-decision-owner',allowed:true,reason:'Fixture owner grant',operator:'test',expectedEventId:null,requestKey:'fixture-000000000'});
  setSourceAccess(db,{sourceId:document.source_id,actorId:1,policy:'restricted',reason:'Fixture',expectedEventId:null});
  expect(commitClaimDecision(db,job,call.reservationId,{now:1})).toBe(false);
  expect(db.prepare('SELECT COUNT(*) n FROM claim_decisions').get().n).toBe(0);
  expect(db.prepare('SELECT state FROM claim_jobs').get().state).toBe('blocked');
});

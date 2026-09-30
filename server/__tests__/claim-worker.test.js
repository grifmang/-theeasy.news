const {openStore,migrate}=require('../storage');
const {createTopic,addClaim,importDocument,addPassage}=require('../research');
const {enqueueClaimJob,claimNextJob}=require('../claim-jobs');
const {getProviderPermission,setProviderPermission}=require('../provider-permission');
const {prepareClaimEvaluation}=require('../claim-decision');
const {runJevCall}=require('../models/jev-call');
const {runNextClaimJob}=require('../claim-worker');
const fs=require('fs'),os=require('os'),path=require('path');
const {createBudgetGuard}=require('../models/budget-guard');
let db,job,now,calls,guard,directory;
const limits={dailyMicros:3000,monthlyMicros:3000};
const client={evaluate:async request=>{
  calls++;
  return {body:{model:request.model,usage:{input_tokens:100,output_tokens:20},answers:Object.fromEntries(Object.entries(request.questions).map(([key,question])=>{
    const options=Object.keys(question.criteria);
    return [key,{type:'choice',choice:options[0],confidence:1,probabilities:Object.fromEntries(options.map((option,index)=>[option,index===0?1:0]))}];
  }))},requestId:'fixture'};
}};
beforeEach(()=>{
  now=Date.parse('2026-09-20T00:00:00.000Z');calls=0;
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'en-guard-'));guard=createBudgetGuard(directory);
  db=openStore(':memory:');migrate(db);db.exec("INSERT INTO users(id,username,password) VALUES(1,'fixture','')");
  const topic=createTopic(db,'fixture','Fixture');
  const claim=addClaim(db,{topicId:topic.id,wording:'Fixture',attribution:'Fixture',originUrl:'https://example.com'});
  const document=importDocument(db,{topicId:topic.id,source:'Fixture',url:'https://example.com',title:'Fixture',content:'Fixture text',kind:'report',originChain:'fixture',extractionMethod:'fixture'});
  const passage=addPassage(db,{documentId:document.id,start:0,end:12,locator:'first'});
  job=enqueueClaimJob(db,{claimId:claim.id,contextVersionId:null,passageId:passage.id,model:'jev-1.13.0',questionVersion:'passage-v1',policyVersion:'passage-shadow-v1'});
});
afterEach(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
function approve() {const current=getProviderPermission(db,job.id);setProviderPermission(db,{jobId:job.id,actorId:1,allowed:true,reason:'Fixture',expectedEventId:current.eventId,expectedInputHash:current.inputHash});}
const work=(extra={})=>runNextClaimJob({db,client,limits,guard,clock:()=>now,...extra});
test('unapproved work remains queued and makes no provider call',async()=>{
  expect((await work()).status).toBe('idle');expect(calls).toBe(0);
  expect(db.prepare('SELECT state,attempts FROM claim_jobs').get()).toEqual({state:'queued',attempts:0});
});
test('approved work reserves, evaluates and atomically commits a shadow decision',async()=>{
  approve();expect((await work()).status).toBe('done');expect(calls).toBe(1);
  expect(db.prepare('SELECT COUNT(*) n FROM claim_decisions').get().n).toBe(1);
  expect(db.prepare('SELECT state FROM claim_jobs').get().state).toBe('done');
});
test('budget exhaustion defers without consuming a provider attempt',async()=>{
  approve();expect((await work({limits:{dailyMicros:0,monthlyMicros:0}})).status).toBe('budget_exhausted');
  expect(calls).toBe(0);
  expect(db.prepare('SELECT state,attempts FROM claim_jobs').get()).toEqual({state:'retry_wait',attempts:0});
});
test.each([1,3])('recovered lease reuses saved success with maxAttempts=%i',async maxAttempts=>{
  db.prepare('UPDATE claim_jobs SET max_attempts=? WHERE id=?').run(maxAttempts,job.id);
  approve();const first=claimNextJob(db,{now,leaseMs:100});
  await runJevCall(db,{requestKey:`claim-job:${job.id}:attempt:${first.attempts}`,input:prepareClaimEvaluation(db,job.id),limits,guard,now:new Date(now).toISOString()},client);
  now+=101;
  expect((await work()).status).toBe('done');expect(calls).toBe(1);
});
test('an exhausted failed attempt does not gain another provider call through recovery',async()=>{
  db.prepare('UPDATE claim_jobs SET max_attempts=1 WHERE id=?').run(job.id);approve();
  const failing={evaluate:async()=>{calls++;throw new Error('Fixture failure');}};
  await work({client:failing});now+=60000;
  expect((await work({client:failing})).status).toBe('idle');
  expect(calls).toBe(1);
});

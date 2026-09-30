const {openStore,migrate}=require('../storage');
const {createTopic,addClaim,importDocument,addPassage}=require('../research');
const {appendClaimContext}=require('../claim-context');
const {setSourceAccess}=require('../source-provenance');
const {enqueueClaimJob,claimNextJob,finishClaimJob}=require('../claim-jobs');
const {setPublicationOwner}=require('../publication/owner-authority');
let db,claim,document,passage;
beforeEach(()=>{
  db=openStore(':memory:');migrate(db);db.exec("INSERT INTO users(id,username,password) VALUES(1,'fixture','')");
  const topic=createTopic(db,'fixture','Fixture');
  claim=addClaim(db,{topicId:topic.id,wording:'Fixture claim',attribution:'Fixture',originUrl:'https://example.com'});
  document=importDocument(db,{topicId:topic.id,source:'Fixture',url:'https://example.com',title:'Fixture',content:'Fixture evidence',kind:'report',originChain:'fixture',extractionMethod:'fixture'});
  passage=addPassage(db,{documentId:document.id,start:0,end:16,locator:'first'});
});
afterEach(()=>db.close());
const queue=(extra={})=>enqueueClaimJob(db,{claimId:claim.id,contextVersionId:null,passageId:passage.id,model:'jev-1.13.0',questionVersion:'passage-v1',policyVersion:'passage-shadow-v1',...extra});
function grantFixtureOwner(){
  db.exec("INSERT INTO user_roles(user_id,role) VALUES(1,'editor'); INSERT INTO google_identities(subject,user_id) VALUES('fixture-job-owner',1)");
  setPublicationOwner(db,{subject:'fixture-job-owner',allowed:true,reason:'Fixture owner grant',operator:'test',expectedEventId:null,requestKey:'fixture-job-owner-0001'});
}
test('duplicate work reuses a job but different claim versions remain distinct',()=>{
  const first=queue();expect(queue().id).toBe(first.id);
  const context=appendClaimContext(db,{claimId:claim.id,actorId:1,expectedVersionId:null,normalizedWording:'Qualified',observedAt:null,entities:[],timeframe:'Unknown',location:'Unknown',reason:'Fixture'});
  expect(()=>queue()).toThrow(/changed/);
  expect(queue({contextVersionId:context.id}).id).not.toBe(first.id);
});
test('expired leases are reclaimed and stale workers cannot finish',()=>{
  queue();const first=claimNextJob(db,{now:0,leaseMs:100});
  expect(claimNextJob(db,{now:50,leaseMs:100})).toBeNull();
  const second=claimNextJob(db,{now:100,leaseMs:100});
  expect(second.lease_token).not.toBe(first.lease_token);
  expect(finishClaimJob(db,first,{now:101})).toBe(false);
  expect(finishClaimJob(db,second,{now:101})).toBe(true);
});
test('source restriction blocks queued work before leasing',()=>{
  const job=queue();
  grantFixtureOwner();
  setSourceAccess(db,{sourceId:document.source_id,actorId:1,policy:'restricted',reason:'Fixture',expectedEventId:null});
  expect(claimNextJob(db,{now:0})).toBeNull();
  expect(db.prepare('SELECT state FROM claim_jobs WHERE id=?').get(job.id).state).toBe('blocked');
});
test('source restricted during a lease cannot complete successfully',()=>{
  queue();const job=claimNextJob(db,{now:0});
  grantFixtureOwner();
  setSourceAccess(db,{sourceId:document.source_id,actorId:1,policy:'restricted',reason:'New restriction',expectedEventId:null});
  expect(finishClaimJob(db,job,{now:1})).toBe(false);
  expect(db.prepare('SELECT state,last_error FROM claim_jobs').get()).toEqual({state:'blocked',last_error:'source_restricted'});
});
test('retry waits are honored and exhausted jobs cannot be reclaimed',()=>{
  queue({maxAttempts:2});
  const first=claimNextJob(db,{now:0});
  expect(finishClaimJob(db,first,{now:1,error:'provider_error',retryAt:100})).toBe(true);
  expect(claimNextJob(db,{now:99})).toBeNull();
  const second=claimNextJob(db,{now:100});
  expect(finishClaimJob(db,second,{now:101,error:'provider_error',retryAt:200})).toBe(true);
  expect(claimNextJob(db,{now:200})).toBeNull();
  expect(db.prepare('SELECT state FROM claim_jobs').get().state).toBe('exhausted');
});

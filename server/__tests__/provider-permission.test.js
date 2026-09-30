const {openStore,migrate}=require('../storage');
const {createTopic,addClaim,importDocument,addPassage}=require('../research');
const {enqueueClaimJob}=require('../claim-jobs');
const {getProviderPermission,setProviderPermission}=require('../provider-permission');
const {setSourceAccess}=require('../source-provenance');
const {setPublicationOwner}=require('../publication/owner-authority');
let db,job,sourceId;
beforeEach(()=>{
  db=openStore(':memory:');migrate(db);db.exec("INSERT INTO users(id,username,password) VALUES(1,'fixture','')");
  const topic=createTopic(db,'fixture','Fixture');
  const claim=addClaim(db,{topicId:topic.id,wording:'Fixture',attribution:'Fixture',originUrl:'https://example.com'});
  const document=importDocument(db,{topicId:topic.id,source:'Fixture',url:'https://example.com',title:'Fixture',content:'Fixture text',kind:'report',originChain:'fixture',extractionMethod:'fixture'});sourceId=document.source_id;
  const passage=addPassage(db,{documentId:document.id,start:0,end:12,locator:'first'});
  job=enqueueClaimJob(db,{claimId:claim.id,contextVersionId:null,passageId:passage.id,model:'jev-1.13.0',questionVersion:'passage-v1',policyVersion:'passage-shadow-v1'});
});
afterEach(()=>db.close());
function change(extra={}) {
  const current=getProviderPermission(db,job.id);
  return {jobId:job.id,actorId:1,allowed:true,reason:'Fixture approval',expectedEventId:current.eventId,expectedInputHash:current.inputHash,...extra};
}
test('default deny, explicit exact-input approval and audited revocation',()=>{
  expect(getProviderPermission(db,job.id).allowed).toBe(false);
  const approved=setProviderPermission(db,change());
  expect(approved).toMatchObject({allowed:true,provider:'typesafe'});
  expect(setProviderPermission(db,change({allowed:false,reason:'Revoke'})).allowed).toBe(false);
  expect(db.prepare('SELECT COUNT(*) n FROM provider_permission_events').get().n).toBe(2);
  expect(()=>db.exec('DELETE FROM provider_permission_events')).toThrow(/immutable/);
});
test('stale approval/hash and unknown actors cannot authorize transmission',()=>{
  expect(()=>setProviderPermission(db,change({expectedInputHash:'0'.repeat(64)}))).toThrow(/changed/);
  expect(()=>setProviderPermission(db,change({actorId:999}))).toThrow();
  const stale=change();setProviderPermission(db,stale);
  expect(()=>setProviderPermission(db,stale)).toThrow(/changed/);
});
test('source restrictions override prior approval and prevent reapproval',()=>{
  setProviderPermission(db,change());
  db.exec("INSERT INTO user_roles(user_id,role) VALUES(1,'editor'); INSERT INTO google_identities(subject,user_id) VALUES('fixture-permission-owner',1)");
  setPublicationOwner(db,{subject:'fixture-permission-owner',allowed:true,reason:'Fixture owner grant',operator:'test',expectedEventId:null,requestKey:'fixture-000000000'});
  setSourceAccess(db,{sourceId,actorId:1,policy:'restricted',reason:'Fixture',expectedEventId:null});
  expect(getProviderPermission(db,job.id)).toMatchObject({allowed:false,reason:'source_restricted'});
  expect(()=>setProviderPermission(db,change())).toThrow(/unavailable/);
  expect(setProviderPermission(db,change({allowed:false})).allowed).toBe(false);
});

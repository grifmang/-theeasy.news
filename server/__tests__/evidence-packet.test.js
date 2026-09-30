const {openStore,migrate}=require('../storage');
const {createTopic,addClaim,importDocument,addPassage}=require('../research');
const {recordHumanAssessment}=require('../human-assessments');
const {appendClaimContext}=require('../claim-context');
const {setSourceAccess}=require('../source-provenance');
const {setPublicationOwner}=require('../publication/owner-authority');
const {buildEvidencePacket}=require('../evidence/packet');
let db,topic,claim;
beforeEach(()=>{
  db=openStore(':memory:');migrate(db);db.exec("INSERT INTO users(id,username,password) VALUES(1,'reviewer','')");
  topic=createTopic(db,'fixture','Fixture');claim=addClaim(db,{topicId:topic.id,wording:'Fixture assertion',attribution:'Fixture',originUrl:'https://example.com'});
});
afterEach(()=>db.close());
function evidence(content,relation,chain='same-chain') {
  const document=importDocument(db,{topicId:topic.id,source:'Fixture',url:'https://example.com',title:'Fixture',content,kind:'report',originChain:chain,extractionMethod:'fixture'});
  const passage=addPassage(db,{documentId:document.id,start:0,end:content.length,locator:'paragraph 1'});
  const assessment=recordHumanAssessment(db,{claimId:claim.id,actorId:1,expectedVersionId:null,passageId:passage.id,relevance:'direct',relation,evidenceType:'testimony',rationale:'Fixture assessment'});
  return {document,passage,assessment};
}
test('packet preserves conflicting evidence and groups copied source chains without implying independence',()=>{
  const support=evidence('Fixture affirmative statement','supports');
  const denial=evidence('Fixture denial','contradicts');
  const packet=buildEvidencePacket(db,claim.id);
  expect(packet.passages.map(p=>p.id)).toEqual([support.passage.id,denial.passage.id]);
  expect(packet.counterevidence).toEqual([denial.passage.id]);
  expect(packet.sources).toEqual([{originChain:'same-chain',documentIds:[support.document.id,denial.document.id]}]);
  expect(packet.claim.status).toBe('unreviewed');
  expect(packet.coverage.complete).toBe(false);
  expect(buildEvidencePacket(db,claim.id).version).toBe(packet.version);
});
test('restrictions omit evidence text and change packet identity',()=>{
  const item=evidence('Restricted fixture text','contradicts');
  const before=buildEvidencePacket(db,claim.id);
  db.exec("INSERT INTO user_roles(user_id,role) VALUES(1,'editor'); INSERT INTO google_identities(subject,user_id) VALUES('fixture-packet-owner',1)");
  setPublicationOwner(db,{subject:'fixture-packet-owner',allowed:true,reason:'Fixture owner grant',operator:'test',expectedEventId:null,requestKey:'fixture-packet-owner-001'});
  setSourceAccess(db,{sourceId:item.document.source_id,actorId:1,policy:'restricted',reason:'Fixture restriction',expectedEventId:null});
  const after=buildEvidencePacket(db,claim.id);
  expect(after.passages).toEqual([]);
  expect(after.coverage.gaps).toContain('restricted_evidence');
  expect(JSON.stringify(after)).not.toContain('Restricted fixture text');
  expect(after.version).not.toBe(before.version);
});
test('changed claim context excludes stale assessments and reports the gap',()=>{
  evidence('Fixture text','supports');
  appendClaimContext(db,{claimId:claim.id,actorId:1,expectedVersionId:null,normalizedWording:'Qualified assertion',observedAt:null,entities:[],timeframe:'Unknown',location:'Unknown',reason:'Qualification'});
  const packet=buildEvidencePacket(db,claim.id);
  expect(packet.passages).toEqual([]);
  expect(packet.coverage.gaps).toContain('stale_assessments');
  expect(packet.claim.wording).toBe('Fixture assertion');
  expect(packet.context.normalizedWording).toBe('Qualified assertion');
});
test('latest judgment per reviewer supersedes their earlier judgment without deleting history',()=>{
  const item=evidence('Fixture text','supports');
  recordHumanAssessment(db,{claimId:claim.id,actorId:1,expectedVersionId:null,passageId:item.passage.id,relevance:'direct',relation:'insufficient',evidenceType:'uncertain',rationale:'Corrected review'});
  const packet=buildEvidencePacket(db,claim.id);
  expect(packet.passages[0].assessments.map(a=>a.relation)).toEqual(['insufficient']);
  expect(db.prepare('SELECT COUNT(*) n FROM research_assessments').get().n).toBe(2);
});

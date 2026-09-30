const http=require('http');
jest.mock('../evidence/html-runtime',()=>({loadHtmlRuntime:jest.fn()}));
jest.mock('../evidence/extract-html',()=>({extractHtml:jest.fn()}));
const fs=require('fs'),os=require('os'),path=require('path');
const {createLocalArchive}=require('../evidence/archive');
const {createTopic,importDocument,addClaim,addPassage}=require('../research');
const {openStore,migrate}=require('../storage');
const {migrateLegacy}=require('../legacy-schema');
const {createApp}=require('../app');
const {createSession}=require('../auth');
const {runNextClaimJob}=require('../claim-worker');
const {claimNextJob}=require('../claim-jobs');
const {csrfToken}=require('../session-transport');
const {createSourceRegistry}=require('../discovery/registry');
const {createBudgetGuard}=require('../models/budget-guard');
const sourceRegistry=createSourceRegistry([{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/plain'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
let db,server,token,directory;
beforeEach(async()=>{
  db=openStore(':memory:');migrate(db);migrateLegacy(db);
  db.exec("INSERT INTO users(id,username,password) VALUES(1,'editor',''); INSERT INTO user_roles VALUES(1,'editor')");
  token=createSession(db,1).token;
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-editor-'));
  server=createApp({db,config:{mode:'test'},services:{archive:createLocalArchive(directory),sourceRegistry}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
});
afterEach(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(directory,{recursive:true,force:true});});
function request(path,body,credential=token,csrf=true) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method:body===undefined?'GET':'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json',...(credential?{Cookie:`easy_news_session=${credential}`,...(csrf?{'X-CSRF-Token':csrfToken(credential)}:{})}:{})}},res=>{
      let data='';res.on('data',c=>data+=c);res.on('end',()=>{let parsed;try{parsed=JSON.parse(data);}catch{parsed=null;}resolve({status:res.statusCode,body:parsed,raw:data,headers:res.headers});});
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
async function storedHtmlJob() {
  const registry=createSourceRegistry([{id:'html',hosts:['records.example.org'],mimeTypes:['text/html'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
  const topic=createTopic(db,'html','HTML');
  const {enqueueFetchJob,claimFetchJob}=require('../discovery/fetch-jobs');
  const job=enqueueFetchJob(db,{topicId:topic.id,actorId:1,sourceId:'html',url:'https://records.example.org/html',registry});
  const leased=claimFetchJob(db,{registry,now:1000});
  const receipt=await require('../discovery/fetch-receipt').storeFetchReceipt(db,leased,{
    bytes:Buffer.from('<!doctype html><p>Fixture</p>'),mime:'text/html',status:200,
    finalUrl:'https://records.example.org/html',redirects:[],headers:{}
  },{registry,archive:createLocalArchive(directory),clock:()=>1001});
  return {job,receipt};
}
async function withHtmlService(htmlExtraction) {
  await new Promise(r=>server.close(r));
  server=createApp({db,config:{mode:'test'},services:{archive:createLocalArchive(directory),sourceRegistry,htmlExtraction}}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
}
test('HTML extraction stays unavailable when the runtime service is disabled',async()=>{
  const {job}=await storedHtmlJob();
  expect((await request(`/api/v1/editor/fetch-jobs/${job.id}/extract`,{})).status).toBe(503);
  expect((await request(`/api/v1/editor/fetch-jobs/${job.id}`)).body.extractionAvailable).toBe(false);
});
test('HTML endpoint uses session actor and stored receipt, never request runtime options',async()=>{
  const {job,receipt}=await storedHtmlJob();let received;
  await withHtmlService({extract:async input=>{received=input;return {id:123};}});
  const route=`/api/v1/editor/fetch-jobs/${job.id}/extract`;
  expect((await request(route,{},null)).status).toBe(401);
  expect((await request(route,{},token,false)).status).toBe(403);
  expect((await request(route,{actorId:999,receiptId:999,bundleDirectory:'/attacker'})).body).toEqual({id:123});
  expect(received).toEqual({receiptId:receipt.id,actorId:1});
  expect((await request(`/api/v1/editor/fetch-jobs/${job.id}`)).body.extractionAvailable).toBe(true);
});
test('busy and stopped HTML services return bounded retry responses',async()=>{
  const {job}=await storedHtmlJob();let code='html_busy';
  await withHtmlService({extract:async()=>{throw Object.assign(new Error('internal path must not leak'),{code});}});
  const route=`/api/v1/editor/fetch-jobs/${job.id}/extract`;
  const busy=await request(route,{});expect(busy.status).toBe(429);expect(busy.headers['retry-after']).toBe('1');
  expect(busy.raw).not.toContain('internal path');
  code='html_stopped';expect((await request(route,{})).status).toBe(503);
});
test('HTML HTTP intake persists an unreviewed manifest through the real extraction service',async()=>{
  const {job,receipt}=await storedHtmlJob();
  require('../evidence/html-runtime').loadHtmlRuntime.mockResolvedValue({bundleDirectory:'/fixture',manifestSha256:'a'.repeat(64),scratchParent:'/fixture-scratch'});
  require('../evidence/extract-html').extractHtml.mockResolvedValue({text:'Fixture',extractorVersion:'parse5-8.0.1-text-v1',
    spans:[{start:0,end:7,sourceStart:18,sourceEnd:25}],pages:[],quality:{requiresReview:true,parseErrors:0,warnings:['not_rendered']}});
  const service=await require('../evidence/html-service').createHtmlExtractionService({db,archive:createLocalArchive(directory),runtime:{}});
  try {
    await withHtmlService(service);
    const response=await request(`/api/v1/editor/fetch-jobs/${job.id}/extract`,{});
    expect(response.status).toBe(201);
    const detail=await request(`/api/v1/editor/documents/${response.body.id}`);
    expect(detail.body.source.evidence).toBe('Fixture');
    expect(detail.body.extractions).toHaveLength(1);
    expect(detail.body.extractions[0]).toMatchObject({receipt_id:receipt.id,original_sha256:receipt.sha256,review:{status:'unreviewed'}});
    expect(db.prepare('SELECT COUNT(*) n FROM extraction_review_events').get().n).toBe(0);
  } finally {await service.stop();}
});
test('disconnect aborts an active HTML extraction request',async()=>{
  const {job}=await storedHtmlJob();let started,aborted,timer,client;
  const began=new Promise(resolve=>{started=resolve;}),cancelled=new Promise(resolve=>{aborted=resolve;});
  await withHtmlService({extract:async(input,{signal})=>new Promise(resolve=>{
    signal.addEventListener('abort',()=>{aborted();resolve({id:1});},{once:true});started();
  })});
  const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Disconnect did not cancel parsing')),1500);});
  try {
    client=http.request({hostname:'127.0.0.1',port:server.address().port,path:`/api/v1/editor/fetch-jobs/${job.id}/extract`,method:'POST',
      headers:{Origin:'http://localhost:3000','Content-Type':'application/json',Cookie:`easy_news_session=${token}`,'X-CSRF-Token':csrfToken(token)}});
    client.on('error',()=>{});client.end('{}');
    await Promise.race([began,deadline]);client.destroy();await Promise.race([cancelled,deadline]);
  } finally {clearTimeout(timer);client?.destroy();}
});
test('editor can enqueue approved URL without supplying policy or worker ownership',async()=>{
  const topic=createTopic(db,'fetch','Fetch');
  const route=`/api/v1/editor/topics/${topic.id}/fetch-jobs`;
  const created=await request(route,{sourceId:'fixture',url:'https://records.example.org/a',actorId:999,lease_token:'fake'});
  expect(created.status).toBe(201);expect(created.body).toMatchObject({state:'queued',topic_id:topic.id});
  expect(db.prepare('SELECT actor_id FROM fetch_jobs').get().actor_id).toBe(1);
  const leased=require('../discovery/fetch-jobs').claimFetchJob(db,{registry:sourceRegistry,now:1000});
  const listed=await request(route);
  expect(listed.body.items).toHaveLength(1);
  expect(JSON.stringify(listed.body)).not.toContain(leased.lease_token);
  expect(listed.body.items[0]).not.toHaveProperty('policy_json');
  expect(listed.body.items[0]).not.toHaveProperty('continuation_json');
});
test('fetch admission rejects anonymous, reader and off-policy submissions',async()=>{
  const topic=createTopic(db,'fetch','Fetch');
  const route=`/api/v1/editor/topics/${topic.id}/fetch-jobs`,body={sourceId:'fixture',url:'https://records.example.org/a'};
  expect((await request(route,body,null)).status).toBe(401);
  expect((await request(route,body,token,false)).status).toBe(403);
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request(route,body)).status).toBe(403);
  expect((await request(route)).status).toBe(403);
  db.exec("UPDATE user_roles SET role='editor'");
  expect((await request(route,{...body,url:'https://127.0.0.1/'})).status).toBe(400);
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_jobs').get().n).toBe(0);
});
test('editor fetch-to-extract flow exposes provenance and preserved text',async()=>{
  const topic=createTopic(db,'intake','Intake');
  const queued=await request(`/api/v1/editor/topics/${topic.id}/fetch-jobs`,{sourceId:'fixture',url:'https://records.example.org/a'});
  const jobId=queued.body.id,route=`/api/v1/editor/fetch-jobs/${jobId}`;
  expect((await request(`${route}/extract`,{})).status).toBe(409);
  const {Readable}=require('stream');
  await require('../discovery/fetch-worker').runNextFetch({db,registry:sourceRegistry,archive:createLocalArchive(directory),clock:()=>1000,
    resolver:async()=>[{address:'8.8.8.8',family:4}],request:async()=>Object.assign(Readable.from([Buffer.from('HTTP source evidence')]),{statusCode:200,headers:{'content-type':'text/plain'}})});
  const detail=await request(route);
  expect(detail.status).toBe(200);expect(detail.body.receipt).toMatchObject({mime:'text/plain',retention:'private'});
  expect(detail.body.job).not.toHaveProperty('lease_token');
  expect((await request(`${route}/extract`,{},token,false)).status).toBe(403);
  const extracted=await request(`${route}/extract`,{actorId:999});
  expect(extracted.status).toBe(201);
  const document=await request(`/api/v1/editor/documents/${extracted.body.id}`);
  expect(document.body.source.evidence).toBe('HTTP source evidence');
  expect(document.body.extractions).toHaveLength(1);
  const manifest=document.body.extractions[0];
  expect(manifest.review).toEqual({status:'unreviewed',eventId:null});
  const claim=addClaim(db,{topicId:topic.id,wording:'Synthetic claim',attribution:'Fixture',originUrl:'https://records.example.org/a'});
  const passage=addPassage(db,{documentId:extracted.body.id,start:0,end:4,locator:'Opening'});
  await request(`/api/v1/editor/claims/${claim.id}/assessments`,{passageId:passage.id,expectedVersionId:null,
    relevance:'direct',relation:'contradicts',evidenceType:'other',rationale:'Synthetic counterevidence'});
  const packetRoute=`/api/v1/editor/claims/${claim.id}/evidence-packet`;
  const unreviewedPacket=await request(packetRoute);
  expect(unreviewedPacket.body.coverage.gaps).toContain('extraction_quality_unreviewed');
  const extractionRoute=`/api/v1/editor/extractions/${manifest.id}`;
  const manifestDetail=await request(extractionRoute);
  expect(manifestDetail.body.manifest.offsetUnit).toBe('utf16');
  const original=await request(`${extractionRoute}/original`);
  expect(original.status).toBe(200);expect(original.raw).toBe('HTTP source evidence');
  expect(original.headers['content-type']).toMatch(/^application\/octet-stream/);
  expect(original.headers['content-disposition']).toMatch(/^attachment;/);
  expect(original.headers['cache-control']).toContain('no-store');
  expect((await request(`${extractionRoute}/original`,undefined,null)).status).toBe(401);
  const review={expectedManifestSha256:manifest.manifest_sha256,expectedEventId:null,
    decision:'accepted',originalCompared:true,reason:'Compared preserved original and extracted text.',actorId:999};
  expect((await request(`${extractionRoute}/reviews`,review,token,false)).status).toBe(403);
  expect((await request(`${extractionRoute}/reviews`,{...review,originalCompared:false})).status).toBe(400);
  expect((await request(`${extractionRoute}/reviews`,{...review,expectedManifestSha256:'0'.repeat(64)})).status).toBe(409);
  const reviewed=await request(`${extractionRoute}/reviews`,review);
  expect(reviewed.status).toBe(201);expect(reviewed.body.actor_id).toBe(1);
  expect((await request(`${extractionRoute}/reviews`,review)).status).toBe(409);
  expect((await request(extractionRoute)).body.review).toEqual({status:'accepted',eventId:reviewed.body.id});
  const acceptedPacket=await request(packetRoute);
  expect(acceptedPacket.body.passages[0].extractionQuality.status).toBe('accepted');
  expect(acceptedPacket.body.version).not.toBe(unreviewedPacket.body.version);
  const rejected=await request(`${extractionRoute}/reviews`,{...review,expectedEventId:reviewed.body.id,
    decision:'rejected',reason:'Later comparison identified missing context.'});
  expect(rejected.status).toBe(201);
  expect((await request(extractionRoute)).body.review.status).toBe('rejected');
  const rejectedPacket=await request(packetRoute);
  expect(rejectedPacket.body.coverage.gaps).toContain('extraction_quality_rejected');
  expect(rejectedPacket.body.counterevidence).toEqual([passage.id]);
  expect(rejectedPacket.body.version).not.toBe(acceptedPacket.body.version);
  expect(()=>db.prepare('DELETE FROM extraction_review_events').run()).toThrow();
  expect(()=>db.prepare("UPDATE extraction_review_events SET decision='accepted'").run()).toThrow();
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request(`${extractionRoute}/original`)).status).toBe(403);
  expect((await request(extractionRoute)).status).toBe(403);
  expect((await request(`${extractionRoute}/reviews`,review)).status).toBe(403);
  expect((await request(route)).status).toBe(403);
  expect((await request(`${route}/extract`,{})).status).toBe(403);
});

test('authenticated text intake accepts the full document limit without widening other routes',async()=>{
  const topic=createTopic(db,'large','Large document fixture');
  const text='x'.repeat(999999)+'\n';
  const result=await request('/api/v1/editor/documents/text',{topicId:topic.id,source:'Fixture',
    url:'https://example.org/large',title:'Large',text,kind:'report',originChain:'large',retrievedAt:'2020-01-01T00:00:00.000Z'});
  expect(result.status).toBe(201);
  const saved=await request(`/api/v1/editor/documents/${result.body.document.id}`);
  expect(saved.body.source.evidence).toBe(text);
  const oversizedOther=await request('/api/v1/editor/topics',{slug:'other',title:'x'.repeat(120000)});
  expect(oversizedOther.status).toBe(413);
  expect(oversizedOther.body).toEqual({error:'Request body too large'});
});

test('large text intake checks identity before parsing and rejects oversized bodies as JSON',async()=>{
  expect((await request('/api/v1/editor/documents/text',{text:'x'.repeat(120000)},null)).status).toBe(401);
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request('/api/v1/editor/documents/text',{text:'x'.repeat(120000)})).status).toBe(403);
  db.exec("UPDATE user_roles SET role='editor'");
  const result=await request('/api/v1/editor/documents/text',{text:'x'.repeat(8*1024*1024)});
  expect(result.status).toBe(413);
  expect(result.body).toEqual({error:'Request body too large'});
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(0);
});

test('preparing an existing leased job never exposes its worker ownership token',async()=>{
  const topic=createTopic(db,'lease-test','Lease fixture');
  const claim=addClaim(db,{topicId:topic.id,wording:'Synthetic assertion',attribution:'Fixture',originUrl:'https://example.org/claim'});
  const document=importDocument(db,{topicId:topic.id,source:'Fixture',url:'https://example.org/doc',title:'Fixture',
    content:'Synthetic evidence',kind:'report',originChain:'fixture',extractionMethod:'manual',publishedAt:null});
  const passage=addPassage(db,{documentId:document.id,start:0,end:9,locator:'Paragraph 1'});
  const endpoint=`/api/v1/editor/claims/${claim.id}/jobs`;
  const body={passageId:passage.id,contextVersionId:null};
  const first=await request(endpoint,body);
  const leased=claimNextJob(db,{now:1000});
  expect(leased.lease_token).toEqual(expect.any(String));
  const repeated=await request(endpoint,body);
  expect(repeated.body).toMatchObject({id:first.body.id,state:'leased'});
  expect(repeated.body).not.toHaveProperty('lease_token');
  expect(first.body).not.toHaveProperty('lease_token');
  expect(db.prepare('SELECT lease_token FROM claim_jobs WHERE id=?').get(first.body.id).lease_token).toBe(leased.lease_token);
});
test('editor creates claim and review records authenticated actor, not supplied actor',async()=>{
  const topic=await request('/api/v1/editor/topics',{slug:'fixture',title:'Fixture'});
  expect(topic.status).toBe(201);
  const claim=await request('/api/v1/editor/claims',{topicId:topic.body.id,original:'Fixture assertion',attribution:'Fixture',
    originUrl:'https://example.com',qualifiers:{normalizedWording:'Fixture assertion',observedAt:null,
      entities:[],timeframe:'Unknown',location:'Unknown',reason:'Initial proposal'}});
  expect(claim.status).toBe(201);
  const review=await request(`/api/v1/editor/claims/${claim.body.claim.id}/events`,{type:'reviewed',reason:'Checked fixture',
    expectedEventId:claim.body.state.eventId,actorId:999});
  expect(review.status).toBe(201);
  expect(review.body.actor_id).toBe(1);
  const current=await request(`/api/v1/editor/claims/${claim.body.claim.id}`);
  expect(current.body.state.status).toBe('reviewed');
  expect((await request(`/api/v1/editor/claims/${claim.body.claim.id}/events`,{type:'unreviewed',reason:'Stale',expectedEventId:null})).status).toBe(409);
});
test('anonymous and reader identities cannot access research',async()=>{
  expect((await request('/api/v1/editor/topics',undefined,null)).status).toBe(401);
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request('/api/v1/editor/topics')).status).toBe(403);
});
test('invalid identifiers and malformed bodies produce controlled client errors',async()=>{
  expect((await request('/api/v1/editor/topics',{slug:123,title:'Bad'})).status).toBe(400);
  expect((await request('/api/v1/editor/claims/not-an-id')).status).toBe(400);
  expect((await request('/api/v1/editor/claims/999')).status).toBe(404);
});

test('editor imports original text and reads preserved evidence without trusting client extraction',async()=>{
  const topic=await request('/api/v1/editor/topics',{slug:'intake',title:'Intake'});
  const imported=await request('/api/v1/editor/documents/text',{topicId:topic.body.id,source:'Fixture',url:'https://example.com/doc',title:'Document',text:'Preserved testimony',kind:'report',originChain:'fixture',retrievedAt:'2020-01-01T00:00:00.000Z',extractionMethod:'forged',content:'forged'});
  expect(imported.status).toBe(201);
  const read=await request(`/api/v1/editor/documents/${imported.body.document.id}`);
  expect(read.status).toBe(200);
  expect(read.body.source.evidence).toBe('Preserved testimony');
  expect(read.body.document.extraction_method).toBe('utf8-v1');
  expect(read.body.originals).toHaveLength(1);
  expect(read.body.retrievals).toHaveLength(1);
  expect(fs.readFileSync(path.join(directory,read.body.originals[0].key),'utf8')).toBe('Preserved testimony');
});

test('document intake rejects readers and invalid text without storing originals',async()=>{
  expect((await request('/api/v1/editor/documents/text',{text:123})).status).toBe(400);
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request('/api/v1/editor/documents/text',{text:'unauthorized'})).status).toBe(403);
  expect(fs.readdirSync(directory)).toEqual([]);
  expect((await request('/api/v1/editor/documents/1')).status).toBe(403);
});

function passageDocument() {
  const topic=createTopic(db,'passages','Passages');
  return importDocument(db,{topicId:topic.id,source:'Fixture',url:'https://example.com',title:'Testimony',content:'First sentence. Second sentence.',kind:'transcript',originChain:'fixture',extractionMethod:'fixture'});
}
test('editor search returns stored passages and denies reader access',async()=>{
  const document=passageDocument();
  const passage=addPassage(db,{documentId:document.id,start:0,end:15,locator:'first'});
  const endpoint='/api/v1/editor/topics/1/search?q=sentence';
  const result=await request(endpoint);
  expect(result.status).toBe(200);
  expect(result.body.items.map(row=>row.id)).toEqual([passage.id]);
  expect((await request('/api/v1/editor/topics/1/search?q=sentence&limit=999')).status).toBe(400);
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request(endpoint)).status).toBe(403);
});
test('passage API derives quotations from immutable evidence and lists them',async()=>{
  const document=passageDocument();
  const endpoint=`/api/v1/editor/documents/${document.id}/passages`;
  const result=await request(endpoint,{start:16,end:32,locator:'paragraph 2',quote:'Forged quote'});
  expect(result.status).toBe(201);
  expect(result.body.quote).toBe('Second sentence.');
  expect((await request(endpoint)).body.items).toEqual([result.body]);
  expect((await request(endpoint,{start:16,end:32,locator:'paragraph 2'})).body.id).toBe(result.body.id);
  expect((await request(`${endpoint}?after=${result.body.id}`)).body.items).toEqual([]);
});
test('passage API rejects invalid ranges, missing documents and unauthorized identities',async()=>{
  const document=passageDocument();
  const endpoint=`/api/v1/editor/documents/${document.id}/passages`;
  expect((await request(endpoint,{start:-1,end:999,locator:'bad'})).status).toBe(400);
  expect((await request('/api/v1/editor/documents/999/passages')).status).toBe(404);
  expect((await request(endpoint,undefined,null)).status).toBe(401);
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request(endpoint,{start:0,end:5,locator:'first'})).status).toBe(403);
  expect(db.prepare('SELECT COUNT(*) n FROM research_passages').get().n).toBe(0);
});

test('assessment binds session actor and claim version, exposing historical assessments as stale',async()=>{
  const document=passageDocument();
  const claim=addClaim(db,{topicId:1,wording:'Fixture assertion',attribution:'Fixture',originUrl:'https://example.com'});
  const passage=addPassage(db,{documentId:document.id,start:0,end:15,locator:'first'});
  const endpoint=`/api/v1/editor/claims/${claim.id}/assessments`;
  const body={passageId:passage.id,expectedVersionId:null,relevance:'direct',relation:'contradicts',evidenceType:'testimony',rationale:'Fixture comparison',actorId:999,reviewer:'forged'};
  const assessment=await request(endpoint,body);
  expect(assessment.status).toBe(201);
  expect(assessment.body.actor_id).toBe(1);
  expect(assessment.body.reviewer).toBe('user:1');
  expect((await request(endpoint)).body.items[0]).toMatchObject({stale:false,context_version_id:null,relation:'contradicts'});
  const context=await request(`/api/v1/editor/claims/${claim.id}/context`,{expectedVersionId:null,normalizedWording:'Qualified assertion',observedAt:null,entities:[],timeframe:'Unknown',location:'Unknown',reason:'Qualification'});
  expect(context.status).toBe(201);
  expect((await request(endpoint)).body.items[0].stale).toBe(true);
  expect((await request(endpoint,body)).status).toBe(409);
  expect((await request(endpoint,{...body,expectedVersionId:context.body.id})).status).toBe(201);
  expect(db.prepare('SELECT COUNT(*) n FROM research_assessments').get().n).toBe(2);
  expect(()=>db.exec('DELETE FROM human_assessment_reviews')).toThrow(/immutable/);
});

test('invalid assessments and reader submissions leave no assessment records',async()=>{
  const document=passageDocument();
  const claim=addClaim(db,{topicId:1,wording:'Fixture',attribution:'Fixture',originUrl:'https://example.com'});
  const passage=addPassage(db,{documentId:document.id,start:0,end:5,locator:'first'});
  const endpoint=`/api/v1/editor/claims/${claim.id}/assessments`;
  const body={passageId:passage.id,expectedVersionId:null,relevance:'direct',relation:'proven_true',evidenceType:'finding',rationale:'Invalid verdict'};
  expect((await request(endpoint,body)).status).toBe(400);
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request(endpoint,{...body,relation:'supports'})).status).toBe(403);
  expect(db.prepare('SELECT COUNT(*) n FROM research_assessments').get().n).toBe(0);
});

test('editor can inspect a versioned evidence packet without claiming completeness',async()=>{
  passageDocument();
  const claim=addClaim(db,{topicId:1,wording:'Fixture',attribution:'Fixture',originUrl:'https://example.com'});
  const endpoint=`/api/v1/editor/claims/${claim.id}/evidence-packet`;
  const result=await request(endpoint);
  expect(result.status).toBe(200);
  expect(result.body.version).toMatch(/^[a-f0-9]{64}$/);
  expect(result.body.coverage).toMatchObject({complete:false});
  expect(result.body.coverage.gaps).toContain('no_current_reviewed_evidence');
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request(endpoint)).status).toBe(403);
});

test('editor previews exact evaluation input and grants revocable provider permission as session actor',async()=>{
  const document=passageDocument();
  const claim=addClaim(db,{topicId:1,wording:'Fixture',attribution:'Fixture',originUrl:'https://example.com'});
  const passage=addPassage(db,{documentId:document.id,start:0,end:15,locator:'first'});
  const queued=await request(`/api/v1/editor/claims/${claim.id}/jobs`,{passageId:passage.id,contextVersionId:null});
  expect(queued.status).toBe(201);
  const endpoint=`/api/v1/editor/jobs/${queued.body.id}`;
  const preview=await request(endpoint);
  expect(preview.body.input.passage).toBe('First sentence.');
  expect(preview.body.permission.allowed).toBe(false);
  expect(preview.body.decision).toBeNull();
  const body={allowed:true,reason:'Approve fixture disclosure',expectedEventId:null,expectedInputHash:preview.body.permission.inputHash,actorId:999};
  expect((await request(`${endpoint}/provider-permission`,body)).body.allowed).toBe(true);
  expect(db.prepare('SELECT actor_id FROM provider_permission_events').get().actor_id).toBe(1);
  expect((await request(`${endpoint}/provider-permission`,body)).status).toBe(409);
  const guardPath=path.join(directory,'budget-guard');fs.mkdirSync(guardPath,{mode:0o700});
  await runNextClaimJob({db,guard:createBudgetGuard(guardPath),clock:()=>Date.parse('2026-09-20T00:00:00.000Z'),limits:{dailyMicros:3000,monthlyMicros:3000},client:{evaluate:async input=>({body:{model:input.model,usage:{input_tokens:100,output_tokens:20},answers:Object.fromEntries(Object.entries(input.questions).map(([key,question])=>{
    const options=Object.keys(question.criteria);
    return [key,{type:'choice',choice:options[0],confidence:1,probabilities:Object.fromEntries(options.map((option,index)=>[option,index===0?1:0]))}];
  }))},requestId:'fixture'})}});
  const inspected=await request(endpoint);
  expect(inspected.body.decision.routing).toMatchObject({mode:'shadow',publicationAllowed:false});
  expect(inspected.body.decision.result.answers.relation.choice).toBe('supports');
  expect((await request(`/api/v1/editor/claims/${claim.id}/jobs`)).body.items[0]).toMatchObject({id:queued.body.id,state:'done'});
  expect(inspected.body.job.lease_token).toBeUndefined();
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request(`${endpoint}/provider-permission`,body)).status).toBe(403);
});

test('topic claim and document browsing is scoped and cursor-paginated',async()=>{
  const document=passageDocument();
  const claim=addClaim(db,{topicId:1,wording:'First claim',attribution:'Fixture',originUrl:'https://example.com'});
  const other=createTopic(db,'other','Other');
  addClaim(db,{topicId:other.id,wording:'Other claim',attribution:'Fixture',originUrl:'https://example.com'});
  const claims=await request('/api/v1/editor/topics/1/claims');
  expect(claims.status).toBe(200);
  expect(claims.body.items.map(row=>row.id)).toEqual([claim.id]);
  expect(claims.body.items[0].state.status).toBe('unreviewed');
  expect((await request(`/api/v1/editor/topics/1/claims?after=${claim.id}`)).body.items).toEqual([]);
  const documents=await request('/api/v1/editor/topics/1/documents');
  expect(documents.body.items.map(row=>row.id)).toEqual([document.id]);
  expect(documents.body.items[0]).toMatchObject({title:'Testimony',kind:'transcript'});
  expect(documents.body.items[0].evidence).toBeUndefined();
  expect((await request('/api/v1/editor/topics/999/documents')).status).toBe(404);
});

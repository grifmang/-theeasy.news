const fs=require('fs'),os=require('os'),path=require('path');
const {openStore}=require('../storage');
const {initializeDatabase}=require('../init-db');
const {createTopic}=require('../research');
const {createSourceRegistry}=require('../discovery/registry');
const {createLocalArchive}=require('../evidence/archive');
const {enqueueFetchJob,claimFetchJob}=require('../discovery/fetch-jobs');
const receipts=require('../discovery/fetch-receipt');
const extraction=require('../evidence/extract-fetch');
jest.mock('../evidence/extract-html',()=>({extractHtml:jest.fn()}));
const {extractHtml}=require('../evidence/extract-html');
let db,directory,archive,registry,job;
beforeEach(()=>{
  extractHtml.mockReset();
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-receipt-'));
  initializeDatabase(path.join(directory,'test.db'));db=openStore(path.join(directory,'test.db'));
  fs.mkdirSync(path.join(directory,'originals'));archive=createLocalArchive(path.join(directory,'originals'));
  db.exec("INSERT INTO users(id,username,password) VALUES(1,'editor','disabled'); INSERT INTO user_roles VALUES(1,'editor')");
  const topic=createTopic(db,'fixture','Fixture');
  registry=createSourceRegistry([{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/plain'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
  enqueueFetchJob(db,{topicId:topic.id,actorId:1,sourceId:'fixture',url:'https://records.example.org/a',registry});
  job=claimFetchJob(db,{registry,now:1000});
});

async function htmlReceipt() {
  registry=createSourceRegistry([{id:'html',hosts:['records.example.org'],mimeTypes:['text/html'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
  enqueueFetchJob(db,{topicId:job.topic_id,actorId:1,sourceId:'html',url:'https://records.example.org/html',registry});
  const htmlJob=claimFetchJob(db,{registry,now:1001});
  return receipts.storeFetchReceipt(db,htmlJob,{...result(),bytes:Buffer.from('<!doctype html><p>Fixture</p>'),mime:'text/html',
    finalUrl:'https://records.example.org/html',headers:{'content-type':'text/html'}},{registry,archive,clock:()=>1002});
}
const parsedHtml=()=>({text:'Fixture',extractorVersion:'parse5-8.0.1-text-v1',pages:[],
  spans:[{start:0,end:7,sourceStart:18,sourceEnd:25}],
  quality:{requiresReview:true,parseErrors:0,warnings:['not_rendered']}});

test('HTML intake persists sandbox text and exact source spans without approving evidence',async()=>{
  const receipt=await htmlReceipt();extractHtml.mockResolvedValue(parsedHtml());
  const runtime={bundleDirectory:'/operator/bundle',manifestSha256:'a'.repeat(64),scratchParent:'/operator/scratch'};
  const document=await extraction.extractFetchHtml(db,{receiptId:receipt.id,actorId:1},archive,runtime);
  expect(extractHtml).toHaveBeenCalledWith(Buffer.from('<!doctype html><p>Fixture</p>'),runtime);
  expect(document.extraction_method).toBe('parse5-8.0.1-text-v1');
  const manifest=JSON.parse(db.prepare('SELECT manifest_json FROM extraction_manifests').get().manifest_json);
  expect(manifest).toMatchObject({originalSha256:receipt.sha256,sourceLength:29,textLength:7,
    spans:parsedHtml().spans,quality:parsedHtml().quality});
  expect(db.prepare('SELECT evidence FROM source_items WHERE id=?').get(document.source_id).evidence).toBe('Fixture');
  expect(db.prepare('SELECT COUNT(*) n FROM extraction_review_events').get().n).toBe(0);
  expect(await archive.readOriginal(db.prepare('SELECT * FROM original_objects WHERE sha256=?').get(receipt.sha256))).toEqual(Buffer.from('<!doctype html><p>Fixture</p>'));
  await extraction.extractFetchHtml(db,{receiptId:receipt.id,actorId:1},archive,runtime);
  expect(db.prepare('SELECT COUNT(*) n FROM extraction_manifests').get().n).toBe(1);
});

test.each(['failure','revoked','cancelled'])('HTML %s after parsing leaves no document or manifest',async mode=>{
  const receipt=await htmlReceipt(),controller=new AbortController();
  extractHtml.mockImplementation(async()=>{
    if(mode==='failure') throw new Error('Sandbox unavailable');
    if(mode==='revoked') db.exec('DELETE FROM user_roles');
    if(mode==='cancelled') controller.abort();
    return parsedHtml();
  });
  await expect(extraction.extractFetchHtml(db,{receiptId:receipt.id,actorId:1},archive,{signal:controller.signal})).rejects.toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM extraction_manifests').get().n).toBe(0);
});

test('HTML intake rejects substituted bytes before invoking the sandbox',async()=>{
  const receipt=await htmlReceipt();
  await expect(extraction.extractFetchHtml(db,{receiptId:receipt.id,actorId:1},{readOriginal:async()=>Buffer.from('substituted')})).rejects.toThrow(/integrity/);
  expect(extractHtml).not.toHaveBeenCalled();
});
test('HTML intake without a configured real sandbox fails closed',async()=>{
  const receipt=await htmlReceipt();
  extractHtml.mockImplementation(jest.requireActual('../evidence/extract-html').extractHtml);
  await expect(extraction.extractFetchHtml(db,{receiptId:receipt.id,actorId:1},archive)).rejects.toThrow(/sandbox/);
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(0);
});

test('changed HTML output for the same extractor version rolls back the new snapshot',async()=>{
  const receipt=await htmlReceipt();extractHtml.mockResolvedValue(parsedHtml());
  await extraction.extractFetchHtml(db,{receiptId:receipt.id,actorId:1},archive);
  extractHtml.mockResolvedValue({...parsedHtml(),text:'Changed'});
  await expect(extraction.extractFetchHtml(db,{receiptId:receipt.id,actorId:1},archive)).rejects.toThrow(/differs/);
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(1);
  expect(db.prepare('SELECT COUNT(*) n FROM source_items').get().n).toBe(1);
  expect(db.prepare('SELECT COUNT(*) n FROM extraction_manifests').get().n).toBe(1);
});

test('HTML entry point does not reinterpret a plain-text receipt',async()=>{
  const receipt=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  await expect(extraction.extractFetchHtml(db,{receiptId:receipt.id,actorId:1},archive)).rejects.toThrow(/Stored HTML/);
  expect(extractHtml).not.toHaveBeenCalled();
});
afterEach(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
const result=()=>({bytes:Buffer.from('Original evidence'),mime:'text/plain',status:200,finalUrl:'https://records.example.org/a',redirects:[],headers:{'content-type':'text/plain'}});
async function archiveJob(timestamp='20190101000000') {
  registry=createSourceRegistry([{id:'wayback',hosts:['web.archive.org','records.example.org'],mimeTypes:['text/plain'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
  const url=`https://web.archive.org/web/${timestamp}/https://records.example.org/a`;
  enqueueFetchJob(db,{topicId:job.topic_id,actorId:1,sourceId:'wayback',url,registry});
  const now=Date.UTC(2026,8,22),leased=claimFetchJob(db,{registry,now});
  return {leased,now,url};
}
test('original and two Wayback captures share one source chain and retain separate capture provenance',async()=>{
  const original=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  const documents=[await extraction.extractFetchText(db,{receiptId:original.id,actorId:1},archive)];
  for(const [timestamp,date] of [['20190101000000','Tue, 01 Jan 2019 00:00:00 GMT'],['20200101000000','Wed, 01 Jan 2020 00:00:00 GMT']]) {
    const {leased,now,url}=await archiveJob(timestamp);
    const receipt=await receipts.storeFetchReceipt(db,leased,{...result(),finalUrl:url,headers:{'memento-datetime':date}},{registry,archive,clock:()=>now+1});
    documents.push(await extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},archive));
    const manifest=JSON.parse(db.prepare('SELECT manifest_json FROM extraction_manifests WHERE receipt_id=?').get(receipt.id).manifest_json);
    expect(manifest.archive).toMatchObject({provider:'wayback',originalUrl:'https://records.example.org/a',archiveUrl:url,
      capturedAt:timestamp.startsWith('2019')?'2019-01-01T00:00:00.000Z':'2020-01-01T00:00:00.000Z',requiresReview:true});
  }
  expect(new Set(documents.map(d=>d.origin_chain)).size).toBe(1);
  expect(db.prepare("SELECT COUNT(*) n FROM source_retrievals WHERE method='wayback'").get().n).toBe(2);
});
test.each(['missing_date','wrong_date','different_capture','live_fallback'])('Wayback %s is rejected before archival storage',async mode=>{
  await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  const {leased,now,url}=await archiveJob();
  const fetched={...result(),finalUrl:url,headers:{'memento-datetime':'Tue, 01 Jan 2019 00:00:00 GMT'}};
  if(mode==='missing_date') fetched.headers={};
  if(mode==='wrong_date') fetched.headers['memento-datetime']='Wed, 01 Jan 2020 00:00:00 GMT';
  if(mode==='different_capture') {fetched.finalUrl=url.replace('20190101000000','20200101000000');fetched.redirects=[{url,status:302}];}
  if(mode==='live_fallback') {fetched.finalUrl='https://records.example.org/a';fetched.redirects=[{url,status:302}];}
  await expect(receipts.storeFetchReceipt(db,leased,fetched,{registry,archive,clock:()=>now+1})).rejects.toThrow(/Archive/);
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_receipts').get().n).toBe(1);
});
test('receipt stores verified private bytes without claiming extraction',async()=>{
  const receipt=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.retrieved_at).toBe('1970-01-01T00:00:01.001Z');
  expect(await archive.readOriginal(db.prepare('SELECT * FROM original_objects').get())).toEqual(Buffer.from('Original evidence'));
  expect(db.prepare('SELECT state,original_sha256 FROM fetch_jobs').get()).toEqual({state:'fetched',original_sha256:receipt.sha256});
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(0);
});
test('expired worker stores no original or receipt',async()=>{
  expect(await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>31000})).toBeNull();
  expect(fs.readdirSync(path.join(directory,'originals'))).toEqual([]);
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_receipts').get().n).toBe(0);
});
test('lease expiration during archive prevents database completion',async()=>{
  let now=1001;
  const delayed={archiveOriginal:async input=>{const stored=await archive.archiveOriginal(input);now=31000;return stored;}};
  expect(await receipts.storeFetchReceipt(db,job,result(),{registry,archive:delayed,clock:()=>now})).toBeNull();
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_receipts').get().n).toBe(0);
  expect(db.prepare('SELECT state FROM fetch_jobs').get().state).toBe('leased');
  expect(fs.readdirSync(path.join(directory,'originals'))).toHaveLength(1);
});
test('metadata-only source never archives body',async()=>{
  const topic=createTopic(db,'metadata','Metadata');
  registry=createSourceRegistry([{...registry.resolve('fixture',job.url),retention:'metadata-only'}]);
  enqueueFetchJob(db,{topicId:topic.id,actorId:1,sourceId:'fixture',url:job.url,registry});
  const metadataJob=claimFetchJob(db,{registry,now:1001});
  const receipt=await receipts.storeFetchReceipt(db,metadataJob,result(),{registry,archive,clock:()=>1002});
  expect(receipt.retention).toBe('metadata-only');
  await expect(extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},archive)).rejects.toThrow(/Stored plain text/);
  expect(fs.readdirSync(path.join(directory,'originals'))).toEqual([]);
  expect(db.prepare('SELECT original_sha256 FROM fetch_jobs WHERE id=?').get(metadataJob.id).original_sha256).toBeNull();
});
test('revoking editor during storage prevents receipt commit',async()=>{
  const revoking={archiveOriginal:async input=>{
    const stored=await archive.archiveOriginal(input);db.exec('DELETE FROM user_roles');return stored;
  }};
  expect(await receipts.storeFetchReceipt(db,job,result(),{registry,archive:revoking,clock:()=>1001})).toBeNull();
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_receipts').get().n).toBe(0);
});
test('withdrawn policy rejects completion before writing bytes',async()=>{
  expect(await receipts.storeFetchReceipt(db,job,result(),{registry:createSourceRegistry([]),archive,clock:()=>1001})).toBeNull();
  expect(fs.readdirSync(path.join(directory,'originals'))).toEqual([]);
});
test('receipt omits sensitive response headers and cannot be overwritten',async()=>{
  const fetched=result();fetched.headers={'set-cookie':'private','etag':'safe','last-modified':'bad\r\nheader'};
  const receipt=await receipts.storeFetchReceipt(db,job,fetched,{registry,archive,clock:()=>1001});
  expect(JSON.parse(receipt.headers_json)).toEqual({etag:'safe'});
  expect(()=>db.prepare("UPDATE fetch_receipts SET final_url='changed'").run()).toThrow();
  expect(await receipts.storeFetchReceipt(db,job,fetched,{registry,archive,clock:()=>1002})).toBeNull();
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_receipts').get().n).toBe(1);
});
test('plain text extraction preserves original bytes and HTTP provenance without verdicts',async()=>{
  const receipt=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  const doc=await extraction.extractFetchText?.(db,{receiptId:receipt.id,actorId:1},archive);
  expect(doc).toMatchObject({extraction_method:'http-utf8-v1',kind:'other'});
  expect(db.prepare('SELECT evidence FROM source_items WHERE id=?').get(doc.source_id).evidence).toBe('Original evidence');
  expect(db.prepare('SELECT sha256 FROM document_originals WHERE document_id=?').get(doc.id).sha256).toBe(receipt.sha256);
  expect(db.prepare('SELECT method,retrieved_at FROM source_retrievals').get()).toEqual({method:'http',retrieved_at:'1970-01-01T00:00:01.001Z'});
  expect(db.prepare('SELECT COUNT(*) n FROM research_assessments').get().n).toBe(0);
  const again=await extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},archive);
  expect(again.id).toBe(doc.id);expect(db.prepare('SELECT COUNT(*) n FROM source_retrievals').get().n).toBe(1);
});

test('extraction commits an immutable original-to-text manifest and repeat extraction is idempotent',async()=>{
  const receipt=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  const doc=await extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},archive);
  const stored=db.prepare('SELECT * FROM extraction_manifests').get();
  expect(stored).toMatchObject({document_id:doc.id,receipt_id:receipt.id,original_sha256:receipt.sha256,
    extractor_version:'http-utf8-v1',actor_id:1,requires_review:1});
  const manifest=JSON.parse(stored.manifest_json);
  expect(manifest).toMatchObject({offsetUnit:'utf16',textLength:17,sourceLength:17,pages:[],
    spans:[{start:0,end:17,sourceStart:0,sourceEnd:17}],quality:{requiresReview:true}});
  const hash=require('crypto').createHash('sha256').update('Original evidence').digest('hex');
  expect(stored.text_sha256).toBe(hash);
  expect(()=>db.prepare("UPDATE extraction_manifests SET requires_review=0").run()).toThrow();
  expect(()=>db.prepare('DELETE FROM extraction_manifests').run()).toThrow();
  await extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},archive);
  expect(db.prepare('SELECT COUNT(*) n FROM extraction_manifests').get().n).toBe(1);
});

test('manifest failure rolls back document and retrieval creation',async()=>{
  const receipt=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  db.exec("CREATE TRIGGER reject_manifest BEFORE INSERT ON extraction_manifests BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  // better-sqlite3's native addon can retain an Error constructor from another
  // Jest VM; assert the rejection's code/message rather than instanceof Error.
  await expect(extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},archive)).rejects.toMatchObject({
    code:'SQLITE_CONSTRAINT_TRIGGER',message:'fixture failure'
  });
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM source_retrievals').get().n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_receipts').get().n).toBe(1);
});
test('extraction rejects revoked editor before importing evidence',async()=>{
  const receipt=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  db.exec('DELETE FROM user_roles');
  expect(typeof extraction.extractFetchText).toBe('function');
  await expect(extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},archive)).rejects.toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(0);
});
test('extraction independently rejects substituted archive bytes',async()=>{
  const receipt=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  await expect(extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},{readOriginal:async()=>Buffer.from('Tampered evidence')})).rejects.toThrow(/integrity/);
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(0);
});
test('extraction rechecks editor after asynchronous archive read',async()=>{
  const receipt=await receipts.storeFetchReceipt(db,job,result(),{registry,archive,clock:()=>1001});
  const revoking={readOriginal:async original=>{const bytes=await archive.readOriginal(original);db.exec('DELETE FROM user_roles');return bytes;}};
  await expect(extraction.extractFetchText(db,{receiptId:receipt.id,actorId:1},revoking)).rejects.toThrow(/Editor/);
  expect(db.prepare('SELECT COUNT(*) n FROM research_documents').get().n).toBe(0);
});

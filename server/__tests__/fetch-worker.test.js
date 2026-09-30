const fs=require('fs'),os=require('os'),path=require('path');
const {Readable}=require('stream');
const {initializeDatabase}=require('../init-db');
const {openStore}=require('../storage');
const {createTopic}=require('../research');
const {createSourceRegistry}=require('../discovery/registry');
const {createLocalArchive}=require('../evidence/archive');
const {enqueueFetchJob}=require('../discovery/fetch-jobs');
const worker=require('../discovery/fetch-worker');
let db,directory,options,now;
const response=(statusCode=200,headers={},body='Source document')=>Object.assign(Readable.from([Buffer.from(body)]),{statusCode,headers:{'content-type':'text/plain',...headers}});
beforeEach(()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-fetch-worker-'));
  initializeDatabase(path.join(directory,'test.db'));db=openStore(path.join(directory,'test.db'));
  fs.mkdirSync(path.join(directory,'originals'));
  db.exec("INSERT INTO users(id,username,password) VALUES(1,'editor','disabled'); INSERT INTO user_roles VALUES(1,'editor')");
  const registry=createSourceRegistry([{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/plain'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
  const topic=createTopic(db,'fixture','Fixture');
  enqueueFetchJob(db,{topicId:topic.id,actorId:1,sourceId:'fixture',url:'https://records.example.org/a',registry});
  now=1000;options={db,registry,archive:createLocalArchive(path.join(directory,'originals')),clock:()=>now,
    resolver:async()=>[{address:'8.8.8.8',family:4}],request:async()=>response()};
});
afterEach(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
test('worker fetches and archives one queued job then becomes idle',async()=>{
  expect(await worker.runNextFetch?.(options)).toEqual({status:'fetched',jobId:1});
  expect(await worker.runNextFetch(options)).toEqual({status:'idle'});
  const original=db.prepare('SELECT * FROM original_objects').get();
  expect(await options.archive.readOriginal(original)).toEqual(Buffer.from('Source document'));
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_receipts').get().n).toBe(1);
});
test('worker resumes a rate-paused redirect without refetching origin',async()=>{
  const visited=[];options.request=async({url})=>{visited.push(url);return url.endsWith('/a')?response(302,{location:'/b'}):response();};
  expect(await worker.runNextFetch?.(options)).toEqual({status:'deferred',jobId:1});
  now=11000;
  expect(await worker.runNextFetch(options)).toEqual({status:'fetched',jobId:1});
  expect(visited).toEqual(['https://records.example.org/a','https://records.example.org/b']);
  expect(db.prepare('SELECT failures FROM fetch_jobs').get().failures).toBe(0);
});
test('transport error is sanitized and bounded by retries',async()=>{
  options.request=async()=>{throw new Error('secret transport details');};
  expect(await worker.runNextFetch?.(options)).toEqual({status:'retry_wait',jobId:1});
  expect(db.prepare('SELECT last_error,failures FROM fetch_jobs').get()).toEqual({last_error:'fetch_failed',failures:1});
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_receipts').get().n).toBe(0);
});
test('pre-aborted worker does not claim work',async()=>{
  const controller=new AbortController();controller.abort();
  expect(await worker.runNextFetch?.({...options,signal:controller.signal})).toEqual({status:'stopped'});
  expect(db.prepare('SELECT state FROM fetch_jobs').get().state).toBe('queued');
});
test('repeated transport failures exhaust the job and stop network work',async()=>{
  let requests=0;options.request=async()=>{requests++;throw new Error('failed');};
  expect(await worker.runNextFetch(options)).toEqual({status:'retry_wait',jobId:1});
  now=11000;expect(await worker.runNextFetch(options)).toEqual({status:'retry_wait',jobId:1});
  now=21000;expect(await worker.runNextFetch(options)).toEqual({status:'exhausted',jobId:1});
  now=61000;expect(await worker.runNextFetch(options)).toEqual({status:'idle'});
  expect(requests).toBe(3);
});
test('corrupt saved continuation does not cause a network request',async()=>{
  let requests=0;options.request=async()=>{requests++;return response();};
  db.prepare('UPDATE fetch_jobs SET continuation_json=?').run('{invalid');
  expect(await worker.runNextFetch(options)).toEqual({status:'retry_wait',jobId:1});
  expect(requests).toBe(0);
  expect(fs.readdirSync(path.join(directory,'originals'))).toEqual([]);
});

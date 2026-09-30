const {initializeDatabase}=require('../init-db');
const {openStore}=require('../storage');
const {createTopic}=require('../research');
const {createSourceRegistry}=require('../discovery/registry');
const {enqueueFetchJob,claimFetchJob:claimRaw,releaseFetchJob}=require('../discovery/fetch-jobs');
const fs=require('fs'),os=require('os'),path=require('path');
const registry=createSourceRegistry([{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/plain'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
const claimFetchJob=(db,options)=>claimRaw(db,{registry,...options});
let db,directory,topic;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-fetch-job-'));const filename=path.join(directory,'fixture.db');initializeDatabase(filename);db=openStore(filename);db.exec("INSERT INTO users(id,username,password) VALUES(1,'editor','disabled'),(2,'reader','disabled'); INSERT INTO user_roles(user_id,role) VALUES(1,'editor')");topic=createTopic(db,'fixture','Fixture');});
afterEach(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
const input=()=>({topicId:topic.id,actorId:1,sourceId:'fixture',url:'https://records.example.org/document',registry});
test('editor enqueue is idempotent for exact topic URL and policy',()=>{
  const first=enqueueFetchJob(db,input()),second=enqueueFetchJob(db,input());
  expect(second.id).toBe(first.id);expect(first.state).toBe('queued');
  expect(first.policy_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(first.actor_id).toBe(1);
});
test('reader or unknown topic cannot enqueue',()=>{
  expect(()=>enqueueFetchJob(db,{...input(),actorId:2})).toThrow();
  expect(()=>enqueueFetchJob(db,{...input(),topicId:999})).toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM fetch_jobs').get().n).toBe(0);
});
test('active lease is exclusive; expiration replaces its fencing token',()=>{
  enqueueFetchJob(db,input());
  const first=claimFetchJob(db,{now:1000});
  expect(first.state).toBe('leased');expect(first.lease_token).toBeTruthy();
  expect(claimFetchJob(db,{now:1001})).toBeNull();
  const recovered=claimFetchJob(db,{now:31000});
  expect(recovered.id).toBe(first.id);expect(recovered.lease_token).not.toBe(first.lease_token);
  expect(recovered.failures).toBe(1);
});
test('expired leases eventually exhaust instead of retrying forever',()=>{
  enqueueFetchJob(db,input());
  claimFetchJob(db,{now:1000});claimFetchJob(db,{now:31000});claimFetchJob(db,{now:61000});
  expect(claimFetchJob(db,{now:91000})).toBeNull();
  expect(db.prepare('SELECT state FROM fetch_jobs').get().state).toBe('exhausted');
});
test('rate pause persists continuation without spending failure allowance',()=>{
  enqueueFetchJob(db,input());const job=claimFetchJob(db,{now:1000});
  const continuation={url:input().url,redirects:[]};
  expect(releaseFetchJob?.(db,job,{now:1001,retryAt:5000,code:'rate_limited',continuation})).toBe(true);
  db.close();db=openStore(path.join(directory,'fixture.db'));
  expect(claimFetchJob(db,{now:4999})).toBeNull();
  const resumed=claimFetchJob(db,{now:5000});
  expect(resumed.failures).toBe(0);
  expect(JSON.parse(resumed.continuation_json)).toEqual(continuation);
});
test('expired and replaced workers cannot release another lease',()=>{
  enqueueFetchJob(db,input());const old=claimFetchJob(db,{now:1000});
  expect(releaseFetchJob?.(db,old,{now:31000,retryAt:32000,code:'timeout'})).toBe(false);
  const current=claimFetchJob(db,{now:31000});
  expect(releaseFetchJob?.(db,old,{now:31001,retryAt:32000,code:'timeout'})).toBe(false);
  expect(db.prepare('SELECT lease_token FROM fetch_jobs').get().lease_token).toBe(current.lease_token);
});
test('failed downloads exhaust their bounded allowance',()=>{
  enqueueFetchJob(db,input());
  for(let n=0;n<3;n++) {
    const job=claimFetchJob(db,{now:1000+n*1000});
    expect(releaseFetchJob?.(db,job,{now:1001+n*1000,retryAt:2000+n*1000,code:'timeout'})).toBe(true);
  }
  expect(claimFetchJob(db,{now:5000})).toBeNull();
  expect(db.prepare('SELECT state,failures FROM fetch_jobs').get()).toEqual({state:'exhausted',failures:3});
});
test('revoked editor blocks release instead of requeueing',()=>{
  enqueueFetchJob(db,input());const job=claimFetchJob(db,{now:1000});
  db.exec('DELETE FROM user_roles WHERE user_id=1');
  expect(releaseFetchJob?.(db,job,{now:1001,retryAt:2000,code:'timeout'})).toBe(false);
  expect(db.prepare('SELECT state,last_error,lease_token FROM fetch_jobs').get()).toEqual({state:'blocked',last_error:'editor_revoked',lease_token:null});
});
test('malformed retry state does not mutate an active job',()=>{
  enqueueFetchJob(db,input());const job=claimFetchJob(db,{now:1000});
  expect(typeof releaseFetchJob).toBe('function');
  for(const options of [
    {now:1001,retryAt:1000,code:'timeout'},
    {now:1001,retryAt:2000,code:'private error text'},
    {now:1001,retryAt:2000,code:'rate_limited',continuation:{url:'https://evil.example/a',redirects:[]}},
    {now:1001,retryAt:2000,code:'upstream_backoff'},
    {now:1001,retryAt:2000,code:'upstream_backoff',continuation:{url:input().url,redirects:[{url:input().url,status:302}]}},
    {now:1001,retryAt:2000,code:'upstream_backoff',continuation:{url:input().url,redirects:[{url:input().url,status:200}]}},
    {now:1001,retryAt:2000,code:'timeout',continuation:{url:input().url,redirects:[]}}
  ]) expect(()=>releaseFetchJob(db,job,options)).toThrow();
  expect(db.prepare('SELECT state,lease_token FROM fetch_jobs').get()).toEqual({state:'leased',lease_token:job.lease_token});
});
test('upstream backoff preserves redirect history through the next lease',()=>{
  enqueueFetchJob(db,input());const job=claimFetchJob(db,{now:1000});
  const continuation={url:'https://records.example.org/redirected',redirects:[{url:input().url,status:302}]};
  expect(releaseFetchJob(db,job,{now:1001,retryAt:60000,code:'upstream_backoff',continuation})).toBe(true);
  const resumed=claimFetchJob(db,{now:60000});
  expect(JSON.parse(resumed.continuation_json)).toEqual(continuation);
  expect(resumed.failures).toBe(0);
});
test('claim requires live source registry without changing queued state',()=>{
  enqueueFetchJob(db,input());
  expect(()=>claimRaw(db,{now:1000})).toThrow();
  expect(db.prepare('SELECT state FROM fetch_jobs').get().state).toBe('queued');
});
test.each(['removed','changed','corrupt'])('claim blocks %s policy without leasing',kind=>{
  enqueueFetchJob(db,input());
  let active=registry;
  if(kind==='removed') active=createSourceRegistry([]);
  if(kind==='changed') active=createSourceRegistry([{...registry.resolve('fixture',input().url),retention:'metadata-only'}]);
  if(kind==='corrupt') db.prepare('UPDATE fetch_jobs SET policy_json=?').run('{}');
  expect(claimFetchJob(db,{registry:active,now:1000})).toBeNull();
  expect(db.prepare('SELECT state,last_error,lease_token,failures FROM fetch_jobs').get())
    .toEqual({state:'blocked',last_error:'source_policy_changed',lease_token:null,failures:0});
});
test('blocked old policy does not starve newly authorized job',()=>{
  const old=enqueueFetchJob(db,input());
  const active=createSourceRegistry([{...registry.resolve('fixture',input().url),requestsPerMinute:3}]);
  const fresh=enqueueFetchJob(db,{...input(),registry:active});
  expect(claimFetchJob(db,{registry:active,now:1000}).id).toBe(fresh.id);
  expect(db.prepare('SELECT state FROM fetch_jobs WHERE id=?').get(old.id).state).toBe('blocked');
});

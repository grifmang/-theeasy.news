const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');
const {startService}=require('../bootstrap');
const {initializeDatabase}=require('../init-db');
const {openStore}=require('../storage');
const {backupAndMigrate}=require('../migrate');
const {createTopic,addClaim,importDocument,addPassage}=require('../research');
const {enqueueClaimJob}=require('../claim-jobs');
const {getProviderPermission,setProviderPermission}=require('../provider-permission');
const {createBudgetGuard}=require('../models/budget-guard');
let directory, service;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-news-service-'));});
afterEach(async()=>{if(service) await service.stop(); service=null; fs.rmSync(directory,{recursive:true,force:true});});
function env(extra={}) {return {NODE_ENV:'test',DB_PATH:path.join(directory,'service.db'),PORT:'0',HOST:'127.0.0.1',...extra};}
test('maintenance listens without opening a database and rejects all research traffic',async()=>{
  service=await startService(env({MAINTENANCE_MODE:'true',HTML_EXTRACTION_ENABLED:'true'}));
  const http=require('http');
  const request=(route,method='GET')=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:service.server.address().port,path:route,method},res=>{
      let body='';res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body),headers:res.headers}));
    });req.on('error',reject);req.end();
  });
  expect((await request('/health/ready')).body).toEqual({status:'maintenance',writesEnabled:false});
  for(const [route,method] of [['/api/v1/editor/topics','POST'],['/api/v1/editor/topics','GET'],['/login','POST']]) {
    const response=await request(route,method);expect(response.status).toBe(503);expect(response.headers['retry-after']).toBe('60');
  }
  expect(service.db).toBeNull();expect(fs.readdirSync(directory)).toEqual([]);
  await service.stop();await service.stop();expect(service.server.listening).toBe(false);
});
test('HTML opt-in cannot listen without private original storage',async()=>{
  const config=env({HTML_EXTRACTION_ENABLED:'true'});initializeDatabase(config.DB_PATH);
  await expect(startService(config).then(value=>{service=value;return value;})).rejects.toThrow(/HTML.*archive/);
});
test('HTML opt-in rejects an unverified runtime before listening',async()=>{
  const archive=path.join(directory,'originals');fs.mkdirSync(archive);
  const config=env({HTML_EXTRACTION_ENABLED:'true',ARCHIVE_PATH:archive});initializeDatabase(config.DB_PATH);
  await expect(startService(config).then(value=>{service=value;return value;})).rejects.toThrow(/HTML/);
});
test('enabled ingestion fails closed without approved policies and archive',async()=>{
  const config=env({INGESTION_ENABLED:'true'});initializeDatabase(config.DB_PATH);
  await expect(startService(config).then(value=>{service=value;return value;})).rejects.toThrow(/ingestion/i);
});
test.each(['[]','{invalid','[{"id":"unreviewed"}]'])('ingestion rejects invalid source configuration %s before listening',async policies=>{
  const archive=path.join(directory,'originals');fs.mkdirSync(archive);
  const config=env({INGESTION_ENABLED:'true',SOURCE_POLICIES_JSON:policies,ARCHIVE_PATH:archive});
  initializeDatabase(config.DB_PATH);
  await expect(startService(config).then(value=>{service=value;return value;})).rejects.toThrow(/ingestion/i);
});
test('ingestion shutdown cancels active fetch before closing database',async()=>{
  const policies=[{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/plain'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}];
  const archive=path.join(directory,'originals');fs.mkdirSync(archive);
  const config=env({INGESTION_ENABLED:'true',SOURCE_POLICIES_JSON:JSON.stringify(policies),ARCHIVE_PATH:archive});
  initializeDatabase(config.DB_PATH);
  const seed=openStore(config.DB_PATH);
  seed.exec("INSERT INTO users(id,username,password) VALUES(1,'editor','disabled'); INSERT INTO user_roles VALUES(1,'editor')");
  const topic=createTopic(seed,'ingestion','Ingestion');
  const registry=require('../discovery/registry').createSourceRegistry(policies);
  require('../discovery/fetch-jobs').enqueueFetchJob(seed,{topicId:topic.id,actorId:1,sourceId:'fixture',url:'https://records.example.org/a',registry});seed.close();
  let requested=false;
  service=await startService(config,{clock:()=>1000,fetchTransport:{resolver:async()=>[{address:'8.8.8.8',family:4}],request:async({signal})=>{
    requested=true;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true}));
  }}});
  await new Promise(setImmediate);expect(requested).toBe(true);
  await service.stop();expect(service.db.open).toBe(false);
  const check=openStore(config.DB_PATH);
  try {expect(check.prepare('SELECT state,last_error FROM fetch_jobs').get()).toEqual({state:'retry_wait',last_error:'aborted'});}
  finally {check.close();}
});
test('startup requires a prepared database and never creates one',async()=>{
  await expect(startService(env())).rejects.toMatchObject({code:'SQLITE_CANTOPEN'});
  expect(fs.readdirSync(directory)).toEqual([]);
});
test('starts the prepared app and shutdown is idempotent',async()=>{
  const config=env(); initializeDatabase(config.DB_PATH);
  service=await startService(config);
  expect(service.server.address().port).toBeGreaterThan(0);
  expect(service.db.pragma('journal_mode',{simple:true})).toBe('wal');
  await service.stop(); await service.stop();
  expect(service.db.open).toBe(false);
  expect(service.server.listening).toBe(false);
});
test('opt-in classification runs and shutdown drains its audit before closing database',async()=>{
  const config=env({CLASSIFICATION_ENABLED:'true',TYPESAFE_API_KEY:'fixture',DAILY_BUDGET_MICROS:'3000',MONTHLY_BUDGET_MICROS:'3000'});
  initializeDatabase(config.DB_PATH);
  const seed=openStore(config.DB_PATH);
  seed.exec("INSERT INTO users(id,username,password) VALUES(1,'fixture','')");
  const topic=createTopic(seed,'fixture','Fixture');
  const claim=addClaim(seed,{topicId:topic.id,wording:'Fixture',attribution:'Fixture',originUrl:'https://example.com'});
  const doc=importDocument(seed,{topicId:topic.id,source:'Fixture',url:'https://example.com',title:'Fixture',content:'Fixture',kind:'report',originChain:'fixture',extractionMethod:'fixture'});
  const passage=addPassage(seed,{documentId:doc.id,start:0,end:7,locator:'first'});
  const job=enqueueClaimJob(seed,{claimId:claim.id,contextVersionId:null,passageId:passage.id,model:'jev-1.13.0',questionVersion:'passage-v1',policyVersion:'passage-shadow-v1'});
  const permission=getProviderPermission(seed,job.id);
  setProviderPermission(seed,{jobId:job.id,actorId:1,allowed:true,reason:'Fixture',expectedEventId:null,expectedInputHash:permission.inputHash});seed.close();
  let started=false;
  const guardPath=path.join(directory,'budget-guard');fs.mkdirSync(guardPath,{mode:0o700});
  service=await startService(config,{budgetGuard:createBudgetGuard(guardPath),clock:()=>Date.parse('2026-09-20T00:00:00.000Z'),classificationClient:{evaluate:async(request,{signal})=>{
    started=true;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Cancelled fixture')),{once:true}));
  }}});
  await new Promise(setImmediate);expect(started).toBe(true);
  await service.stop();expect(service.db.open).toBe(false);
  const check=openStore(config.DB_PATH);
  try {expect(check.prepare('SELECT status FROM model_call_results').get().status).toBe('failed');}
  finally {check.close();}
});
test('importing entrypoint is inert without any environment configuration',()=>{
  const result=spawnSync(process.execPath,['-e',`require(${JSON.stringify(path.resolve(__dirname,'../index.js'))})`],{cwd:directory,encoding:'utf8',timeout:5000});
  expect(result.status).toBe(0);
  expect(fs.readdirSync(directory)).toEqual([]);
});
test('invalid network configuration fails before opening database',async()=>{
  await expect(startService(env({PORT:'-1'}))).rejects.toThrow(/PORT/);
  expect(fs.readdirSync(directory)).toEqual([]);
});

test('configured archive must be an existing absolute directory',async()=>{
  const config=env({ARCHIVE_PATH:'relative-archive'});initializeDatabase(config.DB_PATH);
  await expect(startService(config).then(result=>{service=result;return result;})).rejects.toThrow(/archive directory/);
});
test('backup-first upgrade makes a legacy database startable without changing original content',async()=>{
  const config=env();
  const legacy=openStore(config.DB_PATH);
  legacy.exec("CREATE TABLE articles(id INTEGER PRIMARY KEY,content TEXT); INSERT INTO articles VALUES(1,'Original preserved')");
  legacy.close();
  const backup=await backupAndMigrate(config.DB_PATH,directory);
  service=await startService(config);
  expect(service.db.prepare('SELECT content,title FROM articles WHERE id=1').get()).toEqual({content:'Original preserved',title:null});
  const restored=openStore(backup);
  try { expect(restored.prepare('PRAGMA table_info(articles)').all().map(c=>c.name)).toEqual(['id','content']); }
  finally { restored.close(); }
});
test('failed legacy migration rolls back research schema too and leaves a recoverable backup',async()=>{
  const config=env();
  const legacy=openStore(config.DB_PATH);
  legacy.exec("CREATE TABLE articles(id INTEGER PRIMARY KEY,title TEXT,content TEXT); INSERT INTO articles VALUES(1,'Duplicate','First'),(2,'Duplicate','Second')");
  legacy.close();
  await expect(backupAndMigrate(config.DB_PATH,directory)).rejects.toMatchObject({code:'SQLITE_CONSTRAINT_UNIQUE'});
  const check=openStore(config.DB_PATH);
  try {
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name='rebuild_migrations'").get()).toBeUndefined();
    expect(check.prepare('SELECT COUNT(*) n FROM articles').get().n).toBe(2);
  } finally { check.close(); }
  expect(fs.readdirSync(directory).filter(name=>name.startsWith('easy-news-backup-'))).toHaveLength(1);
});

// Mount this test file read-only into the release image. No production data,
// external networking, provider calls or source crawls. All records are synthetic.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const http=require('http');
const {initializeDatabase}=require('/app/init-db');
const {startService}=require('/app/bootstrap');
const {createTopic}=require('/app/research');
const {createSession}=require('/app/auth');
const {csrfToken}=require('/app/session-transport');
const {createSourceRegistry}=require('/app/discovery/registry');
const {enqueueFetchJob,claimFetchJob}=require('/app/discovery/fetch-jobs');
const {storeFetchReceipt}=require('/app/discovery/fetch-receipt');
const {createLocalArchive}=require('/app/evidence/archive');
const {SCHEMA_VERSION}=require('/app/storage');
const {runNextVerificationJob}=require('/app/analysis/worker');
const {createLocalPublicationExport}=require('/app/publication/local-export');
const {runNextPublicationDelivery}=require('/app/publication/outbox');
const Database=require('/app/node_modules/better-sqlite3');

async function main() {
  assert.equal(process.getuid(),1000);
  assert.equal(process.env.SMOKE_ROOT,'/smoke-data');
  assert.equal(SCHEMA_VERSION,33);
  assert.equal(typeof runNextVerificationJob,'function');
  assert.equal(typeof createLocalPublicationExport,'function');
  assert.equal(typeof runNextPublicationDelivery,'function');
  const directory=fs.mkdtempSync(path.join(process.env.SMOKE_ROOT,'easy-container-smoke-'));
  let service;
  try {
    const dbPath=path.join(directory,'fixture.db'),archivePath=path.join(directory,'originals'),exportPath=path.join(directory,'private-export');
    fs.mkdirSync(archivePath,{mode:0o700});fs.mkdirSync(exportPath,{mode:0o700});
    fs.writeFileSync(path.join(exportPath,'write-probe'),'mounted export path is writable',{flag:'wx',mode:0o600});
    initializeDatabase(dbPath);
    const before=new Database(dbPath,{readonly:true,fileMustExist:true});
    const migrationRows=before.prepare('SELECT version,applied_at FROM rebuild_migrations ORDER BY version').all();
    before.close();
    service=await startService({NODE_ENV:'test',DB_PATH:dbPath,ARCHIVE_PATH:archivePath,HOST:'127.0.0.1',PORT:'0',
      GENERATION_ENABLED:'false',CLASSIFICATION_ENABLED:'false',ANALYSIS_VERIFICATION_ENABLED:'false',
      INGESTION_ENABLED:'false',PUBLICATION_EXPORT_ENABLED:'false',AUTO_PUBLISH_ENABLED:'false',
      PUBLICATION_EXPORT_PATH:exportPath,HTML_EXTRACTION_ENABLED:'true',HTML_PARSER_BUNDLE:'/opt/easy-parser',
      HTML_PARSER_DIGEST_FILE:'/opt/easy-parser.sha256',HTML_PARSER_SCRATCH:'/tmp/easy-html'});
    const db=service.db;
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM rebuild_migrations').get().version,SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM rebuild_migrations').get().count,SCHEMA_VERSION);
    assert.deepEqual(db.prepare('SELECT version,applied_at FROM rebuild_migrations ORDER BY version').all(),migrationRows);
    db.exec("INSERT INTO users(id,username,password) VALUES(1,'container-fixture','disabled'); INSERT INTO user_roles VALUES(1,'editor')");
    const token=createSession(db,1).token;
    async function request(route,body) {
      return new Promise((resolve,reject)=>{
        const req=http.request({host:'127.0.0.1',port:service.server.address().port,path:route,method:body===undefined?'GET':'POST',
          headers:{Origin:'http://localhost:3000','Content-Type':'application/json',Cookie:`easy_news_session=${token}`,'X-CSRF-Token':csrfToken(token)}},res=>{
          const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,bytes:Buffer.concat(chunks),headers:res.headers}));
        });
        req.setTimeout(15000,()=>req.destroy(new Error('Fixture request timeout')));
        req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
      });
    }
    assert.equal((await request('/health/ready')).status,200);
    const registry=createSourceRegistry([{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/html'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
    const topic=createTopic(db,'container-fixture','Synthetic container fixture');
    const job=enqueueFetchJob(db,{topicId:topic.id,actorId:1,sourceId:'fixture',url:'https://records.example.org/container',registry});
    const leased=claimFetchJob(db,{registry,now:1000});
    const original=Buffer.from('<!doctype html><p>Container fixture.</p>');
    await storeFetchReceipt(db,leased,{bytes:original,mime:'text/html',status:200,finalUrl:job.url,redirects:[],headers:{'content-type':'text/html'}},
      {registry,archive:createLocalArchive(archivePath),clock:()=>1001});
    const detail=await request(`/api/v1/editor/fetch-jobs/${job.id}`);
    assert.equal(JSON.parse(detail.bytes).extractionAvailable,true);
    const extracted=await request(`/api/v1/editor/fetch-jobs/${job.id}/extract`,{actorId:999,bundleDirectory:'/untrusted'});
    assert.equal(extracted.status,201,extracted.bytes.toString());
    const document=JSON.parse(extracted.bytes);
    const reviewed=JSON.parse((await request(`/api/v1/editor/documents/${document.id}`)).bytes);
    assert.equal(reviewed.source.evidence,'Container fixture.\n');
    assert.equal(reviewed.extractions.length,1);
    assert.equal(reviewed.extractions[0].review.status,'unreviewed');
    const manifest=db.prepare('SELECT * FROM extraction_manifests').get();
    assert.equal(manifest.actor_id,1);assert.equal(manifest.requires_review,1);
    assert.equal(manifest.extractor_version,'parse5-8.0.1-text-v1');
    const downloaded=await request(`/api/v1/editor/extractions/${manifest.id}/original`);
    assert.equal(downloaded.status,200);assert.deepEqual(downloaded.bytes,original);
    assert.equal(downloaded.headers['x-content-type-options'],'nosniff');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM extraction_review_events').get().n,0);
    await service.stop();assert.equal(db.open,false);
    assert.deepEqual(fs.readdirSync('/tmp/easy-html'),[]);
    console.log(JSON.stringify({ready:true,uid:process.getuid(),schema:SCHEMA_VERSION,
      analysisAndPublicationLoadable:true,mountedPathsWritable:true,noStartupMigration:true,
      htmlHttpExtraction:true,originalDownload:true,shutdown:true}));
  } finally {
    await service?.stop();fs.rmSync(directory,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

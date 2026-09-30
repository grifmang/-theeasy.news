// Local browser verification only: synthetic records, no persistent DB or models.
// Run explicitly with `node server/test-support/browser-fixture.js` after UI build.
const path=require('path');
const fs=require('fs'),os=require('os');
const {Readable}=require('stream');
const express=require('express');
const bcrypt=require('bcryptjs');
const {openStore,migrate}=require('../storage');
const {migrateLegacy}=require('../legacy-schema');
const {createApp}=require('../app');
const {createTopic,addClaim,importDocument,addPassage}=require('../research');
const {createLocalArchive}=require('../evidence/archive');
const {createSourceRegistry}=require('../discovery/registry');
const {runNextFetch}=require('../discovery/fetch-worker');
const {startWorkerLoop}=require('../worker-loop');

if(require.main===module) {
  const db=openStore(':memory:');migrate(db);migrateLegacy(db);
  db.prepare('INSERT INTO users(id,username,password) VALUES(1,?,?)').run('fixture-editor',bcrypt.hashSync('local-fixture-only',4));
  db.exec("INSERT INTO user_roles VALUES(1,'editor')");
  const topic=createTopic(db,'browser-fixture','Synthetic research fixture');
  addClaim(db,{topicId:topic.id,wording:'The fictional harbor report was amended.',attribution:'Synthetic test narrator',originUrl:'https://example.org/claim'});
  const document=importDocument(db,{topicId:topic.id,source:'Synthetic fixture',url:'https://example.org/report',
    title:'Fictional harbor report',content:'First edition.\r\nAn amendment was recorded. No real-world allegation is made.',
    kind:'report',originChain:'synthetic-harbor',extractionMethod:'fixture',publishedAt:null});
  addPassage(db,{documentId:document.id,start:16,end:42,locator:'Paragraph 2'});
  const archiveDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-browser-originals-'));
  const archive=createLocalArchive(archiveDirectory);
  const sourceRegistry=createSourceRegistry([{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/plain'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
  const app=createApp({db,services:{archive,sourceRegistry},config:{mode:'test',allowedOrigins:['http://localhost:4311']}});
  // No external traffic: DNS and HTTPS are deliberately simulated in this fixture.
  const worker=startWorkerLoop({runNext:({signal})=>runNextFetch({db,registry:sourceRegistry,archive,signal,
    resolver:async()=>[{address:'8.8.8.8',family:4}],request:async()=>Object.assign(
      Readable.from([Buffer.from('Synthetic downloaded document. This is not real-world evidence.')]),
      {statusCode:200,headers:{'content-type':'text/plain'}})})});
  const frontend=path.resolve(__dirname,'../../theeasynews/build');
  app.use(express.static(frontend));
  app.use((req,res)=>{
    if(req.method!=='GET' || req.path.startsWith('/api/')) return res.status(404).json({error:'Not found'});
    res.sendFile(path.join(frontend,'index.html'));
  });
  const server=app.listen(4311,'127.0.0.1',()=>console.log('Synthetic browser fixture: http://localhost:4311'));
  async function stop() {
    await worker.stop();
    server.close(()=>{db.close();fs.rmSync(archiveDirectory,{recursive:true,force:true});process.exit(0);});
    server.closeIdleConnections();
  }
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

const http=require('http');
const {openStore,migrate}=require('../storage');
const {migrateLegacy}=require('../legacy-schema');
const {createApp}=require('../app');
const {createSession}=require('../auth');
const {csrfToken}=require('../session-transport');
let db,server,token;
beforeEach(async()=>{
  db=openStore(':memory:');migrate(db);migrateLegacy(db);
  db.exec("INSERT INTO articles(id,title,content,author,category) VALUES(1,'Unreviewed','Private legacy prose','Persona','Sensitive'); INSERT INTO users(id,username,password) VALUES(1,'fixture',''); INSERT INTO saved_articles VALUES(1,1); INSERT INTO user_roles VALUES(1,'editor')");
  token=createSession(db,1).token;
  server=createApp({db,config:{mode:'test'}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
});
afterEach(async()=>{await new Promise(r=>server.close(r));db.close();});
function request(path,method='GET',body) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{Cookie:`easy_news_session=${token}`,Origin:'http://localhost:3000','X-CSRF-Token':csrfToken(token),'Content-Type':'application/json'}},res=>{
      let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,text:data}));
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
}
test.each(['/api/articles','/api/articles?search=Private','/api/articles/1','/api/categories','/api/user/1/saved'])('public route %s does not leak unreviewed legacy content',async path=>{
  const result=await request(path);
  expect(result.status).toBeLessThan(500);
  expect(result.text).not.toMatch(/Private legacy prose|Unreviewed|Sensitive/);
  expect(db.prepare('SELECT content FROM articles WHERE id=1').get().content).toBe('Private legacy prose');
});
test('even editors cannot publish through the old create endpoint',async()=>{
  expect((await request('/api/articles','POST',{title:'Bypass',content:'Unreviewed bypass',author:'Editor'})).status).toBe(410);
  expect(db.prepare('SELECT COUNT(*) n FROM articles').get().n).toBe(1);
});
test('editor-only legacy review endpoint retains access to original records',async()=>{
  const result=await request('/api/v1/editor/legacy/articles/1');
  expect(result.status).toBe(200);
  expect(JSON.parse(result.text).article.content).toBe('Private legacy prose');
  db.exec("UPDATE user_roles SET role='reader'");
  expect((await request('/api/v1/editor/legacy/articles/1')).status).toBe(403);
});

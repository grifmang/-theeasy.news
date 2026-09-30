const http=require('http');
const {openStore,migrate}=require('../storage');
const {migrateLegacy}=require('../legacy-schema');
const {createApp}=require('../app');
const {createSession}=require('../auth');
const {csrfToken}=require('../session-transport');
let db,server,userId,token;
beforeEach(async()=>{
  db=openStore(':memory:');migrate(db);migrateLegacy(db);
  userId=Number(db.prepare("INSERT INTO users(username,password) VALUES('reader','')").run().lastInsertRowid);
  token=createSession(db,userId).token;
  server=createApp({db,config:{mode:'test'}}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
});
afterEach(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
function post(route,body,credential=token) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3000',...(credential?{Cookie:`easy_news_session=${credential}`,'X-CSRF-Token':csrfToken(credential)}:{})}},res=>{
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>{let body;try{body=JSON.parse(data);}catch{body={nonJson:true};}resolve({status:res.statusCode,body});});
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
}
test.each(['/api/articles','/api/authors'])('readers cannot write through %s',async route=>{
  expect((await post(route,{title:'Title',content:'Content',author:'Name',name:'Name',persona:'Persona',prompt:'Prompt'})).status).toBe(403);
  expect(db.prepare('SELECT COUNT(*) n FROM articles').get().n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM authors').get().n).toBe(0);
});
test('anonymous writes require authentication',async()=>{
  expect((await post('/api/authors',{},null)).status).toBe(401);
});
test.each([null,{}, {username:123,password:'secret'}, {username:'reader',password:[]}, {username:'reader',password:'x'.repeat(1000)}])('malformed login is a safe client error',async body=>{
  expect((await post('/api/login',body)).status).toBe(400);
});
test('OAuth-only accounts cannot password-login',async()=>{
  expect((await post('/api/login',{username:'reader',password:'some-password'})).status).toBe(401);
});
test('registration cannot assign editor privileges',async()=>{
  const response=await post('/api/register',{username:'new-reader',password:'long-fixture-password',role:'editor'});
  expect(response.status).toBe(200);
  expect(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(response.body.userId)).toBeUndefined();
});

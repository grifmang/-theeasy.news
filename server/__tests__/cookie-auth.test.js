const http=require('http');
const {openStore,migrate}=require('../storage');
const {migrateLegacy}=require('../legacy-schema');
const {createApp}=require('../app');
let db,server;
beforeEach(async()=>{db=openStore(':memory:');migrate(db);migrateLegacy(db);server=createApp({db,config:{mode:'test'}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));});
afterEach(async()=>{await new Promise(r=>server.close(r));db.close();});
function request(method,path,body,headers={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{'Content-Type':'application/json',Origin:'http://localhost:3000',...headers}},res=>{
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>{let parsed;try{parsed=JSON.parse(data);}catch{parsed=null;}resolve({status:res.statusCode,body:parsed,headers:res.headers});});
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
test('register returns only HttpOnly session credential and csrf metadata',async()=>{
  const response=await request('POST','/api/register',{username:'fixture',password:'fixture-long-password'});
  expect(response.status).toBe(200);
  expect(response.body.token).toBeUndefined();
  expect(response.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
  expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  const cookie=response.headers['set-cookie'][0].split(';')[0];
  const rawToken=cookie.slice(cookie.indexOf('=')+1);
  expect((await request('GET','/api/session',undefined,{Authorization:`Bearer ${rawToken}`})).status).toBe(401);
  const session=await request('GET','/api/session',undefined,{Cookie:cookie});
  expect(session.body.userId).toBe(response.body.userId);
  expect(session.headers['cache-control']).toBe('no-store');
  expect((await request('POST','/api/logout',{}, {Cookie:cookie})).status).toBe(403);
  expect((await request('POST','/api/logout',{}, {Cookie:cookie,'X-CSRF-Token':response.body.csrfToken,Origin:'https://evil.example'})).status).toBe(403);
  expect((await request('POST','/api/logout',{}, {Cookie:cookie,'X-CSRF-Token':response.body.csrfToken})).status).toBe(200);
  expect((await request('GET','/api/session',undefined,{Cookie:cookie})).status).toBe(401);
});
test('login and registration reject unapproved origins',async()=>{
  expect((await request('POST','/api/register',{username:'fixture',password:'fixture-long-password'},{Origin:'https://evil.example'})).status).toBe(403);
  expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(0);
});

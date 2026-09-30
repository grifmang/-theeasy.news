const http = require('http');
const {openStore,migrate} = require('../storage');
const {createApp} = require('../app');
const {migrateLegacy} = require('../legacy-schema');
const {createSession} = require('../auth');
let db, server;
afterEach(async()=>{ if(server) await new Promise(resolve=>server.close(resolve)); server=null; if(db?.open) db.close(); });
async function get(route, headers = {}) {
  return new Promise((resolve,reject)=>{
    http.get({hostname:'127.0.0.1',port:server.address().port,path:route,headers},res=>{
      let data=''; res.on('data',chunk=>data+=chunk); res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));
    }).on('error',reject);
  });
}
async function serve() {
  server=createApp({db,config:{mode:'test'}}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
}
test('app construction does not migrate or start listening',()=>{
  db=openStore(':memory:');
  const app=createApp({db,config:{mode:'test'}});
  expect(typeof app).toBe('function');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
});
test('saved articles use session identity and reject another user ID',async()=>{
  db=openStore(':memory:'); migrate(db); migrateLegacy(db);
  const first=Number(db.prepare("INSERT INTO users(username,password) VALUES('first','disabled')").run().lastInsertRowid);
  const second=Number(db.prepare("INSERT INTO users(username,password) VALUES('second','disabled')").run().lastInsertRowid);
  const session=createSession(db,first);
  await serve();
  const headers={Cookie:`easy_news_session=${session.token}`};
  expect((await get(`/api/user/${first}/saved`,headers)).status).toBe(200);
  expect((await get(`/api/user/${second}/saved`,headers)).status).toBe(403);
  db.exec('UPDATE auth_sessions SET revoked=1');
  expect((await get(`/api/user/${first}/saved`,headers)).status).toBe(401);
});
test('live remains available while readiness rejects an unmigrated database',async()=>{
  db=openStore(':memory:'); await serve();
  expect((await get('/health/live')).status).toBe(200);
  expect(await get('/health/ready')).toEqual({status:503,body:{status:'not_ready'}});
});

test('public author profiles exclude internal drafting prompts and future private columns',async()=>{
  db=openStore(':memory:'); migrate(db); migrateLegacy(db);
  db.exec('ALTER TABLE authors ADD COLUMN internal_notes TEXT');
  const author=db.prepare('INSERT INTO authors(name,persona,prompt,internal_notes) VALUES(?,?,?,?)')
    .run('Fixture author','Public biography','Internal drafting instructions','Private review note');
  await serve();
  expect(await get('/api/authors')).toEqual({status:200,body:{authors:[{
    id:Number(author.lastInsertRowid),name:'Fixture author',persona:'Public biography'
  }]}});
});
test('readiness passes current schemas and legacy routes retain their contract',async()=>{
  db=openStore(':memory:'); migrate(db); migrateLegacy(db); await serve();
  expect(await get('/health/ready')).toEqual({status:200,body:{status:'ready'}});
  expect(await get('/api/categories')).toEqual({status:200,body:{categories:[]}});
  db.exec('INSERT INTO rebuild_migrations(version) VALUES(999)');
  expect((await get('/health/ready')).status).toBe(503);
});

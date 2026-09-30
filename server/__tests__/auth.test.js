const {openStore,migrate}=require('../storage');
const {createSession,resolveSession,revokeSession}=require('../auth');
let db,userId;
beforeEach(()=>{
  db=openStore(':memory:');migrate(db);
  userId=Number(db.prepare("INSERT INTO users(username,password) VALUES('fixture','disabled')").run().lastInsertRowid);
});
afterEach(()=>db.close());
test('stores only a token digest and defaults to reader privileges',()=>{
  const session=createSession(db,userId,1000);
  expect(session.token).toMatch(/^[a-f0-9]{64}$/);
  const stored=db.prepare('SELECT * FROM auth_sessions').get();
  expect(JSON.stringify(stored)).not.toContain(session.token);
  expect(resolveSession(db,session.token,1001)).toMatchObject({userId,username:'fixture',role:'reader'});
});
test('expires at idle deadline and revoked tokens cannot be reused',()=>{
  const a=createSession(db,userId,0);
  expect(resolveSession(db,a.token,86400000)).toBeNull();
  const b=createSession(db,userId,0);
  revokeSession(db,b.token);
  expect(resolveSession(db,b.token,1)).toBeNull();
});
test('activity renews idle expiry but never absolute seven-day expiry',()=>{
  const session=createSession(db,userId,0);
  for(let hour=12;hour<168;hour+=12) expect(resolveSession(db,session.token,hour*3600000)).not.toBeNull();
  expect(resolveSession(db,session.token,604800000)).toBeNull();
});
test('role updates take effect for existing sessions without trusting token payloads',()=>{
  const session=createSession(db,userId,0);
  db.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'editor')").run(userId);
  expect(resolveSession(db,session.token,1).role).toBe('editor');
  db.prepare("UPDATE user_roles SET role='reader' WHERE user_id=?").run(userId);
  expect(resolveSession(db,session.token,2).role).toBe('reader');
});
test.each([undefined,null,'',123,'forged','a'.repeat(64)])('unknown and malformed tokens are anonymous',token=>{
  expect(resolveSession(db,token,1)).toBeNull();
});
test('rejects unknown identity and invalid clocks without creating sessions',()=>{
  expect(()=>createSession(db,999,0)).toThrow(/user/);
  expect(()=>createSession(db,userId,-1)).toThrow(/clock/);
  expect(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n).toBe(0);
});

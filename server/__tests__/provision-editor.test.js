const {openStore,migrate}=require('../storage');
const {acceptVerifiedGoogleIdentity}=require('../google-identity');
const {setEditorAccess}=require('../provision-editor');
const {createSession,resolveSession}=require('../auth');
let db,user;
beforeEach(()=>{
  db=openStore(':memory:');migrate(db);
  user=acceptVerifiedGoogleIdentity(db,{iss:'accounts.google.com',aud:'fixture',sub:'known-subject',email:'fixture@example.com',email_verified:true,exp:2000},{audience:'fixture',now:1000});
});
afterEach(()=>db.close());
test('operator can grant and revoke an existing verified identity',()=>{
  const session=createSession(db,user.id,1000);
  setEditorAccess(db,{subject:'known-subject',role:'editor',operator:'fixture-operator',reason:'Approved editor'});
  expect(resolveSession(db,session.token,1001).role).toBe('editor');
  setEditorAccess(db,{subject:'known-subject',role:'reader',operator:'fixture-operator',reason:'Access ended'});
  expect(resolveSession(db,session.token,1002).role).toBe('reader');
});
test('unknown subject cannot create or claim an account',()=>{
  expect(()=>setEditorAccess(db,{subject:'unknown',role:'editor',operator:'fixture',reason:'Fixture'})).toThrow(/identity/);
  expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(1);
  expect(db.prepare('SELECT COUNT(*) n FROM user_roles').get().n).toBe(0);
});
test('role change retains immutable operator reason and previous role',()=>{
  setEditorAccess(db,{subject:'known-subject',role:'editor',operator:'fixture-operator',reason:'Approved editor'});
  expect(db.prepare('SELECT previous_role,new_role,operator,reason FROM role_change_events').get())
    .toEqual({previous_role:'reader',new_role:'editor',operator:'fixture-operator',reason:'Approved editor'});
  expect(()=>db.exec('DELETE FROM role_change_events')).toThrow(/append-only/);
});
test('audit failure rolls back privilege change',()=>{
  db.exec("CREATE TRIGGER reject_fixture_audit BEFORE INSERT ON role_change_events BEGIN SELECT RAISE(ABORT,'fixture audit unavailable'); END");
  expect(()=>setEditorAccess(db,{subject:'known-subject',role:'editor',operator:'fixture',reason:'Fixture'})).toThrow(/audit unavailable/);
  expect(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(user.id)).toBeUndefined();
});
test.each([null,{}, {subject:'',role:'editor'},{subject:'known-subject',role:'owner'}])('rejects invalid operator input %j',input=>{
  expect(()=>setEditorAccess(db,input)).toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM user_roles').get().n).toBe(0);
});

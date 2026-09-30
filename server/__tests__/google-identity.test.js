const {openStore,migrate}=require('../storage');
const {acceptVerifiedGoogleIdentity}=require('../google-identity');
let db;
const payload={iss:'https://accounts.google.com',aud:'fixture-client',sub:'subject-123',email:'person@example.com',email_verified:true,exp:2000};
const options={audience:'fixture-client',now:1000000};
beforeEach(()=>{db=openStore(':memory:');migrate(db);});
afterEach(()=>db.close());
test('same subject retains identity after verified email changes',()=>{
  const first=acceptVerifiedGoogleIdentity(db,payload,options);
  const second=acceptVerifiedGoogleIdentity(db,{...payload,email:'changed@example.com'},options);
  expect(second.id).toBe(first.id);
  expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(1);
});
test('matching email never links to a password account or another subject',()=>{
  const existing=Number(db.prepare("INSERT INTO users(username,password) VALUES(?,'fixture-hash')").run(payload.email).lastInsertRowid);
  const first=acceptVerifiedGoogleIdentity(db,payload,options);
  const other=acceptVerifiedGoogleIdentity(db,{...payload,sub:'subject-456'},options);
  expect(first.id).not.toBe(existing);
  expect(other.id).not.toBe(first.id);
  expect(db.prepare('SELECT password FROM users WHERE id=?').get(first.id).password).toBe('');
});
test.each([{iss:'https://attacker.example'},{aud:'other-client'},{email_verified:false},{sub:''},{exp:1000},{exp:'2000'},{email:null}])('rejects invalid verified-claim shape %j',change=>{
  expect(()=>acceptVerifiedGoogleIdentity(db,{...payload,...change},options)).toThrow(/Google/);
  expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(0);
});
test('normalizes the two permitted Google issuer spellings',()=>{
  const first=acceptVerifiedGoogleIdentity(db,payload,options);
  expect(acceptVerifiedGoogleIdentity(db,{...payload,iss:'accounts.google.com'},options).id).toBe(first.id);
});

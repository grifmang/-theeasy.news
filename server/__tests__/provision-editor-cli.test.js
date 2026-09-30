const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');
const {initializeDatabase}=require('../init-db');
const {openStore}=require('../storage');
let directory;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-news-role-cli-'));});
afterEach(()=>fs.rmSync(directory,{recursive:true,force:true}));
const script=path.resolve(__dirname,'../provision-editor.js');
test('real CLI grants verified identity and records OS operator without printing subject',()=>{
  const filename=path.join(directory,'test.db');initializeDatabase(filename);
  const db=openStore(filename);
  try {
    const userId=Number(db.prepare("INSERT INTO users(username,password) VALUES('fixture','')").run().lastInsertRowid);
    db.prepare('INSERT INTO google_identities(subject,user_id) VALUES(?,?)').run('fixture-subject',userId);
    const result=spawnSync(process.execPath,[script,filename,'fixture-subject','editor','Approved fixture'],{encoding:'utf8'});
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('fixture-subject');
    expect(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(userId).role).toBe('editor');
    expect(db.prepare('SELECT operator,reason FROM role_change_events').get()).toEqual({operator:os.userInfo().username,reason:'Approved fixture'});
  } finally {db.close();}
});
test('CLI rejects missing database without creating it',()=>{
  const filename=path.join(directory,'missing.db');
  expect(spawnSync(process.execPath,[script,filename,'fixture','editor','Fixture'],{encoding:'utf8'}).status).toBe(1);
  expect(fs.existsSync(filename)).toBe(false);
});

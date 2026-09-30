const path=require('path');
const os=require('os');
const Database=require('better-sqlite3');
const {SCHEMA_VERSION}=require('./storage');

// Trusted local operator interface only. Never mount this function on a route.
function setEditorAccess(db,input) {
  if(!input || typeof input.subject!=='string' || !input.subject.trim() || input.subject.length>255 ||
    !['reader','editor'].includes(input.role)) throw new Error('Invalid editor access request');
  for(const field of ['operator','reason']) {
    if(typeof input[field]!=='string' || !input[field].trim() || input[field].length>1000) throw new Error(`Invalid ${field}`);
  }
  return db.transaction(()=>{
    const identity=db.prepare('SELECT user_id FROM google_identities WHERE subject=?').get(input.subject);
    if(!identity) throw new Error('Verified Google identity not found; sign in first');
    const previous=db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(identity.user_id)?.role || 'reader';
    db.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role')
      .run(identity.user_id,input.role);
    db.prepare('INSERT INTO role_change_events(user_id,previous_role,new_role,operator,reason) VALUES(?,?,?,?,?)')
      .run(identity.user_id,previous,input.role,input.operator,input.reason);
    return {userId:identity.user_id,role:input.role};
  }).immediate();
}
function provision(filename,subject,role,reason) {
  if(typeof filename!=='string' || !path.isAbsolute(filename)) throw new Error('Absolute existing database path required');
  const db=new Database(filename,{fileMustExist:true});
  try {
    db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
    if(db.prepare('SELECT MAX(version) version FROM rebuild_migrations').get().version!==SCHEMA_VERSION) throw new Error('Migrate database first');
    return setEditorAccess(db,{subject,role,reason,operator:os.userInfo().username});
  } finally {db.close();}
}
module.exports={setEditorAccess,provision};
if(require.main===module) {
  try {
    if(process.argv.length!==6) throw new Error('Usage: node provision-editor.js <absolute-db-path> <verified-google-subject> <editor|reader> <reason>');
    const result=provision(...process.argv.slice(2));
    console.log(`User ${result.userId} role set to ${result.role}`);
  } catch(error) {console.error(error.message);process.exitCode=1;}
}

'use strict';
const path=require('node:path');
const os=require('node:os');
const Database=require('better-sqlite3');
const {SCHEMA_VERSION}=require('./storage');
const {setPublicationOwner}=require('./publication/owner-authority');
function provision(filename,subject,action,reason,expectedEventId,requestKey){
  if(typeof filename!=='string'||!path.isAbsolute(filename)||filename.includes('\0'))
    throw new Error('Absolute existing database path required');
  if(!['grant','revoke'].includes(action))throw new Error('Action must be grant or revoke');
  const expected=expectedEventId==='none'?null:Number(expectedEventId);
  if(expectedEventId!=='none'&&(!/^[1-9]\d*$/.test(expectedEventId)||!Number.isSafeInteger(expected)))
    throw new Error('Expected event ID must be none or a positive integer');
  const db=new Database(filename,{fileMustExist:true});
  try{
    db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
    if(db.prepare('SELECT MAX(version) version FROM rebuild_migrations').get().version!==SCHEMA_VERSION)
      throw new Error('Migrate database first');
    const event=setPublicationOwner(db,{subject,allowed:action==='grant',reason,
      operator:os.userInfo().username,expectedEventId:expected,requestKey});
    return {id:event.id,allowed:event.allowed===1};
  }finally{db.close();}
}
module.exports={provision};
if(require.main===module){
  try{
    if(process.argv.length!==8)throw new Error('Usage: node provision-publication-owner.js <absolute-db-path> <verified-google-subject> <grant|revoke> <reason> <expected-event-id|none> <request-key>');
    const result=provision(...process.argv.slice(2));
    console.log(`Publication owner event ${result.id} recorded (${result.allowed?'grant':'revoke'})`);
  }catch(error){console.error('Publication owner operation failed; check arguments, identity, schema, and expected event');process.exitCode=1;}
}

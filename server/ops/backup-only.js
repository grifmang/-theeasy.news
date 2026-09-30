const fs=require('fs');
const path=require('path');
const Database=require('better-sqlite3');

// Operator-only local snapshot. No migrations, scheduler, or provider imports.
async function backupOnly(source,destination) {
  if(typeof source!=='string'||typeof destination!=='string'||
    !path.isAbsolute(source)||!path.isAbsolute(destination)) {
    throw new Error('Absolute source and destination paths required');
  }
  const db=new Database(source,{readonly:true,fileMustExist:true});
  try {
    // Exclusive reservation prevents overwriting an existing file or symlink.
    // Parent directory must be private and controlled by the operator.
    fs.closeSync(fs.openSync(destination,'wx',0o600));
    await db.backup(destination);
    const restored=new Database(destination,{fileMustExist:true});
    try {
      // Normalize only this new backup, never the live source. A standalone
      // image can be restored without WAL sidecars or a writable source volume.
      if(restored.pragma('journal_mode = DELETE',{simple:true})!=='delete') throw new Error('Snapshot journal normalization failed');
      if(restored.pragma('integrity_check',{simple:true})!=='ok') {
        throw new Error('Snapshot integrity check failed');
      }
      if(restored.pragma('foreign_key_check').length) {
        throw new Error('Snapshot foreign-key check failed');
      }
    } finally {restored.close();}
    return destination;
  } finally {db.close();}
}
module.exports={backupOnly};
if(require.main===module) {
  const args=process.argv.slice(2);
  const operation=args.length===2?backupOnly(...args):Promise.reject(new Error('Usage: node ops/backup-only.js <absolute-source> <absolute-new-snapshot>'));
  operation.then(()=>console.log('Snapshot created and integrity checked.'))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}

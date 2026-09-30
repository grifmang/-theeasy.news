// Host-only encrypted backup for the currently empty-originals workspace.
// Refuses a snapshot with archived originals rather than silently omitting files.
// Neither private data nor keys are printed. No production migration occurs.
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const {spawnSync}=require('child_process');
const {encryptBackup,verifyBackup}=require('./windows-recovery');
const {runLocked,writeStatus}=require('./windows-backup-state');
const {applyRetention,trustedDirectory}=require('./windows-backup-retention');
function backup() {
  if(process.platform!=='win32') throw new Error('This recovery operation requires Windows');
  // Task Scheduler runs outside Codex's package; the shorter AppData alias is invisible there.
  const directory='C:/Users/grifm/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EasyNews/recovery';
  const settings={directory,age:'C:/Users/grifm/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EasyNews/tools/age-1.3.2/age.exe',
    ageKeygen:'C:/Users/grifm/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EasyNews/tools/age-1.3.2/age-keygen.exe',
    powershell:'C:/Users/grifm/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'};
  trustedDirectory(directory);
  const remote=`(async()=>{const fs=require('fs'),D=require('better-sqlite3'),c=require('crypto');
    if(process.env.DB_PATH!=='/data/research/easy-news.db') throw new Error('Active database path differs from backup target');
    const destination='/data/research/backups/windows-recovery-'+Date.now()+'-'+c.randomUUID()+'.db';
    try {
      await require('./ops/backup-only').backupOnly('/data/research/easy-news.db',destination);
      const db=new D(destination,{fileMustExist:true});
      try {
        // Deployed backup-only may predate standalone journal normalization.
        if(db.pragma('journal_mode = DELETE',{simple:true})!=='delete'||db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length) throw new Error('Snapshot verification failed');
        if(db.prepare('SELECT COUNT(*) n FROM original_objects').get().n!==0) throw new Error('Original-file backup required');
      }finally{db.close();}
      if(fs.statSync(destination).size>33554432) throw new Error('Snapshot too large');
      const bytes=fs.readFileSync(destination);
      try {process.stdout.write(bytes.toString('base64'));}finally{bytes.fill(0);}
    }finally{
      for(const suffix of ['','-wal','-shm']) {
        try {fs.unlinkSync(destination+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}
      }
    }
  })().catch(()=>{console.error('Snapshot export rejected');process.exitCode=1;});`;
  const encoded=Buffer.from(remote).toString('base64');
  const exported=spawnSync('C:/Users/grifm/AppData/Local/npm-cache/_npx/79fa66f96c8fdacf/node_modules/@railway/cli/bin/railway.exe',[
    'ssh','-p','e8d6fdb7-6468-4b4d-a074-200ba127a827','-s','35900e6b-6d99-477a-b104-21cde85264b5',
    '-e','e3f4d555-96a3-44d9-bf3b-e87fcc7d4947','-i','C:/Users/grifm/.ssh/easy-news-railway','--',
    'node','-e',`eval(Buffer.from('${encoded}','base64').toString())`
  ],{timeout:120000,maxBuffer:45000000,windowsHide:true});
  let filename;
  try {
    if(exported.status!==0) throw new Error('Railway snapshot export failed; no backup promoted');
    const data=exported.stdout.toString('ascii').trim();
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid snapshot export framing');
    const bytes=Buffer.from(data,'base64');
    try {filename=encryptBackup(bytes,settings);} finally {bytes.fill(0);}
  }finally{exported.stdout?.fill(0);}
  const restored=verifyBackup(filename,settings);
  const summary={filename,sha256:crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
    ...restored,keyProtection:'Windows DPAPI CurrentUser; retain this Windows profile',originalFiles:0,productionMigrated:false};
  // Sidecar contains only operational metadata, not data or key material.
  fs.writeFileSync(path.join(directory,path.basename(filename)+'.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
  return summary;
}
function main() {
  const directory='C:/Users/grifm/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/EasyNews/recovery';
  return runLocked(directory,()=>{
    try {
      const summary=backup();
      writeStatus(directory,{outcome:'success',at:new Date().toISOString(),sha256:summary.sha256});
      const retention=applyRetention(directory,{dryRun:false});
      console.log(JSON.stringify({...summary,retained:retention.keep.length,removed:retention.remove.length}));
      return summary;
    }catch(error){
      try{writeStatus(directory,{outcome:'failure',at:new Date().toISOString()});}catch{}
      throw error;
    }
  });
}
if(require.main===module) try{main();}catch{console.error('Encrypted recovery operation failed; inspect local status and backup inventory');process.exitCode=1;}
module.exports={main};

const fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os');
const {trustedDirectory,regular}=require('./windows-backup-retention');
function reclaimDeadLock(root,file) {
  const {stat}=regular(root,'backup-run.lock');
  if(stat.size>1024)throw new Error('Backup lock invalid; inspect manually');
  let owner;
  try {owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch{
    if(Date.now()-stat.mtimeMs<15*60*1000)throw new Error('Backup lock is initializing');
    // A crash between exclusive create and fsync has no PID to inspect.
    owner=null;
  }
  if(owner===null&&Date.now()-stat.mtimeMs<15*60*1000)throw new Error('Backup lock is initializing');
  if(owner!==null){
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0||
      owner.host!==os.hostname()||owner.user!==os.userInfo().username||
      !Number.isFinite(Date.parse(owner.startedAt)))throw new Error('Backup lock owner unknown; inspect manually');
    try{process.kill(owner.pid,0);throw new Error('Backup already running');}
    catch(error){if(error.code!=='ESRCH')throw error;}
  }
  const current=regular(root,'backup-run.lock').stat;
  if(current.dev!==stat.dev||current.ino!==stat.ino||current.size!==stat.size)
    throw new Error('Backup lock changed during recovery');
  fs.unlinkSync(file);
}
function runLocked(directory,operation) {
  const root=trustedDirectory(directory),file=path.join(root,'backup-run.lock');
  let fd;
  try{fd=fs.openSync(file,'wx',0o600);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    reclaimDeadLock(root,file);
    fd=fs.openSync(file,'wx',0o600);
  }
  const opened=fs.fstatSync(fd);
  const owner={pid:process.pid,host:os.hostname(),user:os.userInfo().username,startedAt:new Date().toISOString()};
  try{fs.writeFileSync(fd,JSON.stringify(owner));fs.fsyncSync(fd);}
  catch(error){
    const current=fs.lstatSync(file);
    if(current.dev===opened.dev&&current.ino===opened.ino)fs.unlinkSync(file);
    fs.closeSync(fd);throw error;
  }
  try {return operation();}
  finally {
    try {
      const current=fs.lstatSync(file);
      if(current.dev===opened.dev&&current.ino===opened.ino&&current.isFile()&&!current.isSymbolicLink())fs.unlinkSync(file);
    } finally {fs.closeSync(fd);}
  }
}
function writeStatus(directory,{outcome,at,sha256=null}) {
  const root=trustedDirectory(directory);
  if(!['success','failure'].includes(outcome)||!Number.isFinite(Date.parse(at))||
    (outcome==='success'&&!/^[a-f0-9]{64}$/.test(sha256))||
    (outcome==='failure'&&sha256!==null))throw new Error('Invalid backup status');
  const status=path.join(root,'backup-status.json');
  let previous={};
  if(fs.existsSync(status)){
    if(regular(root,'backup-status.json').stat.size>8192)throw new Error('Backup status exceeds size limit');
    previous=JSON.parse(fs.readFileSync(status,'utf8'));
  }
  const next={version:1,lastSuccessAt:previous.lastSuccessAt||null,lastSuccessSha256:previous.lastSuccessSha256||null,
    lastFailureAt:previous.lastFailureAt||null};
  if(outcome==='success'){next.lastSuccessAt=at;next.lastSuccessSha256=sha256;}
  else next.lastFailureAt=at;
  const temporary=path.join(root,`backup-status-${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(fd,JSON.stringify(next)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    fs.renameSync(temporary,status);
  }finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return next;
}
module.exports={runLocked,writeStatus};

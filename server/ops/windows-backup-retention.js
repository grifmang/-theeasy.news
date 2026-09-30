// Host-only retention for verified, encrypted Windows recovery artifacts.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const artifact=/^easy-news-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.db\.age$/;
const statusTemporary=/^backup-status-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const controls=new Set(['identity.dpapi','recipient.txt','backup-status.json','backup-run.lock']);
function trustedDirectory(directory) {
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('Absolute recovery directory required');
  function check(resolved) {
    const root=path.parse(resolved).root;
    let part=root;
    for(const name of path.relative(root,resolved).split(path.sep).filter(Boolean)) {
      part=path.join(part,name);
      const stat=fs.lstatSync(part);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Linked recovery directory rejected');
    }
  }
  const resolved=path.resolve(directory);check(resolved);
  // Windows packaged-app filesystem virtualization can redirect AppData without
  // exposing an NTFS reparse point. Work only with the resolved physical root.
  const canonical=fs.realpathSync.native(resolved);check(canonical);
  return canonical;
}
function regular(directory,name) {
  if(path.basename(name)!==name)throw new Error('Invalid recovery filename');
  const file=path.join(directory,name),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
    fs.realpathSync.native(file).toLowerCase()!==file.toLowerCase())throw new Error('Linked or irregular recovery file rejected');
  return {file,stat};
}
function boundedRead(file,stat,maximum) {
  if(stat.size>maximum)throw new Error('Recovery file exceeds size limit');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.nlink!==1||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)
      throw new Error('Recovery file changed while opening');
    const bytes=fs.readFileSync(fd);
    if(bytes.length!==stat.size)throw new Error('Recovery file changed while reading');
    return bytes;
  }finally{fs.closeSync(fd);}
}
function hashFile(file,stat) {
  const bytes=boundedRead(file,stat,40*1024*1024);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function candidates(directory) {
  const root=trustedDirectory(directory),names=fs.readdirSync(root),all=new Set(names),result=[];
  for(const name of names) {
    const artifactFile=regular(root,name);
    if(controls.has(name))continue;
    if(statusTemporary.test(name)){
      if(artifactFile.stat.size>8192)throw new Error('Recovery status temporary file exceeds size limit');
      continue;
    }
    const match=artifact.exec(name);
    if(!match) {
      if(name.endsWith('.db.age.json')&&artifact.test(name.slice(0,-5))&&all.has(name.slice(0,-5))) {
        if(artifactFile.stat.size>8192)throw new Error('Recovery sidecar exceeds size limit');
        continue;
      }
      // Old interrupted one-off backups have no sidecar. Keep them for manual review.
      throw new Error('Unrecognized recovery file; retention stopped');
    }
    if(artifactFile.stat.size>40*1024*1024)throw new Error('Recovery artifact exceeds size limit');
    if(!all.has(name+'.json'))continue;
    const sidecarFile=regular(root,name+'.json');
    const sidecar=JSON.parse(boundedRead(sidecarFile.file,sidecarFile.stat,8192).toString('utf8'));
    if(typeof sidecar.filename!=='string'||!path.isAbsolute(sidecar.filename)||
      fs.realpathSync.native(sidecar.filename).toLowerCase()!==path.join(root,name).toLowerCase()||
      !/^([a-f0-9]{64})$/.test(sidecar.sha256)||
      sidecar.sha256!==hashFile(artifactFile.file,artifactFile.stat))throw new Error('Recovery sidecar or hash mismatch');
    const timestamp=new Date(match[1].replace(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d{3}Z)$/,'$1:$2:$3.$4'));
    if(!Number.isFinite(timestamp.getTime()))throw new Error('Invalid backup timestamp');
    result.push({name,sidecar:name+'.json',timestamp});
  }
  return result.sort((a,b)=>b.timestamp-a.timestamp||b.name.localeCompare(a.name));
}
function retentionPlan(directory,{daily=7,weekly=4}={}) {
  if(!Number.isInteger(daily)||daily<1||!Number.isInteger(weekly)||weekly<0)throw new Error('Invalid retention policy');
  const entries=candidates(directory),keep=new Set(),days=new Set(),weeks=new Set();
  if(entries.length)keep.add(entries[0].name); // newest verified artifact always survives
  for(const entry of entries) {
    const day=entry.timestamp.toISOString().slice(0,10);
    if(!days.has(day)&&days.size<daily){days.add(day);keep.add(entry.name);}
    const date=new Date(Date.UTC(entry.timestamp.getUTCFullYear(),entry.timestamp.getUTCMonth(),entry.timestamp.getUTCDate()));
    const dow=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-dow);
    const week=date.toISOString().slice(0,10);
    if(!weeks.has(week)&&weeks.size<weekly){weeks.add(week);keep.add(entry.name);}
  }
  return {keep:entries.filter(e=>keep.has(e.name)).map(e=>e.name),remove:entries.filter(e=>!keep.has(e.name)).map(e=>e.name)};
}
function applyRetention(directory,{dryRun=true,...policy}={}) {
  const root=trustedDirectory(directory),plan=retentionPlan(root,policy);
  if(dryRun)return {...plan,dryRun:true};
  // Rescan immediately before each unlink; never follow a replaced file or directory.
  for(const name of plan.remove) {
    const current=retentionPlan(root,policy);
    if(!current.remove.includes(name))throw new Error('Recovery inventory changed during retention');
    regular(root,name);regular(root,name+'.json');
    fs.unlinkSync(path.join(root,name+'.json'));
    fs.unlinkSync(path.join(root,name));
  }
  return {...plan,dryRun:false};
}
module.exports={trustedDirectory,regular,retentionPlan,applyRetention};
if(require.main===module) {
  try {
    const [directory,mode,...extra]=process.argv.slice(2);
    if(extra.length||!directory||!['--dry-run','--apply'].includes(mode))throw new Error('Usage: node windows-backup-retention.js <absolute-recovery-directory> <--dry-run|--apply>');
    console.log(JSON.stringify(applyRetention(directory,{dryRun:mode!=='--apply'})));
  }catch {console.error('Retention stopped; inspect recovery inventory');process.exitCode=1;}
}

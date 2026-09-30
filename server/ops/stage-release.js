// Explicit source packaging only: no deploy, provider calls, database or app import.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const trees=['analysis','discovery','evidence','migrations','models','ops','publication','retrieval','routes'];
const required=['index.js','bootstrap.js','config.js','package.json','package-lock.json','.dockerignore',
  'models/prices.json','evidence/html-parser-worker.mjs','evidence/native/parser-sandbox.c','ops/Dockerfile.railway',
  'analysis/worker.js','publication/local-export.js','publication/outbox.js','ops/work-admission.js',
  'ops/build-release-image.js'];
const hostOnly=new Set(['backup-railway-to-windows.js','windows-recovery.js',
  'windows-backup-retention.js','windows-backup-state.js','windows-backup-schedule.js',
  'rehearse-encrypted-restore.js']);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const compare=(a,b)=>a<b?-1:a>b?1:0;
const absolute=value=>{
  if(typeof value!=='string'||!path.isAbsolute(value))throw new Error('Absolute release paths required');
  return path.resolve(value);
};
function directory(target) {
  const entry=fs.lstatSync(target);
  if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Release directory must not be a link');
}
function read(target,maxSize=4*1024*1024) {
  const before=fs.lstatSync(target);
  if(!before.isFile()||before.nlink!==1||before.size>maxSize)throw new Error('Release input must be a bounded single-link file');
  const fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const opened=fs.fstatSync(fd);
    if(opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==before.size||!opened.isFile()||opened.nlink!==1)
      throw new Error('Release input changed while opening');
    const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
    if(bytes.length!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)
      throw new Error('Release input changed while reading');
    return bytes;
  }finally{fs.closeSync(fd);}
}
function walk(root,visit,relative='',depth=0,state={entries:0}) {
  if(depth>12||++state.entries>1500)throw new Error('Release tree exceeds limits');
  directory(path.join(root,relative));
  for(const name of fs.readdirSync(path.join(root,relative)).sort(compare)) {
    if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Error('Invalid release filename');
    const child=relative?`${relative}/${name}`:name,target=path.join(root,child),entry=fs.lstatSync(target);
    if(entry.isSymbolicLink())throw new Error('Release links forbidden');
    if(entry.isDirectory()){visit(child,null);walk(root,visit,child,depth+1,state);}
    else visit(child,read(target));
  }
}
function stageRelease({source,destination}) {
  const input=absolute(source),output=absolute(destination);
  directory(input);directory(path.dirname(output));
  const canonicalInput=fs.realpathSync(input),canonicalOutput=path.join(fs.realpathSync(path.dirname(output)),path.basename(output));
  const overlaps=(a,b)=>{const r=path.relative(a,b);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
  if(overlaps(canonicalInput,canonicalOutput)||overlaps(canonicalOutput,canonicalInput))throw new Error('Release paths overlap');
  if(fs.existsSync(output))throw new Error('Release output already exists');
  const inputs=new Map();let total=0;
  function add(relative,bytes) {
    if(bytes===null)return;
    const name=path.posix.basename(relative);
    // Host recovery tools can open encrypted artifacts, keys, and remote shells.
    if(hostOnly.has(name)) {
      if(relative!==`ops/${name}`)throw new Error('Host recovery tool placement changed');
      return;
    }
    if(!/\.(js|mjs|json|c|md)$/.test(name)&&!['.dockerignore','Dockerfile.railway'].includes(name))
      throw new Error('Disallowed release file');
    if(/(^\.env|credentials|secrets|private[-_.]?key|id_rsa)/i.test(name))throw new Error('Disallowed private filename');
    total+=bytes.length;if(total>32*1024*1024||inputs.size>=1000)throw new Error('Release input exceeds limits');
    inputs.set(`server/${relative}`,bytes);
  }
  for(const name of fs.readdirSync(input).sort(compare)) {
    if(name.endsWith('.js')||['package.json','package-lock.json','.dockerignore'].includes(name))add(name,read(path.join(input,name)));
  }
  for(const tree of trees)walk(input,(relative,bytes)=>add(relative,bytes),tree);
  for(const file of required)if(!inputs.has(`server/${file}`))throw new Error(`Missing required release input: ${file}`);
  const files=[...inputs].sort(([a],[b])=>compare(a,b)).map(([name,bytes])=>({path:name,size:bytes.length,sha256:hash(bytes)}));
  const manifestBytes=Buffer.from(JSON.stringify({schemaVersion:1,target:'railway-docker',files},null,2)+'\n');
  // Exclusive output: never overwrite or remove a pre-existing release. A failed
  // partial write is retained without a complete manifest for operator inspection.
  fs.mkdirSync(output,{mode:0o700});
  for(const file of files) {
    const target=path.join(output,file.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});
    // COPY makes image files root-owned. Source code must remain readable by
    // USER node on Linux, even when the staging process has a private umask.
    for(let dir=path.dirname(target);dir!==output;dir=path.dirname(dir))fs.chmodSync(dir,0o755);
    fs.writeFileSync(target,inputs.get(file.path),{flag:'wx',mode:0o644});fs.chmodSync(target,0o644);
  }
  fs.writeFileSync(path.join(output,'release-manifest.json'),manifestBytes,{flag:'wx',mode:0o600});
  // Keep the exact duplicate for existing release tooling; both are verified.
  fs.writeFileSync(path.join(output,'server','release-manifest.json'),manifestBytes,{flag:'wx',mode:0o644});
  const manifestSha256=hash(manifestBytes);
  verifyRelease({directory:output,expectedSha256:manifestSha256});
  return {directory:output,manifestSha256,files:files.length,bytes:total};
}
function verifyRelease({directory:releaseDirectory,expectedSha256}) {
  const root=absolute(releaseDirectory);directory(root);
  if(typeof expectedSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256))throw new Error('Pinned release digest required');
  const manifestBytes=read(path.join(root,'release-manifest.json'),1024*1024);
  if(hash(manifestBytes)!==expectedSha256)throw new Error('Release manifest changed');
  if(!read(path.join(root,'server','release-manifest.json'),1024*1024).equals(manifestBytes))
    throw new Error('Release context manifest differs');
  const manifest=JSON.parse(manifestBytes);
  if(manifest.schemaVersion!==1||manifest.target!=='railway-docker'||!Array.isArray(manifest.files)||manifest.files.length>1000)
    throw new Error('Unsupported release manifest');
  const expected=new Map(),directories=new Set();let total=0;
  for(const file of manifest.files) {
    if(!file||typeof file.path!=='string'||!file.path.startsWith('server/')||
      !file.path.split('/').every(p=>/^[a-zA-Z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..')||
      expected.has(file.path)||!Number.isSafeInteger(file.size)||file.size<0||file.size>4*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error('Invalid release inventory');
    total+=file.size;if(total>32*1024*1024)throw new Error('Release exceeds limits');
    expected.set(file.path,file);
    for(let p=path.posix.dirname(file.path);p!=='.';p=path.posix.dirname(p))directories.add(p);
  }
  for(const file of required)if(!expected.has(`server/${file}`))throw new Error('Missing required release input');
  walk(root,(name,bytes)=>{
    if(bytes===null){if(!directories.has(name))throw new Error('Unexpected release directory');return;}
    if(name==='release-manifest.json'||name==='server/release-manifest.json')return;
    const file=expected.get(name);
    if(!file||file.size!==bytes.length||file.sha256!==hash(bytes))throw new Error('Release inventory changed');
    expected.delete(name);
  });
  if(expected.size)throw new Error('Release inventory missing files');
  return {verified:true,manifestSha256:expectedSha256,files:manifest.files.length};
}
module.exports={stageRelease,verifyRelease};
if(require.main===module) {
  try {
    const [command,first,second,...extra]=process.argv.slice(2);
    if(extra.length||!first||!second||!['stage','verify'].includes(command))throw new Error('Usage: stage-release stage <server-source> <new-output> OR verify <output> <pinned-sha256>');
    console.log(JSON.stringify(command==='stage'?stageRelease({source:first,destination:second}):verifyRelease({directory:first,expectedSha256:second})));
  }catch(error){console.error('Release rejected:',error.message);process.exitCode=1;}
}

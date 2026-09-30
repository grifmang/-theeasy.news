// Windows operator tool. A rehearsal never mutates the encrypted artifact or a live DB.
// Usage: node rehearse-encrypted-restore.js <absolute.db.age> <artifact-sha256>
//   <immutable-image-id> <release-manifest-sha256> <absolute-docker.exe>
//   <absolute-age.exe> <absolute-pwsh.exe>
// The probe is passed as code, not mounted from the host. Only decrypted SQLite
// bytes cross stdin; no host path, socket, key, or credential enters the container.
// Residuals: DPAPI protects only against another Windows user/profile; same-user
// processes can request unprotect. Base64 conversion creates immutable JS strings,
// and OS swap/crash dumps may retain key or plaintext despite Buffer wiping.
// service.stop proves child service shutdown; it does not prove production PID1
// signal handling, volume permissions, or an off-host recovery point. SIGKILL,
// host power loss, or a compromised/unavailable Docker daemon can prevent the
// host watchdog and final absence check from completing.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');

const MAX_DB=32*1024*1024, MAX_AGE=40*1024*1024;
const PIPE='npipe:////./pipe/dockerDesktopLinuxEngine';
const HEX=/^[a-f0-9]{64}$/;
const IMAGE=/^sha256:[a-f0-9]{64}$/;
const HEADER=Buffer.from('SQLite format 3\0');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=message=>{throw new Error(message);};

// Single JSON line is the entire probe protocol. Errors and SQLite diagnostics
// are intentionally discarded, including when a probe fails.
const PROBE=String.raw`
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),http=require('node:http');
const path=require('node:path'),util=require('node:util');
const Database=require('/app/node_modules/better-sqlite3');
const root='/restore',source=root+'/source.db',copy=root+'/migrated.db';
const max=33554432,identityTables=['users','user_roles','google_identities','auth_sessions','role_change_events'];
let chunks=[],size=0,service,sourceDb,copyDb,plain;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const hashFile=file=>{const b=fs.readFileSync(file);try{return hash(b);}finally{b.fill(0);}};
const assert=(v)=>{if(!v)throw Error('probe rejected');};
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
const counts=db=>Object.fromEntries(identityTables.map(t=>[t,db.prepare('SELECT COUNT(*) n FROM "'+t+'"').get().n]));
const rows=db=>Object.fromEntries(identityTables.map(t=>[t,db.prepare('SELECT * FROM "'+t+'" ORDER BY rowid').all()]));
const check=db=>{assert(db.pragma('integrity_check',{simple:true})==='ok');assert(db.pragma('foreign_key_check').length===0);};
const request=p=>new Promise((resolve,reject)=>{
  const req=http.get({hostname:'127.0.0.1',port:41739,path:p,timeout:3000},r=>{
    let body='';r.on('data',b=>{body+=b;if(body.length>256){req.destroy();reject(Error('oversize'));}});
    r.on('end',()=>resolve([r.statusCode,body]));
  });req.on('timeout',()=>req.destroy(Error('timeout')));req.on('error',reject);
});
const limits=()=>{
  const read=p=>fs.readFileSync(p,'utf8').trim();
  assert(process.getuid()===1000&&process.getgid()===1000);
  assert(read('/sys/fs/cgroup/memory.max')==='536870912');
  assert(read('/sys/fs/cgroup/memory.swap.max')==='0');
  assert(read('/sys/fs/cgroup/pids.max')==='64');
  const [quota,period]=read('/sys/fs/cgroup/cpu.max').split(' ').map(Number);
  assert(quota>0&&period>0&&quota<=period);
  assert(fs.readdirSync('/sys/class/net').join(',')==='lo');
  const status=read('/proc/self/status');
  assert(/^CapEff:\s*0+$/m.test(status)&&/^NoNewPrivs:\s*1$/m.test(status));
  assert(/^Max core file size\s+0\s+0\s+bytes\s*$/m.test(read('/proc/self/limits')));
  const mounts=read('/proc/mounts').split('\n');
  assert(mounts.some(line=>/^tmpfs \/restore tmpfs /.test(line)&&line.includes('nosuid')&&line.includes('nodev')&&line.includes('noexec')));
  assert(mounts.some(line=>/^overlay \/ overlay /.test(line)&&line.includes('ro,')));
};
const deadline=setTimeout(()=>process.exit(91),45000);
(async()=>{
  try {
    limits();
    if(process.env.EASY_NEWS_RESTORE_TEST_BLOCK==='1')await new Promise(()=>{});
    for await(const chunk of process.stdin){size+=chunk.length;assert(size<=max);chunks.push(chunk);}
    plain=Buffer.concat(chunks,size);for(const c of chunks)c.fill(0);chunks=[];
    assert(size>=100&&plain.subarray(0,16).equals(Buffer.from('SQLite format 3\0')));
    const beforeHash=hash(plain);
    fs.writeFileSync(source,plain,{flag:'wx',mode:0o600});plain.fill(0);plain=null;
    assert((fs.statSync(source).mode&0o777)===0o600);
    sourceDb=new Database(source,{readonly:true,fileMustExist:true});sourceDb.pragma('query_only = ON');
    check(sourceDb);
    const versions=sourceDb.prepare('SELECT version FROM rebuild_migrations ORDER BY version').all().map(r=>r.version);
    assert(versions.length===21&&versions.every((v,i)=>v===i+1));
    const beforeCounts=counts(sourceDb),beforeRows=rows(sourceDb);
    for(const t of ['original_objects','document_originals'])assert(sourceDb.prepare('SELECT COUNT(*) n FROM "'+t+'"').get().n===0);
    sourceDb.close();sourceDb=null;
    fs.copyFileSync(source,copy,fs.constants.COPYFILE_EXCL);fs.chmodSync(copy,0o600);
    copyDb=new Database(copy,{fileMustExist:true});
    require('/app/storage').migrate(copyDb);require('/app/legacy-schema').migrateLegacy(copyDb);
    check(copyDb);
    const version=copyDb.prepare('SELECT MAX(version) v FROM rebuild_migrations').get().v;
    assert(version===33);
    const afterCounts=counts(copyDb),afterRows=rows(copyDb);
    const preserved=identityTables.every(t=>beforeCounts[t]===afterCounts[t]&&util.isDeepStrictEqual(beforeRows[t],afterRows[t]));
    assert(preserved);
    copyDb.close();copyDb=null;
    assert(hashFile(source)===beforeHash);
    assert(fs.readdirSync(root).sort().join(',')==='migrated.db,source.db');
    const env={NODE_ENV:'production',DEPLOYMENT_ENV:'production',DB_PATH:copy,HOST:'127.0.0.1',PORT:'41739',
      GENERATION_ENABLED:'false',INGESTION_ENABLED:'false',MAINTENANCE_MODE:'false',
      HTML_EXTRACTION_ENABLED:'false',PDF_EXTRACTION_ENABLED:'false',CLASSIFICATION_ENABLED:'false',
      ANALYSIS_VERIFICATION_ENABLED:'false',PUBLICATION_EXPORT_ENABLED:'false',AUTO_PUBLISH_ENABLED:'false',
      DAILY_BUDGET_MICROS:'0',MONTHLY_BUDGET_MICROS:'0',CLASSIFICATION_DAILY_BUDGET_MICROS:'0',
      CLASSIFICATION_MONTHLY_BUDGET_MICROS:'0',REASONING_BUDGET_MICROS:'0',TOOL_BUDGET_MICROS:'0'};
    service=await require('/app/bootstrap').startService(env);
    const live=await request('/health/live'),ready=await request('/health/ready');
    assert(live[0]===200&&JSON.parse(live[1]).status==='live');
    assert(ready[0]===200&&JSON.parse(ready[1]).status==='ready');
    await service.stop();assert(!service.server.listening&&!service.db.open);service=null;
    assert(hashFile(source)===beforeHash);
    assert(fs.readdirSync(root).sort().join(',')==='migrated.db,source.db');
    const report={ok:true,schemaBefore:21,schemaAfter:33,integrity:true,foreignKeys:true,
      zeroOriginals:true,sourcePreserved:true,identityPreserved:true,counts:afterCounts,
      healthLive:true,healthReady:true,serviceStopped:true,resourceLimits:true};
    process.stdout.write(JSON.stringify(report)+'\n');
  } catch {process.exitCode=1;}
  finally {clearTimeout(deadline);try{await service?.stop();}catch{}try{copyDb?.close();}catch{}
    try{sourceDb?.close();}catch{}plain?.fill(0);for(const c of chunks)c.fill(0);}
})().catch(()=>{process.exitCode=1;});
`;

function absoluteFile(value,label) {
  if(typeof value!=='string'||!path.win32.isAbsolute(value)||value.includes('\0')||value.startsWith('\\\\'))fail(`${label} must be an absolute local path`);
  const full=path.win32.resolve(value);
  if(full!==value)fail(`${label} must be canonical`);
  const parts=full.split(path.win32.sep),root=parts.shift()+'\\';
  let current=root;
  for(const part of parts){current=path.win32.join(current,part);const stat=fs.lstatSync(current);
    if(stat.isSymbolicLink()||stat.isReparsePoint?.())fail(`${label} contains a reparse point`);}
  const stat=fs.lstatSync(full);
  if(!stat.isFile()||stat.nlink!==1)fail(`${label} must be a regular single-link file`);
  const canonical=fs.realpathSync.native(full);
  if(!path.win32.isAbsolute(canonical)||canonical.startsWith('\\\\')||
    path.win32.basename(canonical).toLowerCase()!==path.win32.basename(full).toLowerCase())
    fail(`${label} resolved outside a local path`);
  return {full,canonical,stat};
}
function rejectReparsePoints(powershell,files) {
  // Node identifies symlinks/junctions; this also catches other Windows reparse
  // tags (for example cloud placeholders) on every path component.
  const paths=new Set();
  for(const file of files){
    let current=path.win32.resolve(file);
    while(current!==path.win32.dirname(current)){
      paths.add(current);current=path.win32.dirname(current);
    }
    paths.add(current);
  }
  const script="$ErrorActionPreference='Stop';$paths=[Console]::In.ReadToEnd()|ConvertFrom-Json;foreach($p in $paths){$i=Get-Item -LiteralPath $p -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){exit 2}}";
  const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',script],{
    input:JSON.stringify([...paths]),timeout:15000,maxBuffer:4096,windowsHide:true,encoding:null,
    env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:path.win32.dirname(powershell)}});
  result.stdout?.fill(0);result.stderr?.fill(0);
  if(result.error||result.status!==0||result.signal)fail('Recovery path contains a reparse point or could not be verified');
}
function readPinned(file,max,expected) {
  const {full,stat}=absoluteFile(file,'Artifact');
  if(stat.size<32||stat.size>max)fail('Encrypted artifact exceeds bounds');
  const fd=fs.openSync(full,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {const opened=fs.fstatSync(fd);if(opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size||opened.nlink!==1)fail('Artifact changed');
    const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
    if(bytes.length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||(expected&&sha(bytes)!==expected))fail('Artifact digest mismatch');
    return bytes;
  } finally {fs.closeSync(fd);}
}
function command(exe,args,{input,timeout=15000,maxBuffer=8192,env}={}) {
  const result=spawnSync(exe,args,{input,timeout,maxBuffer,env,windowsHide:true,encoding:null});
  if(result.error||result.status!==0||result.signal){result.stdout?.fill(0);result.stderr?.fill(0);fail('Rehearsal subprocess rejected');}
  result.stderr?.fill(0);
  return result.stdout;
}
function dockerEnv(){return {SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,
  PATH:path.win32.dirname(process.execPath),DOCKER_CONFIG:path.win32.join(os.tmpdir(),`easy-news-empty-docker-${crypto.randomUUID()}`)};}
function removeDockerConfig(directory) {
  const resolved=path.win32.resolve(directory),parent=path.win32.resolve(os.tmpdir());
  if(path.win32.dirname(resolved).toLowerCase()!==parent.toLowerCase()||
    !/^easy-news-empty-docker-[a-f0-9-]{36}$/.test(path.win32.basename(resolved)))fail('Invalid temporary Docker config path');
  fs.rmSync(resolved,{recursive:true,force:true});
}
function strictReport(bytes) {
  if(bytes.length>4096||!bytes.length)fail('Probe output invalid');
  const raw=bytes.toString('utf8');if(!/^\{[^\r\n]+\}\n$/.test(raw))fail('Probe output invalid');
  const obj=JSON.parse(raw);
  const keys=['ok','schemaBefore','schemaAfter','integrity','foreignKeys','zeroOriginals','sourcePreserved',
    'identityPreserved','counts','healthLive','healthReady','serviceStopped','resourceLimits'];
  if(Object.keys(obj).sort().join(',')!==keys.sort().join(',')||obj.ok!==true||obj.schemaBefore!==21||obj.schemaAfter!==33||
    ['integrity','foreignKeys','zeroOriginals','sourcePreserved','identityPreserved','healthLive','healthReady','serviceStopped','resourceLimits'].some(k=>obj[k]!==true))fail('Probe output invalid');
  const tableKeys=['users','user_roles','google_identities','auth_sessions','role_change_events'];
  if(!obj.counts||Object.keys(obj.counts).sort().join(',')!==tableKeys.sort().join(',')||
    tableKeys.some(k=>!Number.isSafeInteger(obj.counts[k])||obj.counts[k]<0))fail('Probe output invalid');
  return obj;
}
function verifyEngineAndImage({imageId,manifestSha256,docker}) {
  if(!IMAGE.test(imageId)||!HEX.test(manifestSha256))fail('Pinned image and label required');
  absoluteFile(docker,'docker.exe');
  const denv=dockerEnv(),dargs=args=>['--host',PIPE,...args];
  fs.mkdirSync(denv.DOCKER_CONFIG,{mode:0o700});
  try {
    const info=JSON.parse(command(docker,dargs(['info','--format','{{json .}}']),{env:denv,maxBuffer:65536}).toString('utf8'));
    if(info.OSType!=='linux'||!/^Docker Desktop/i.test(info.OperatingSystem||'')||info.SwapLimit!==true)fail('Local Docker Desktop Linux engine with swap control required');
    const actualId=command(docker,dargs(['image','inspect',imageId,'--format','{{.Id}}']),{env:denv}).toString('utf8').trim();
    const actualLabel=command(docker,dargs(['image','inspect',imageId,'--format','{{index .Config.Labels "org.easynews.release-manifest-sha256"}}']),{env:denv}).toString('utf8').trim();
    if(actualId!==imageId||actualLabel!==manifestSha256)fail('Image identity or release label mismatch');
    return denv;
  } catch(error) {removeDockerConfig(denv.DOCKER_CONFIG);throw error;}
}
function removeContainer(docker,denv,id,name) {
  for(const target of [id,name].filter(Boolean)){
    const result=spawnSync(docker,['--host',PIPE,'rm','-f',target],
      {timeout:10000,maxBuffer:4096,env:denv,windowsHide:true,encoding:null});
    result.stdout?.fill(0);result.stderr?.fill(0);
  }
  // rm may report "not found" after --rm; only successful list queries prove
  // absence. A failed rm is never treated as proof.
}
function confirmAbsent(docker,denv,id,name,testListFailure=false) {
  for(const filter of [id?`id=${id}`:null,`name=^/${name}$`].filter(Boolean)){
    const result=spawnSync(docker,['--host',PIPE,'container','ls','-a','--filter',filter,
      '--format','{{.ID}}'],{timeout:10000,maxBuffer:4096,env:denv,windowsHide:true,encoding:null});
    const absent=!testListFailure&&!result.error&&result.status===0&&!result.signal&&result.stdout?.toString('utf8').trim()==='';
    result.stdout?.fill(0);result.stderr?.fill(0);
    if(!absent)fail('Container cleanup unconfirmed');
  }
}
async function runProbe(plaintext,{imageId,docker,denv,testBlock=false,hostDeadlineMs=60000,
  cancelAfterMs=0,testListFailure=false,testNeverClose=false}) {
  const dargs=args=>['--host',PIPE,...args];
  const name='easy-news-restore-'+crypto.randomUUID();
  let report,id,child,closed=false,cancelled=false,hostTimer,cancelTimer,escalateTimer,settleTimer;
  const stdout=[];let stdoutSize=0,stderrSize=0;
  const clear=()=>{for(const b of stdout)b.fill(0);stdout.length=0;};
  let resolveClose;
  const close=new Promise(resolve=>{resolveClose=resolve;});
  const onClose=(code,signal)=>{if(testNeverClose)return;closed=true;resolveClose({code,signal,closed:true});};
  const cancel=()=>{
    if(cancelled)return;
    cancelled=true;
    child?.stdin?.destroy();
    try{child?.kill('SIGTERM');}catch{}
    // Host watchdog invokes removal even while SQLite or the Docker CLI is
    // stuck. A second removal runs after CLI termination to close create races.
    removeContainer(docker,denv,id,name);
    escalateTimer=setTimeout(()=>{if(!closed){try{child?.kill('SIGKILL');}catch{}}},2000);
    settleTimer=setTimeout(()=>{if(!closed)resolveClose({closed:false});},6000);
  };
  const onSignal=()=>cancel();
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  try {
    const args=dargs(['create','--rm','--pull','never','--name',name,'--network','none','--user','1000:1000',
      '--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--log-driver','none',
      '--ulimit','core=0','--memory','512m','--memory-swap','512m','--pids-limit','64','--cpus','1',
      '--tmpfs','/restore:rw,noexec,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=0700',
      ...(testBlock?['--env','EASY_NEWS_RESTORE_TEST_BLOCK=1']:[]),
      '-i',imageId,'node','-e',PROBE]);
    const created=command(docker,args,{env:denv,timeout:15000,maxBuffer:4096});
    try {const raw=created.toString('utf8');if(!/^[a-f0-9]{64}\r?\n$/.test(raw))fail('Container creation rejected');id=raw.trim();}
    finally {created.fill(0);}
    if(cancelled)fail('Rehearsal cancelled');
    child=spawn(docker,dargs(['start','--attach','--interactive',id]),
      {env:denv,windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.once('close',onClose);
    child.once('error',()=>cancel());
    child.stdout.on('data',chunk=>{
      stdoutSize+=chunk.length;
      if(stdoutSize>4096){chunk.fill(0);cancel();return;}
      stdout.push(chunk);
    });
    child.stderr.on('data',chunk=>{stderrSize+=chunk.length;chunk.fill(0);if(stderrSize>4096)cancel();});
    child.stdin.on('error',()=>cancel());
    try {child.stdin.end(plaintext);}catch{cancel();}
    hostTimer=setTimeout(cancel,hostDeadlineMs);
    if(cancelAfterMs)cancelTimer=setTimeout(cancel,cancelAfterMs);
    const result=await close;
    if(cancelled||!result.closed||result.code!==0||result.signal)fail('Isolated restore probe failed');
    const output=Buffer.concat(stdout,stdoutSize);
    try {report=strictReport(output);}finally{output.fill(0);}
  } finally {
    clearTimeout(hostTimer);clearTimeout(cancelTimer);clearTimeout(escalateTimer);clearTimeout(settleTimer);
    process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
    if(child&&!closed){try{child.kill('SIGKILL');}catch{}}
    if(child&&!closed){child.stdin?.destroy();child.stdout?.destroy();child.stderr?.destroy();child.unref();}
    clear();
    removeContainer(docker,denv,id,name);
    confirmAbsent(docker,denv,id,name,testListFailure); // synthetic daemon-failure injection
  }
  return report;
}
async function rehearse({artifact,artifactSha256,imageId,manifestSha256,docker,age,powershell}) {
  let stage='preflight';
  try {
  if(process.platform!=='win32')fail('Windows only');
  if(!HEX.test(artifactSha256)||!IMAGE.test(imageId)||!HEX.test(manifestSha256))fail('Pinned digests required');
  if(!/^easy-news-\d{4}-\d{2}-\d{2}T[0-9A-Za-z-]+\.db\.age$/.test(path.win32.basename(artifact)))fail('Unexpected artifact name');
  const trusted=path.win32.join(os.homedir(),'AppData','Local','EasyNews','recovery');
  if(path.win32.dirname(artifact).toLowerCase()!==trusted.toLowerCase())fail('Artifact outside trusted recovery directory');
  const dir=fs.lstatSync(trusted);
  if(!dir.isDirectory()||dir.isSymbolicLink()||dir.isReparsePoint?.())fail('Recovery directory is not trusted');
  let encrypted,protectedKey,key,plaintext,denv,cipherDirectory,cipherPath;
  try {
    const keyPath=path.win32.join(trusted,'identity.dpapi');
    const trustedCanonical=fs.realpathSync.native(trusted);
    const artifactFile=absoluteFile(artifact,'Artifact'),keyFile=absoluteFile(keyPath,'Recovery identity');
    if(path.win32.dirname(artifactFile.canonical).toLowerCase()!==trustedCanonical.toLowerCase()||
      path.win32.dirname(keyFile.canonical).toLowerCase()!==trustedCanonical.toLowerCase())
      fail('Recovery files resolved outside trusted directory');
    const resolved=[];
    for(const [binary,label] of [[docker,'docker.exe'],[age,'age.exe'],[powershell,'pwsh.exe']]){
      const file=absoluteFile(binary,label);resolved.push(file.canonical);
      if(path.win32.basename(binary).toLowerCase()!==label)fail('Unexpected executable');}
    rejectReparsePoints(powershell,[artifact,keyPath,docker,age,powershell,
      artifactFile.canonical,keyFile.canonical,...resolved]);
    encrypted=readPinned(artifact,MAX_AGE,artifactSha256);
    protectedKey=readPinned(keyPath,65536);
    stage='engine';
    denv=verifyEngineAndImage({imageId,manifestSha256,docker});
    stage='identity';
    const script="$ErrorActionPreference='Stop';$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$r=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($r))";
    const keyBase64=command(powershell,['-NoProfile','-NonInteractive','-Command',script],
      {input:protectedKey.toString('base64'),timeout:15000,maxBuffer:65536,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:path.win32.dirname(powershell)}});
    key=Buffer.from(keyBase64.toString('utf8').trim(),'base64');keyBase64.fill(0);
    if(key.length<20||key.length>8192||!key.toString('utf8').includes('AGE-SECRET-KEY-1'))fail('Invalid recovery identity');
    cipherDirectory=fs.mkdtempSync(path.win32.join(os.tmpdir(),'easy-news-restore-cipher-'));
    cipherPath=path.win32.join(cipherDirectory,'snapshot.age');
    fs.writeFileSync(cipherPath,encrypted,{flag:'wx',mode:0o600});
    stage='decrypt';
    plaintext=command(age,['--decrypt','-i','-',cipherPath],{input:key,timeout:30000,maxBuffer:MAX_DB+1,
      env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:path.win32.dirname(age)}});
    if(plaintext.length<100||plaintext.length>MAX_DB||!plaintext.subarray(0,16).equals(HEADER))fail('Decrypted SQLite header invalid');
    stage='container';
    return await runProbe(plaintext,{imageId,docker,denv});
  } finally {
    key?.fill(0);plaintext?.fill(0);protectedKey?.fill(0);encrypted?.fill(0);
    if(cipherDirectory){
      const resolved=path.win32.resolve(cipherDirectory),parent=path.win32.resolve(os.tmpdir());
      if(path.win32.dirname(resolved).toLowerCase()!==parent.toLowerCase()||
        !/^easy-news-restore-cipher-[a-zA-Z0-9_-]+$/.test(path.win32.basename(resolved)))fail('Invalid cipher scratch path');
      if(cipherPath&&fs.existsSync(cipherPath))fs.unlinkSync(cipherPath);
      fs.rmdirSync(resolved);
    }
    if(denv)removeDockerConfig(denv.DOCKER_CONFIG);
  }
  } catch(error) {
    if(!Object.hasOwn(error,'rehearsalStage'))Object.defineProperty(error,'rehearsalStage',{value:stage});
    throw error;
  }
}
// Test-only fixture has no path input and no DPAPI/age access. Intercept exactly
// migrations 022-033 while constructing a synthetic schema21 source in memory.
async function synthetic({imageId,manifestSha256,docker,corrupt=false,testBlock=false,
  hostDeadlineMs=60000,cancelAfterMs=0,testListFailure=false,testNeverClose=false}) {
  if(process.platform!=='win32')fail('Windows only');
  const denv=verifyEngineAndImage({imageId,manifestSha256,docker});
  try {
    const Database=require('better-sqlite3'),Module=require('node:module');
    const db=new Database(':memory:');let bytes;
    const originalLoad=Module._load;
    try {
      Module._load=function(request,parent,isMain){
        if(/^\.\/migrations\/(?:0(?:2[2-9]|3[0-3]))-/.test(request)&&parent?.filename===path.join(__dirname,'..','storage.js'))
          return new Proxy({}, {get:()=>()=>{}});
        return originalLoad.apply(this,arguments);
      };
      require('../storage').migrate(db);
    } finally {Module._load=originalLoad;}
    try {
      require('../legacy-schema').migrateLegacy(db);
      if(db.prepare('SELECT MAX(version) v FROM rebuild_migrations').get().v!==21)fail('Synthetic fixture construction failed');
      db.prepare('INSERT INTO users(id,username,password) VALUES(1,?,?)').run('synthetic-only-user','no-real-credential');
      db.prepare('INSERT INTO user_roles(user_id,role) VALUES(1,?)').run('editor');
      db.prepare('INSERT INTO google_identities(subject,user_id) VALUES(?,1)').run('synthetic-only-subject');
      db.prepare('INSERT INTO auth_sessions(token_hash,user_id,created_at,last_seen,expires_at,idle_expires_at) VALUES(?,1,1,1,100,100)').run('synthetic-only-token');
      db.prepare('INSERT INTO role_change_events(user_id,previous_role,new_role,operator,reason) VALUES(1,?,?,?,?)')
        .run('reader','editor','synthetic-only-operator','synthetic rehearsal');
      bytes=db.serialize();
      if(corrupt)bytes[0]=0; // test-only failure injection; no external input path
    } finally {db.close();}
    try {return await runProbe(bytes,{imageId,docker,denv,testBlock,hostDeadlineMs,cancelAfterMs,testListFailure,testNeverClose});}
    finally {bytes?.fill(0);}
  } finally {removeDockerConfig(denv.DOCKER_CONFIG);}
}
module.exports={rehearse,synthetic,strictReport};
if(require.main===module){
  (async()=>{try {
    if(['--synthetic','--synthetic-fail','--synthetic-cancel','--synthetic-timeout',
      '--synthetic-list-fail','--synthetic-never-close'].includes(process.argv[2])) {
      const [imageId,manifestSha256,docker,...extra]=process.argv.slice(3);
      if(extra.length||![imageId,manifestSha256,docker].every(Boolean))fail('Synthetic mode requires pinned image, label, docker.exe');
      const mode=process.argv[2];
      const result=await synthetic({imageId,manifestSha256,docker,corrupt:mode==='--synthetic-fail',
        testBlock:['--synthetic-cancel','--synthetic-timeout','--synthetic-never-close'].includes(mode),
        cancelAfterMs:['--synthetic-cancel','--synthetic-never-close'].includes(mode)?1000:0,
        hostDeadlineMs:mode==='--synthetic-timeout'?1200:60000,
        testListFailure:mode==='--synthetic-list-fail',testNeverClose:mode==='--synthetic-never-close'});
      process.stdout.write(JSON.stringify(result)+'\n');
      return;
    }
    const [artifact,artifactSha256,imageId,manifestSha256,docker,age,powershell,...extra]=process.argv.slice(2);
    if(extra.length||![artifact,artifactSha256,imageId,manifestSha256,docker,age,powershell].every(Boolean))fail('Seven exact arguments required');
    process.stdout.write(JSON.stringify(await rehearse({artifact,artifactSha256,imageId,manifestSha256,docker,age,powershell}))+'\n');
  } catch(error) {
    const stage=['preflight','engine','identity','decrypt','container'].includes(error?.rehearsalStage)?error.rehearsalStage:'unknown';
    process.stderr.write(`Restore rehearsal rejected at ${stage}; no private details printed.\n`);process.exitCode=1;}})();
}

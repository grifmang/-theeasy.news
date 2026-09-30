'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const TARGETS=new Set(['public_index','static_snapshot','cache','document_preview']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(code){throw Object.assign(new Error(`Private publication export ${code}`),{code});}
function inside(parent,child){return child===parent||child.startsWith(parent+path.sep);}
function privateDirectory(directory){
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||process.platform!=='win32'&&(stat.mode&0o077)!==0)
    fail('unsafe_root');
}
function directorySync(directory){
  const fd=fs.openSync(directory,'r');
  try{fs.fsyncSync(fd);}catch(error){
    if(process.platform==='linux'||!['EINVAL','ENOTSUP','EISDIR','EPERM'].includes(error.code))
      fail('directory_sync_failed');
  }
  finally{fs.closeSync(fd);}
}
function readFile(filename,max,code,allowLinked=false){
  const stat=fs.lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||
    (allowLinked?stat.nlink<1||stat.nlink>2:stat.nlink!==1)||stat.size<1||stat.size>max)fail(code);
  return fs.readFileSync(filename);
}
function parseCanonical(bytes,code){
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail(code);}
  if(!value||!bytes.equals(Buffer.from(JSON.stringify(value))))fail(code);
  return value;
}
function createLocalPublicationExport(root,{dbPath,archivePath,budgetPath,frontendPath,buildPath}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof dbPath!=='string'||
    !path.isAbsolute(dbPath)||!fs.existsSync(dbPath))fail('invalid_root');
  privateDirectory(root);
  const base=fs.realpathSync(root),canonicalDb=fs.realpathSync(dbPath),
    dbStat=fs.statSync(canonicalDb,{bigint:true}),rootStat=fs.statSync(base,{bigint:true});
  if(!dbStat.isFile())fail('invalid_database');
  const identity={dbPathSha256:sha(Buffer.from(canonicalDb)),
    dbFileIdentity:`${dbStat.dev}:${dbStat.ino}`,rootPathSha256:sha(Buffer.from(base))};
  for(const candidate of [dbPath,archivePath,budgetPath,frontendPath,buildPath]){
    if(!candidate)continue;
    if(typeof candidate!=='string'||!path.isAbsolute(candidate))fail('invalid_overlap_path');
    const resolved=fs.existsSync(candidate)?fs.realpathSync(candidate):path.resolve(candidate);
    if(inside(base,resolved)||inside(resolved,base))fail('overlapping_root');
  }
  const marker=path.join(base,'.publication-sink.json'),lock=path.join(base,'.publication.lock');
  const recoveryLock=path.join(base,'.publication-lock-recovery');
  let lockFd=null,boundId=null;
  const preparedArtifacts=new Map();
  function checkedDirectory(directory){
    if(!fs.existsSync(directory)){fs.mkdirSync(directory,{mode:0o700});directorySync(path.dirname(directory));}
    privateDirectory(directory);
  }
  function writeImmutable(filename,bytes){
    const directory=path.dirname(filename),temporary=path.join(directory,`${randomUUID()}.pending`);
    const fd=fs.openSync(temporary,'wx',0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{
      try{fs.linkSync(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;}
      if(!readFile(filename,Math.max(bytes.length,1),'artifact_conflict',true).equals(bytes))fail('artifact_conflict');
      directorySync(directory);
    }finally{fs.unlinkSync(temporary);directorySync(directory);}
  }
  function writeHead(filename,bytes){
    const directory=path.dirname(filename),temporary=path.join(directory,`${randomUUID()}.pending`);
    const fd=fs.openSync(temporary,'wx',0o600);
    try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{fs.renameSync(temporary,filename);directorySync(directory);}
    finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  function markerBody(){
    if(!fs.existsSync(marker))fail('missing_sink_marker');
    const body=parseCanonical(readFile(marker,512,'sink_conflict'),'sink_conflict');
    if(Object.keys(body).sort().join(',')!==
      'dbFileIdentity,dbPathSha256,formatVersion,kind,rootPathSha256,sinkId'||
      body.kind!=='private_filesystem'||body.formatVersion!==2||
      body.dbPathSha256!==identity.dbPathSha256||body.dbFileIdentity!==identity.dbFileIdentity||
      body.rootPathSha256!==identity.rootPathSha256||
      !/^[0-9a-f-]{36}$/.test(body.sinkId))fail('sink_conflict');
    return body;
  }
  function release(){
    if(lockFd===null)return;
    const stat=fs.fstatSync(lockFd,{bigint:true}),current=fs.lstatSync(lock,{bigint:true});
    if(stat.dev!==current.dev||stat.ino!==current.ino)fail('sink_locked');
    fs.closeSync(lockFd);lockFd=null;fs.unlinkSync(lock);directorySync(base);
  }
  function assertLock(){
    if(lockFd===null||!fs.existsSync(lock))fail('sink_locked');
    const held=fs.fstatSync(lockFd,{bigint:true}),current=fs.lstatSync(lock,{bigint:true});
    if(held.dev!==current.dev||held.ino!==current.ino)fail('sink_locked');
  }
  // Read-only liveness check for public HTTP admission. A path with the same
  // name may be a different mount after startup, even while the lock FD lives.
  function assertBound(){
    assertLock();
    const current=fs.lstatSync(base,{bigint:true});
    if(!current.isDirectory()||current.isSymbolicLink()||
      current.dev!==rootStat.dev||current.ino!==rootStat.ino)fail('sink_conflict');
    const body=markerBody();
    if(boundId===null||body.sinkId!==boundId)fail('sink_conflict');
  }
  function acquireLock(){
    try{lockFd=fs.openSync(lock,'wx',0o600);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      try{fs.mkdirSync(recoveryLock,{mode:0o700});}catch{fail('sink_locked');}
      try{
        const before=fs.lstatSync(lock,{bigint:true});
        const owner=parseCanonical(readFile(lock,256,'sink_locked'),'sink_locked');
        if(!Number.isSafeInteger(owner.pid)||owner.pid<1||
          Object.keys(owner).sort().join(',')!=='pid,rootPathSha256'||
          owner.rootPathSha256!==identity.rootPathSha256)fail('sink_locked');
        try{process.kill(owner.pid,0);fail('sink_locked');}
        catch(check){if(check.code!=='ESRCH')throw check;}
        const after=fs.lstatSync(lock,{bigint:true});
        if(before.dev!==after.dev||before.ino!==after.ino)fail('sink_locked');
        fs.unlinkSync(lock);directorySync(base);
        lockFd=fs.openSync(lock,'wx',0o600);
      }finally{fs.rmdirSync(recoveryLock);directorySync(base);}
    }
    fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,rootPathSha256:identity.rootPathSha256}));
    fs.fsyncSync(lockFd);directorySync(base);
  }
  function bind(db,now=Date.now()){
    if(!Number.isSafeInteger(now)||now<0)fail('invalid_clock');
    if(lockFd!==null)fail('sink_locked');
    try{acquireLock();}catch(error){if(lockFd!==null){fs.closeSync(lockFd);lockFd=null;}
      throw error;}
    try{
      recoverPending(base,'marker',db);
      const row=db.prepare('SELECT * FROM publication_sinks WHERE singleton=1').get();
      if(row){
        const body=markerBody();
        if(body.sinkId!==row.sink_id||row.format_version!==2||
          row.db_path_sha256!==identity.dbPathSha256||row.db_file_identity!==identity.dbFileIdentity||
          row.root_path_sha256!==identity.rootPathSha256)fail('sink_conflict');
        boundId=row.sink_id;return boundId;
      }
      let body;
      if(fs.existsSync(marker)){
        body=markerBody();
        if(db.prepare('SELECT 1 FROM publication_delivery_receipts LIMIT 1').get()||
          fs.readdirSync(base).some(name=>name!=='.publication-sink.json'&&name!=='.publication.lock'))
          fail('unbound_sink_marker');
      }else{
        body={sinkId:randomUUID(),kind:'private_filesystem',formatVersion:2,...identity};
        writeImmutable(marker,Buffer.from(JSON.stringify(body)));
      }
      db.prepare(`INSERT INTO publication_sinks(singleton,sink_id,kind,format_version,
        db_path_sha256,db_file_identity,root_path_sha256,bound_at_ms)
        VALUES(1,?,'private_filesystem',2,?,?,?,?)`)
        .run(body.sinkId,identity.dbPathSha256,identity.dbFileIdentity,identity.rootPathSha256,now);
      boundId=body.sinkId;return boundId;
    }catch(error){release();throw error;}
  }
  function validateCommand(command){
    assertLock();
    const {sinkId,outboxId,taskId,target,claimId,generation,action,dtoSha256}=command??{};
    if(sinkId!==boundId||!Number.isSafeInteger(outboxId)||outboxId<1||
      !Number.isSafeInteger(taskId)||taskId<1||!TARGETS.has(target)||
      !Number.isSafeInteger(claimId)||claimId<1||!Number.isSafeInteger(generation)||generation<1||
      !['activate','invalidate'].includes(action)||
      (action==='activate'?!/^[a-f0-9]{64}$/.test(dtoSha256??''):dtoSha256!==null))fail('invalid_command');
  }
  function manifestFor(command){return {scope:'private_filesystem',formatVersion:2,
    sinkId:command.sinkId,outboxId:command.outboxId,taskId:command.taskId,
    target:command.target,claimId:command.claimId,generation:command.generation,
    action:command.action,dtoSha256:command.dtoSha256};}
  function readManifest(filename,target,claimId,generation){
    const bytes=readFile(filename,4096,'invalid_manifest'),manifest=parseCanonical(bytes,'invalid_manifest');
    if(Object.keys(manifest).sort().join(',')!==
      'action,claimId,dtoSha256,formatVersion,generation,outboxId,scope,sinkId,target,taskId'||
      manifest.scope!=='private_filesystem'||manifest.formatVersion!==2||
      manifest.sinkId!==boundId||manifest.target!==target||manifest.claimId!==claimId||
      manifest.generation!==generation)fail('invalid_manifest');
    validateCommand(manifest);return {manifest,hash:sha(bytes)};
  }
  function snapshotMatches(db,digest,bytes){
    return db.prepare('SELECT dto_json FROM publication_snapshots WHERE dto_sha256=?')
      .all(digest).some(row=>Buffer.from(row.dto_json,'utf8').equals(bytes));
  }
  function claimDirectory(target,claimId){
    const targetDir=path.join(base,target),directory=path.join(targetDir,`claim-${claimId}`);
    checkedDirectory(targetDir);checkedDirectory(directory);return directory;
  }
  function scan(target,claimId){
    assertLock();
    if(!TARGETS.has(target)||!Number.isSafeInteger(claimId)||claimId<1)fail('invalid_command');
    const directory=claimDirectory(target,claimId),headPath=path.join(directory,'head.json');
    if(!fs.existsSync(headPath))return {directory,generation:0,manifest:null};
    const head=parseCanonical(readFile(headPath,512,'invalid_head'),'invalid_head');
    if(Object.keys(head).sort().join(',')!=='generation,manifestSha256'||
      !Number.isSafeInteger(head.generation)||head.generation<1||
      !/^[a-f0-9]{64}$/.test(head.manifestSha256))fail('invalid_head');
    const found=readManifest(path.join(directory,`generation-${head.generation}.json`),
      target,claimId,head.generation);
    if(found.hash!==head.manifestSha256)fail('invalid_head');
    return {directory,generation:head.generation,manifest:found.manifest,manifestSha256:found.hash};
  }
  function proofPath(directory,generation){return path.join(directory,`installed-${generation}.json`);}
  function readProof(directory,generation,manifestSha256){
    const filename=proofPath(directory,generation);
    if(!fs.existsSync(filename))return false;
    const body=parseCanonical(readFile(filename,512,'reconciliation_required'),'reconciliation_required');
    if(Object.keys(body).sort().join(',')!=='installedGeneration,manifestSha256'||
      body.installedGeneration!==generation||body.manifestSha256!==manifestSha256)
      fail('reconciliation_required');
    return true;
  }
  function sealInstalled(directory,generation,manifestSha256){
    writeImmutable(proofPath(directory,generation),Buffer.from(JSON.stringify({
      installedGeneration:generation,manifestSha256})));
  }
  function inspectInstalled(command){
    validateCommand(command);markerBody();
    const state=scan(command.target,command.claimId);
    const filename=path.join(state.directory,`generation-${command.generation}.json`);
    if(!fs.existsSync(filename))return null;
    const found=readManifest(filename,command.target,command.claimId,command.generation);
    if(!Buffer.from(JSON.stringify(found.manifest)).equals(
      Buffer.from(JSON.stringify(manifestFor(command)))))fail('reconciliation_required');
    if(state.generation<command.generation)return null;
    let installed=readProof(state.directory,command.generation,found.hash);
    if(!installed&&state.generation===command.generation){
      sealInstalled(state.directory,command.generation,found.hash);installed=true;
    }
    if(!installed){
      // A higher durable head exists, and every transition seals its former
      // head first. This link was never installed and is safe to retire.
      fs.unlinkSync(filename);directorySync(state.directory);return null;
    }
    let artifactSize=null,objectIdentity=null;
    if(command.action==='activate'){
      const object=path.join(base,'objects',`${command.dtoSha256}.json`);
      const bytes=readFile(object,262144,'artifact_conflict');
      if(sha(bytes)!==command.dtoSha256)fail('artifact_conflict');
      const stat=fs.lstatSync(object);
      artifactSize=bytes.length;
      objectIdentity={dev:stat.dev,ino:stat.ino,mtimeMs:stat.mtimeMs,size:stat.size};
    }
    return {manifestSha256:found.hash,objectIdentity,result:{outcome:'replayed',
      appliedGeneration:command.generation,
      artifactSha256:command.action==='activate'?command.dtoSha256:null,
      artifactSize,manifestSha256:found.hash}};
  }
  function unpointedLink(command){
    validateCommand(command);
    const state=scan(command.target,command.claimId);
    if(state.generation>=command.generation)return false;
    const filename=path.join(state.directory,`generation-${command.generation}.json`);
    if(!fs.existsSync(filename))return false;
    const found=readManifest(filename,command.target,command.claimId,command.generation);
    if(JSON.stringify(found.manifest)!==JSON.stringify(manifestFor(command)))
      fail('reconciliation_required');
    return true;
  }
  function confirmInstalled(command,evidence){
    validateCommand(command);
    if(!evidence||typeof evidence.manifestSha256!=='string')fail('reconciliation_required');
    const state=scan(command.target,command.claimId);
    if(state.generation<command.generation||
      !readProof(state.directory,command.generation,evidence.manifestSha256))
      fail('reconciliation_required');
    const found=readManifest(path.join(state.directory,`generation-${command.generation}.json`),
      command.target,command.claimId,command.generation);
    if(found.hash!==evidence.manifestSha256||
      JSON.stringify(found.manifest)!==JSON.stringify(manifestFor(command)))fail('reconciliation_required');
    if(command.action==='activate'){
      const stat=fs.lstatSync(path.join(base,'objects',`${command.dtoSha256}.json`));
      const expected=evidence.objectIdentity;
      if(!expected||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
        stat.dev!==expected.dev||stat.ino!==expected.ino||
        stat.mtimeMs!==expected.mtimeMs||stat.size!==expected.size||
        evidence.result.artifactSize!==stat.size)fail('artifact_conflict');
    }
    return evidence.result;
  }
  function prepareArtifact(command,dtoJson,{signal}={}){
    validateCommand(command);if(signal?.aborted)fail('aborted');
    if(command.action!=='activate'||typeof dtoJson!=='string')fail('invalid_dto');
    const bytes=Buffer.from(dtoJson,'utf8');
    if(bytes.length<1||bytes.length>262144||sha(bytes)!==command.dtoSha256)fail('invalid_dto');
    const objects=path.join(base,'objects');checkedDirectory(objects);
    const filename=path.join(objects,`${command.dtoSha256}.json`);
    writeImmutable(filename,bytes);
    const stat=fs.lstatSync(filename);
    preparedArtifacts.set(command.taskId,{digest:command.dtoSha256,size:bytes.length,
      dev:stat.dev,ino:stat.ino,mtimeMs:stat.mtimeMs});
    return bytes.length;
  }
  function apply(command,dtoJson,{signal}={}){
    validateCommand(command);if(signal?.aborted)fail('aborted');markerBody();
    const state=scan(command.target,command.claimId);
    if(state.generation>command.generation)return {outcome:'superseded',
      appliedGeneration:state.generation,artifactSha256:null,artifactSize:null,manifestSha256:null};
    const manifestBytes=Buffer.from(JSON.stringify(manifestFor(command))),manifestHash=sha(manifestBytes);
    if(state.generation===command.generation&&state.manifestSha256!==manifestHash)fail('artifact_conflict');
    let artifactSize=null;
    if(command.action==='activate'){
      const prepared=preparedArtifacts.get(command.taskId);
      if(!prepared||prepared.digest!==command.dtoSha256||typeof dtoJson!=='string')fail('invalid_dto');
      const stat=fs.lstatSync(path.join(base,'objects',`${command.dtoSha256}.json`));
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.dev!==prepared.dev||
        stat.ino!==prepared.ino||stat.mtimeMs!==prepared.mtimeMs||stat.size!==prepared.size)
        fail('artifact_conflict');
      artifactSize=prepared.size;
    }else if(dtoJson!==null)fail('invalid_dto');
    if(signal?.aborted)fail('aborted');
    if(state.generation<command.generation){
      if(state.generation)sealInstalled(state.directory,state.generation,state.manifestSha256);
      writeImmutable(path.join(state.directory,`generation-${command.generation}.json`),manifestBytes);
      if(signal?.aborted)fail('aborted');
      writeHead(path.join(state.directory,'head.json'),
        Buffer.from(JSON.stringify({generation:command.generation,manifestSha256:manifestHash})));
    }
    sealInstalled(state.directory,command.generation,manifestHash);
    preparedArtifacts.delete(command.taskId);
    return {outcome:state.generation===command.generation?'replayed':'applied',
      appliedGeneration:command.generation,artifactSha256:command.action==='activate'?command.dtoSha256:null,
      artifactSize,manifestSha256:manifestHash};
  }
  function recoverPending(directory,kind,db){
    for(const entry of fs.readdirSync(directory)){
      if(!/^[0-9a-f-]{36}\.pending$/.test(entry))continue;
      const pending=path.join(directory,entry),bytes=readFile(pending,262144,'reconciliation_required',true);
      let destination;
      if(kind==='marker'){
        const body=parseCanonical(bytes,'reconciliation_required');
        if(body.kind!=='private_filesystem'||body.formatVersion!==2||
          body.dbPathSha256!==identity.dbPathSha256||body.dbFileIdentity!==identity.dbFileIdentity||
          body.rootPathSha256!==identity.rootPathSha256)fail('reconciliation_required');
        destination=marker;
        if(!fs.existsSync(destination)){
          fs.linkSync(pending,destination);directorySync(directory);
        }
      }else if(kind==='objects'){
        const digest=sha(bytes);
        if(!snapshotMatches(db,digest,bytes))
          fail('reconciliation_required');
        destination=path.join(directory,`${digest}.json`);
      }else{
        const body=parseCanonical(bytes,'reconciliation_required');
        if(body.scope==='private_filesystem'){
          validateCommand(body);
          const task=db.prepare('SELECT outbox_id,target,generation FROM publication_delivery_tasks WHERE id=?')
            .get(body.taskId);
          if(!task||task.outbox_id!==body.outboxId||task.target!==body.target||
            task.generation!==body.generation||directory!==path.join(base,body.target,`claim-${body.claimId}`))
            fail('reconciliation_required');
          destination=path.join(directory,`generation-${body.generation}.json`);
        }else if(Number.isSafeInteger(body.generation)&&body.generation>0&&
          /^[a-f0-9]{64}$/.test(body.manifestSha256)&&
          Object.keys(body).sort().join(',')==='generation,manifestSha256'){
          const match=/claim-([1-9]\d*)$/.exec(directory),target=path.basename(path.dirname(directory));
          if(!match||!TARGETS.has(target))fail('reconciliation_required');
          const found=readManifest(path.join(directory,`generation-${body.generation}.json`),
            target,Number(match[1]),body.generation);
          if(found.hash!==body.manifestSha256)fail('reconciliation_required');
          destination=path.join(directory,'head.json');
        }else if(Number.isSafeInteger(body.installedGeneration)&&body.installedGeneration>0&&
          /^[a-f0-9]{64}$/.test(body.manifestSha256)&&
          Object.keys(body).sort().join(',')==='installedGeneration,manifestSha256'){
          const match=/claim-([1-9]\d*)$/.exec(directory),target=path.basename(path.dirname(directory));
          if(!match||!TARGETS.has(target))fail('reconciliation_required');
          const found=readManifest(path.join(directory,`generation-${body.installedGeneration}.json`),
            target,Number(match[1]),body.installedGeneration);
          if(found.hash!==body.manifestSha256)fail('reconciliation_required');
          destination=proofPath(directory,body.installedGeneration);
        }else fail('reconciliation_required');
      }
      if(fs.existsSync(destination)&&!fs.readFileSync(destination).equals(bytes)){
        if(path.basename(destination)!=='head.json')fail('reconciliation_required');
        const current=parseCanonical(readFile(destination,512,'invalid_head'),'invalid_head');
        const proposed=parseCanonical(bytes,'reconciliation_required');
        if(current.generation<proposed.generation)fail('reconciliation_required');
      }
      fs.unlinkSync(pending);directorySync(directory);
    }
  }
  function inspectMax(db){
    assertLock();
    markerBody();
    for(const entry of fs.readdirSync(base))
      if(entry!=='.publication-sink.json'&&entry!=='.publication.lock'&&
        entry!=='objects'&&!TARGETS.has(entry))fail('unexpected_artifact');
    const objects=path.join(base,'objects');
    if(fs.existsSync(objects)){
      privateDirectory(objects);
      recoverPending(objects,'objects',db);
      for(const entry of fs.readdirSync(objects)){
        if(!/^[a-f0-9]{64}\.json$/.test(entry))fail('unexpected_artifact');
        const bytes=readFile(path.join(objects,entry),262144,'artifact_conflict');
        if(sha(bytes)!==entry.slice(0,64)||!snapshotMatches(db,entry.slice(0,64),bytes))
          fail('artifact_conflict');
      }
    }
    const seen=new Set();
    for(const target of TARGETS){
      const targetDir=path.join(base,target);if(!fs.existsSync(targetDir))continue;
      privateDirectory(targetDir);
      for(const claimEntry of fs.readdirSync(targetDir)){
        const match=/^claim-([1-9]\d*)$/.exec(claimEntry);
        if(!match||!Number.isSafeInteger(Number(match[1])))fail('unexpected_artifact');
        const claimId=Number(match[1]),directory=path.join(targetDir,claimEntry);
        privateDirectory(directory);
        recoverPending(directory,'claim',db);
        const state=scan(target,claimId);
        if(state.generation&&!readProof(directory,state.generation,state.manifestSha256))
          sealInstalled(directory,state.generation,state.manifestSha256);
        for(const entry of fs.readdirSync(directory)){
          if(entry==='head.json')continue;
          const proofMatch=/^installed-([1-9]\d*)\.json$/.exec(entry);
          if(proofMatch){
            const generation=Number(proofMatch[1]);
            if(!Number.isSafeInteger(generation)||generation>state.generation)
              fail('reconciliation_required');
            const found=readManifest(path.join(directory,`generation-${generation}.json`),
              target,claimId,generation);
            readProof(directory,generation,found.hash);
            continue;
          }
          const generationMatch=/^generation-([1-9]\d*)\.json$/.exec(entry);
          if(!generationMatch||!Number.isSafeInteger(Number(generationMatch[1])))
            fail('unexpected_artifact');
          const generation=Number(generationMatch[1]);
          const {manifest,hash}=readManifest(path.join(directory,entry),target,claimId,generation);
          const task=db.prepare(`SELECT t.*,o.claim_id,o.action,o.dto_sha256,o.generation AS outbox_generation
            FROM publication_delivery_tasks t JOIN publication_outbox o ON o.id=t.outbox_id
            WHERE t.id=?`).get(manifest.taskId);
          if(!task||task.outbox_id!==manifest.outboxId||task.target!==target||
            task.claim_id!==claimId||task.generation!==generation||
            task.outbox_generation!==generation||task.action!==manifest.action||
            task.dto_sha256!==manifest.dtoSha256)fail('reconciliation_required');
          const receipt=db.prepare('SELECT * FROM publication_delivery_receipts WHERE task_id=?')
            .get(manifest.taskId);
          const installed=readProof(directory,generation,hash);
          if(!installed&&generation<state.generation&&
            (!receipt||receipt.outcome==='superseded')){
            // Only a link with no install proof can be retired. A higher
            // durable head certifies that it was never the selected head.
            fs.unlinkSync(path.join(directory,entry));directorySync(directory);
            continue;
          }
          if(receipt){
            if(task.state!=='done'||receipt.outcome==='superseded'||
              !['applied','replayed'].includes(receipt.outcome)||
              receipt.outbox_id!==manifest.outboxId||receipt.sink_id!==boundId||
              receipt.target!==target||receipt.claim_id!==claimId||
              receipt.generation!==generation||receipt.action!==manifest.action||
              receipt.applied_generation!==generation||
              receipt.dto_sha256!==manifest.dtoSha256||receipt.manifest_sha256!==hash||
              receipt.artifact_sha256!==(manifest.action==='activate'?manifest.dtoSha256:null)||
              !installed)
              fail('reconciliation_required');
          }else if(!['pending','leased'].includes(task.state))fail('reconciliation_required');
          if(manifest.action==='activate'){
            const bytes=readFile(path.join(objects,`${manifest.dtoSha256}.json`),262144,'artifact_conflict');
            if(sha(bytes)!==manifest.dtoSha256||receipt&&receipt.artifact_size!==bytes.length)
              fail('artifact_conflict');
          }else if(receipt&&receipt.artifact_size!==null)fail('reconciliation_required');
          if(generation>state.generation&&receipt)fail('reconciliation_required');
          seen.add(manifest.taskId);
        }
        if(state.generation>(db.prepare(
          'SELECT generation FROM publication_manifest_heads WHERE claim_id=?').get(claimId)?.generation??0))
          fail('reconciliation_required');
      }
    }
    for(const receipt of db.prepare(`SELECT r.*,t.state,t.outbox_id AS task_outbox_id,
      t.target AS task_target,t.generation AS task_generation,o.claim_id AS outbox_claim_id,
      o.generation AS outbox_generation,o.action AS outbox_action,o.dto_sha256 AS outbox_dto_sha256
      FROM publication_delivery_receipts r
      JOIN publication_delivery_tasks t ON t.id=r.task_id
      JOIN publication_outbox o ON o.id=t.outbox_id`).iterate()){
      if(receipt.state!=='done'||receipt.sink_id!==boundId||
        receipt.outbox_id!==receipt.task_outbox_id||receipt.target!==receipt.task_target||
        receipt.generation!==receipt.task_generation||
        receipt.claim_id!==receipt.outbox_claim_id||
        receipt.generation!==receipt.outbox_generation||
        receipt.action!==receipt.outbox_action||
        receipt.dto_sha256!==receipt.outbox_dto_sha256)fail('reconciliation_required');
      if(receipt.outcome==='superseded'){
        if(seen.has(receipt.task_id)||receipt.manifest_sha256!==null||
          receipt.artifact_sha256!==null||receipt.artifact_size!==null||
          receipt.applied_generation!==null&&receipt.applied_generation<=receipt.generation)
          fail('reconciliation_required');
      }else if(!seen.has(receipt.task_id))fail('reconciliation_required');
    }
  }
  return {bind,release,assertBound,apply,prepareArtifact,inspectInstalled,confirmInstalled,unpointedLink,
    discardPrepared:taskId=>preparedArtifacts.delete(taskId),scan,inspectMax};
}
module.exports={createLocalPublicationExport,TARGETS};

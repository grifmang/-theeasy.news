// Build-time packaging only. Does not download, compile, execute or enable a parser.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

function createParserBundle({destination,nodeExecutable,launcherExecutable}) {
  if(typeof destination!=='string'||!path.isAbsolute(destination)) throw new Error('Bundle destination must be absolute');
  if(!path.isAbsolute(nodeExecutable||'')||!path.isAbsolute(launcherExecutable||'')) throw new Error('Binary inputs must be absolute');
  const root=path.resolve(destination);
  // Must be new: an existing directory is neither overwritten nor cleaned up.
  fs.mkdirSync(root,{mode:0o700});
  const files=[];let total=0,visited=0;
  function write(relative,bytes,executable=false) {
    total+=bytes.length;
    if(total>300*1024*1024||files.length>=2000) throw new Error('Parser bundle exceeds build limits');
    const target=path.join(root,relative);
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.writeFileSync(target,bytes,{flag:'wx',mode:executable?0o555:0o444});
    files.push({path:relative.split(path.sep).join('/'),size:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex'),executable});
  }
  function copy(source,relative,executable=false) {
    const before=fs.lstatSync(source);
    if(!before.isFile()||before.nlink!==1||before.size>256*1024*1024) throw new Error('Bundle input must be a bounded regular single-link file');
    const fd=fs.openSync(source,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    try {
      const opened=fs.fstatSync(fd);
      if(!opened.isFile()||opened.nlink!==1||opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==before.size)
        throw new Error('Bundle input changed while opening');
      const bytes=fs.readFileSync(fd);
      const after=fs.fstatSync(fd);
      if(bytes.length!==opened.size||after.mtimeMs!==opened.mtimeMs||after.size!==opened.size) throw new Error('Bundle input changed while reading');
      write(relative,bytes,executable);
    } finally {fs.closeSync(fd);}
  }
  function copyTree(source,relative,depth=0) {
    if(depth>16||++visited>2500) throw new Error('Parser bundle tree exceeds build limits');
    const info=fs.lstatSync(source);
    if(!info.isDirectory()||info.isSymbolicLink()) throw new Error('Bundle directory must not be a link');
    for(const name of fs.readdirSync(source).sort()) {
      const input=path.join(source,name),output=path.join(relative,name);
      const entry=fs.lstatSync(input);
      if(entry.isDirectory()) copyTree(input,output,depth+1); else copy(input,output);
    }
  }
  try {
    const server=path.resolve(__dirname,'../..');
    const parse5=path.join(server,'node_modules/parse5');
    const nested=path.join(parse5,'node_modules/entities');
    const entities=fs.existsSync(nested)?nested:path.join(server,'node_modules/entities');
    for(const [name,version,source] of [['parse5','8.0.1',parse5],['entities','8.1.0',entities]]) {
      if(!fs.lstatSync(source).isDirectory()) throw new Error('Parser dependency root must not be a link');
      const metadata=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
      if(metadata.name!==name||metadata.version!==version) throw new Error('Parser dependency version differs from verified runtime');
      copy(path.join(source,'package.json'),`runtime/node_modules/${name}/package.json`);
      copyTree(path.join(source,'dist'),`runtime/node_modules/${name}/dist`);
      // Preserve attribution alongside the exact distribution files.
      const license=['LICENSE','LICENSE.txt','LICENSE.md'].find(file=>fs.existsSync(path.join(source,file)));
      if(!license) throw new Error('Parser dependency license missing');
      copy(path.join(source,license),`runtime/node_modules/${name}/${license}`);
    }
    copy(nodeExecutable,'runtime/node',true);
    copy(launcherExecutable,'launcher',true);
    copy(path.join(__dirname,'../html-parser-worker.mjs'),'runtime/html-parser-worker.mjs');
    write('runtime/package.json',Buffer.from('{"type":"module"}\n'));
    write('runtime/openssl.cnf',Buffer.alloc(0));
    files.sort((a,b)=>a.path.localeCompare(b.path));
    const manifest={schemaVersion:1,requiredNodeVersion:'22.23.1',requiredPlatform:'linux',requiredArchitecture:'x64',
      packages:{parse5:'8.0.1',entities:'8.1.0'},files};
    fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o444});
    return manifest;
  } catch(error) {
    // Only the new directory successfully created by this invocation is removed.
    fs.rmSync(root,{recursive:true,force:true});
    throw error;
  }
}
// Integrity check only: the caller must pin the digest outside this bundle and
// keep its deployment-owned directory immutable between verification and use.
// This does not authenticate a build, prove kernel enforcement, or execute code.
function verifyParserBundle({directory,expectedManifestSha256}) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)) throw new Error('Bundle directory must be absolute');
  if(typeof expectedManifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) throw new Error('External manifest digest required');
  const root=path.resolve(directory);
  const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  function readRegular(target,maxSize) {
    const before=fs.lstatSync(target);
    if(!before.isFile()||before.nlink!==1||before.size>maxSize) throw new Error('Bundle file must be bounded regular single-link');
    const fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
    try {
      const opened=fs.fstatSync(fd);
      if(!opened.isFile()||opened.nlink!==1||opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==before.size)
        throw new Error('Bundle file changed while opening');
      const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
      if(bytes.length!==opened.size||after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)
        throw new Error('Bundle file changed while reading');
      return bytes;
    } finally {fs.closeSync(fd);}
  }
  if(!fs.lstatSync(root).isDirectory()) throw new Error('Bundle root must be a real directory');
  const manifestBytes=readRegular(path.join(root,'manifest.json'),1024*1024);
  if(digest(manifestBytes)!==expectedManifestSha256) throw new Error('Bundle manifest integrity mismatch');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  if(manifest.schemaVersion!==1||manifest.requiredNodeVersion!=='22.23.1'||manifest.requiredPlatform!=='linux'||
    manifest.requiredArchitecture!=='x64'||manifest.packages?.parse5!=='8.0.1'||manifest.packages?.entities!=='8.1.0'||
    !Array.isArray(manifest.files)||manifest.files.length>2000) throw new Error('Unsupported bundle manifest');
  const expected=new Map();let total=0;
  for(const file of manifest.files) {
    if(!file||typeof file.path!=='string'||!file.path.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..')||
      file.path==='manifest.json'||expected.has(file.path)||!Number.isSafeInteger(file.size)||file.size<0||file.size>256*1024*1024||
      !/^[a-f0-9]{64}$/.test(file.sha256)||typeof file.executable!=='boolean') throw new Error('Invalid bundle manifest entry');
    total+=file.size;if(total>300*1024*1024) throw new Error('Bundle exceeds verification limits');
    expected.set(file.path,file);
  }
  for(const required of ['launcher','runtime/node','runtime/html-parser-worker.mjs','runtime/openssl.cnf','runtime/package.json',
    'runtime/node_modules/parse5/package.json','runtime/node_modules/entities/package.json']) {
    if(!expected.has(required)) throw new Error('Incomplete bundle manifest');
  }
  let visited=0;
  function walk(relative='',depth=0) {
    if(depth>16||++visited>2500) throw new Error('Bundle tree exceeds verification limits');
    const target=path.join(root,relative);
    if(!fs.lstatSync(target).isDirectory()) throw new Error('Bundle directory must not be a link');
    for(const name of fs.readdirSync(target)) {
      const child=relative?`${relative}/${name}`:name,absolute=path.join(root,child);
      if(fs.lstatSync(absolute).isDirectory()) {walk(child,depth+1);continue;}
      if(child==='manifest.json') continue;
      const entry=expected.get(child);
      if(!entry) throw new Error('Bundle inventory mismatch');
      const bytes=readRegular(absolute,entry.size);
      if(bytes.length!==entry.size||digest(bytes)!==entry.sha256) throw new Error('Bundle file integrity mismatch');
      expected.delete(child);
    }
  }
  walk();
  if(expected.size) throw new Error('Bundle inventory missing files');
  return {launcher:path.join(root,'launcher'),runtime:path.join(root,'runtime'),
    node:path.join(root,'runtime/node'),worker:path.join(root,'runtime/html-parser-worker.mjs')};
}
module.exports={createParserBundle,verifyParserBundle};

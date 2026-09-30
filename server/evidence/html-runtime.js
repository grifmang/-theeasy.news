const fs=require('fs');
const path=require('path');
const {verifyParserBundle}=require('./native/parser-bundle');
const {extractHtml}=require('./extract-html');

// Startup/release validation of an operator-installed runtime, not a request API.
// Root owns the installation; the service cannot chmod or replace its contents.
async function loadHtmlRuntime({bundleDirectory,digestFile,scratchParent}) {
  if(process.platform!=='linux'||process.arch!=='x64'||process.getuid()===0||process.geteuid()===0)
    throw new Error('HTML runtime requires a non-root Linux x64 service');
  const status=fs.readFileSync('/proc/self/status','utf8');
  for(const name of ['CapInh','CapPrm','CapEff','CapAmb']) {
    const value=status.match(new RegExp(`^${name}:\\s*([a-fA-F0-9]+)$`,'m'))?.[1];
    if(!value||BigInt('0x'+value)!==0n) throw new Error('HTML service must have no Linux capabilities');
  }
  for(const value of [bundleDirectory,digestFile,scratchParent]) {
    if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0')||path.resolve(value)!==value)
      throw new Error('HTML runtime paths must be canonical absolute paths');
  }
  const within=(a,b)=>a===b||a.startsWith(b+path.sep);
  if(bundleDirectory==='/'||scratchParent==='/'||within(digestFile,bundleDirectory)||
    within(scratchParent,bundleDirectory)||within(bundleDirectory,scratchParent)||within(digestFile,scratchParent))
    throw new Error('HTML runtime, trust record and scratch must be separate');

  // A root-owned sticky directory such as /tmp prevents this UID from replacing
  // root-owned children. All other ancestors must deny group/other writes.
  function ancestors(target) {
    let directory=path.dirname(target);
    for(;;) {
      const stat=fs.lstatSync(directory);
      if(!stat.isDirectory()||stat.uid!==0||((stat.mode&0o022)&&!(stat.mode&0o1000)))
        throw new Error('Unsafe HTML runtime ancestor');
      if(directory==='/') break;
      directory=path.dirname(directory);
    }
  }
  ancestors(bundleDirectory);ancestors(digestFile);ancestors(scratchParent);
  function sealed(target,directory) {
    const stat=fs.lstatSync(target);
    if(directory?!stat.isDirectory():!stat.isFile()) throw new Error('Runtime requires real files and directories');
    if(stat.uid!==0) throw new Error('HTML runtime must be root-owned');
    if(stat.mode&0o222||stat.mode&0o7000) throw new Error('HTML runtime must be read-only without special permission bits');
    if(!directory&&stat.nlink!==1) throw new Error('HTML runtime requires single-link files');
    return stat;
  }
  const digest=sealed(digestFile,false);
  if(digest.size!==65) throw new Error('Invalid HTML runtime trust record');
  const manifestSha256=fs.readFileSync(digestFile,'utf8');
  if(!/^[a-f0-9]{64}\n$/.test(manifestSha256)) throw new Error('Invalid HTML runtime trust record');
  let entries=0;
  function walk(directory,depth=0) {
    if(depth>16||++entries>4500) throw new Error('HTML runtime tree exceeds limits');
    sealed(directory,true);
    for(const name of fs.readdirSync(directory)) {
      const child=path.join(directory,name);
      if(fs.lstatSync(child).isDirectory()) walk(child,depth+1);
      else {if(++entries>4500) throw new Error('HTML runtime tree exceeds limits');sealed(child,false);}
    }
  }
  walk(bundleDirectory);
  const scratch=fs.lstatSync(scratchParent);
  if(!scratch.isDirectory()) throw new Error('HTML scratch must be a real directory');
  if(scratch.uid!==process.geteuid()||(scratch.mode&0o7777)!==0o700)
    throw new Error('HTML scratch must be private and service-owned');
  const runtime=Object.freeze({bundleDirectory,manifestSha256:manifestSha256.trim(),scratchParent});
  verifyParserBundle({directory:bundleDirectory,expectedManifestSha256:runtime.manifestSha256});
  // Prove the installed binaries, loader and kernel can run together. Synthetic
  // smoke text does not establish extraction fidelity or all security controls.
  const probe=await extractHtml(Buffer.from('<!doctype html><p>Runtime check.</p>'),runtime);
  if(probe.text!=='Runtime check.\n'||probe.quality.requiresReview!==true)
    throw new Error('HTML runtime smoke check failed');
  return runtime;
}
module.exports={loadHtmlRuntime};

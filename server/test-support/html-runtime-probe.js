// Linux root-only test orchestrator. Only mutates the disposable fixture passed
// by sandbox-tests.py; production checks run in child processes as UID/GID 1000.
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const {spawnSync}=require('child_process');

function runRuntimeProbe(bundleDirectory,digestFile,scratchParent) {
  assert.equal(process.getuid(),0);
  const parent=path.dirname(bundleDirectory),node=path.join(bundleDirectory,'runtime/node');
  const checker=path.resolve(__dirname,'../ops/check-parser-runtime.js');
  fs.chmodSync(parent,0o755);
  fs.chownSync(scratchParent,1000,1000);fs.chmodSync(scratchParent,0o700);
  function check({root=false,digest=digestFile,scratch=scratchParent}={}) {
    return spawnSync(node,[checker,bundleDirectory,digest,scratch],{
      uid:root?0:1000,gid:root?0:1000,env:{},cwd:parent,encoding:'utf8',timeout:15000});
  }
  let cases=0;
  const valid=check();assert.equal(valid.status,0,valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout),{ready:true,extractorVersion:'parse5-8.0.1-text-v1'});cases++;
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  const root=check({root:true});assert.notEqual(root.status,0);assert.match(root.stderr,/non-root/);cases++;
  function rejected(change,restore,pattern) {
    try {change();const result=check();assert.notEqual(result.status,0);assert.match(result.stderr,pattern);cases++;}
    finally {restore();}
  }
  const worker=path.join(bundleDirectory,'runtime/html-parser-worker.mjs');
  rejected(()=>fs.chownSync(worker,1000,1000),()=>fs.chownSync(worker,0,0),/root-owned/);
  rejected(()=>fs.chmodSync(worker,0o644),()=>fs.chmodSync(worker,0o444),/read-only/);
  rejected(()=>fs.chmodSync(bundleDirectory,0o575),()=>fs.chmodSync(bundleDirectory,0o555),/read-only/);
  rejected(()=>fs.chownSync(digestFile,1000,1000),()=>fs.chownSync(digestFile,0,0),/root-owned/);
  rejected(()=>fs.chmodSync(parent,0o777),()=>fs.chmodSync(parent,0o755),/ancestor/);
  rejected(()=>fs.chmodSync(scratchParent,0o755),()=>fs.chmodSync(scratchParent,0o700),/private/);
  const link=path.join(parent,'linked-scratch');fs.symlinkSync(scratchParent,link);
  try {const result=check({scratch:link});assert.notEqual(result.status,0);assert.match(result.stderr,/directory/);cases++;}
  finally {fs.unlinkSync(link);}
  const hardlink=path.join(parent,'worker-hardlink');
  rejected(()=>fs.linkSync(worker,hardlink),()=>fs.unlinkSync(hardlink),/single-link/);
  const originalDigest=fs.readFileSync(digestFile);
  rejected(()=>fs.writeFileSync(digestFile,'0'.repeat(64)+'\n'),()=>fs.writeFileSync(digestFile,originalDigest),/integrity/);
  const final=check();assert.equal(final.status,0,final.stderr);cases++;
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  return {cases};
}
module.exports={runRuntimeProbe};

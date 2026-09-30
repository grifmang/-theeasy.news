// Build-time only. No downloads, database access, providers, or service startup.
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {createParserBundle,verifyParserBundle}=require('../evidence/native/parser-bundle');

function buildParserBundle({destination,launcherExecutable,digestFile}) {
  if(process.platform!=='linux'||process.arch!=='x64'||process.versions.node!=='22.23.1')
    throw new Error('Build requires Linux x64 Node 22.23.1');
  if(![destination,launcherExecutable,digestFile].every(value=>typeof value==='string'&&path.isAbsolute(value)))
    throw new Error('Build paths must be absolute');
  const root=path.resolve(destination),trustRecord=path.resolve(digestFile);
  if(trustRecord===root||trustRecord.startsWith(root+path.sep)) throw new Error('Trust record must be outside bundle');
  // Do not overwrite either an earlier release or its trust record.
  if(fs.existsSync(root)||fs.existsSync(trustRecord)) throw new Error('Release output already exists');
  createParserBundle({destination:root,nodeExecutable:process.execPath,launcherExecutable});
  const manifestSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'manifest.json'))).digest('hex');
  verifyParserBundle({directory:root,expectedManifestSha256:manifestSha256});
  function seal(directory) {
    for(const name of fs.readdirSync(directory)) {
      const target=path.join(directory,name),entry=fs.lstatSync(target);
      if(entry.isDirectory()) seal(target);
      else if(entry.isFile()&&entry.nlink===1) fs.chmodSync(target,(entry.mode&0o111)?0o555:0o444);
      else throw new Error('Unexpected build entry');
    }
    fs.chmodSync(directory,0o555);
  }
  seal(root);
  fs.writeFileSync(trustRecord,manifestSha256+'\n',{flag:'wx',mode:0o444});
  // Read-only modes alone do not constrain the owning UID. Container builds
  // must run this as root, then execute the service as a distinct non-root UID.
  return {manifestSha256};
}
module.exports={buildParserBundle};
if(require.main===module) {
  try {
    if(process.argv.length!==5) throw new Error('Usage: build-parser-bundle <new-directory> <launcher> <new-digest-file>');
    const result=buildParserBundle({destination:process.argv[2],launcherExecutable:process.argv[3],digestFile:process.argv[4]});
    console.log(JSON.stringify(result));
  } catch(error) {
    // A partial build is retained for inspection, never mistaken for a release.
    console.error('Parser bundle build rejected:',error.message);process.exitCode=1;
  }
}

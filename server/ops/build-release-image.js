// Host-side release gate. Load the trusted verifier before capturing any source.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {verifyRelease}=require('./stage-release');

const MAX_ARCHIVE_BYTES=48*1024*1024;
const MAX_TOOL_OUTPUT=1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function validateTar(bytes) {
  if(bytes.length%512!==0)throw new Error('Invalid tar block length');
  const field=(block,start,length)=>block.subarray(start,start+length).toString('utf8').split('\0')[0];
  const octal=(block,start,length)=>{
    const value=field(block,start,length).trim();
    if(!/^[0-7]+$/.test(value))throw new Error('Invalid tar number');
    const number=parseInt(value,8);
    if(!Number.isSafeInteger(number))throw new Error('Tar number exceeds limit');
    return number;
  };
  const seen=new Set();let offset=0,entries=0;
  while(offset+512<=bytes.length) {
    const block=bytes.subarray(offset,offset+512);
    if(block.every(byte=>byte===0)) {
      if(!bytes.subarray(offset).every(byte=>byte===0))throw new Error('Tar has trailing content');
      if(!seen.has('release-manifest.json')||!seen.has('server/ops/Dockerfile.railway'))
        throw new Error('Tar is missing required release files');
      return;
    }
    if(++entries>1500||field(block,257,6)!=='ustar')throw new Error('Unsupported tar entry');
    const stored=octal(block,148,8);
    let sum=0;
    for(let i=0;i<512;i++)sum+=i>=148&&i<156?32:block[i];
    if(sum!==stored)throw new Error('Tar header checksum changed');
    const prefix=field(block,345,155),name=field(block,0,100);
    const raw=prefix?`${prefix}/${name}`:name;
    if(!raw.startsWith('./'))throw new Error('Tar entry is not relative');
    const relative=raw.slice(2).replace(/\/$/,'');
    if(relative&&(!relative.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..')||seen.has(relative)))
      throw new Error('Unsafe or repeated tar entry');
    if(relative)seen.add(relative);
    const kind=block[156],size=octal(block,124,12);
    if(![0,48,53].includes(kind)||kind===53&&size!==0||size>4*1024*1024||
        field(block,157,100))throw new Error('Unsafe tar entry type or size');
    offset+=512+Math.ceil(size/512)*512;
    if(offset>bytes.length)throw new Error('Truncated tar entry');
  }
  throw new Error('Tar terminator missing');
}
function absolute(value,label) {
  if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))
    throw new Error(`${label} must be an absolute path`);
  return path.resolve(value);
}
function tag(value,label) {
  if(typeof value!=='string'||value.length>128||
      !/^[a-z0-9][a-z0-9._/-]*:[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(value))
    throw new Error(`Invalid ${label}`);
  return value;
}
function run(command,args,options={}) {
  const result=spawnSync(command,args,{encoding:null,maxBuffer:options.maxBuffer||MAX_TOOL_OUTPUT,
    timeout:options.timeout||30000,cwd:options.cwd,input:options.input,
    windowsHide:true});
  if(result.error||result.status!==0||result.signal||result.stderr?.length)
    throw new Error(`${command} rejected: ${result.error?.message||result.stderr?.toString('utf8').slice(0,2000)||`exit ${result.status}`}`);
  return result.stdout;
}
function captureRelease({releaseDirectory,manifestSha256}) {
  const root=absolute(releaseDirectory,'Release directory');
  verifyRelease({directory:root,expectedSha256:manifestSha256});
  const bytes=run('tar',['--format','ustar','-cf','-','-C',root,'.'],
    {maxBuffer:MAX_ARCHIVE_BYTES+1,timeout:30000});
  if(!bytes.length||bytes.length>MAX_ARCHIVE_BYTES)throw new Error('Release archive exceeds limit');
  validateTar(bytes);
  return Object.freeze({bytes,sha256:digest(bytes),manifestSha256});
}
function buildCapturedRelease({capture,imageTag,toolchainTag,evidenceTarPath}) {
  if(!capture||!Buffer.isBuffer(capture.bytes)||!capture.bytes.length||
      capture.bytes.length>MAX_ARCHIVE_BYTES||capture.sha256!==digest(capture.bytes)||
      !/^[a-f0-9]{64}$/.test(capture.manifestSha256))throw new Error('Invalid captured release');
  const finalTag=tag(imageTag,'image tag'),buildTag=tag(toolchainTag,'toolchain tag');
  if(finalTag===buildTag)throw new Error('Distinct image tags required');
  const evidence=evidenceTarPath===undefined?null:absolute(evidenceTarPath,'Evidence tar path');
  if(evidence&&(fs.existsSync(evidence)||!fs.statSync(path.dirname(evidence)).isDirectory()))
    throw new Error('Evidence tar path must be new under an existing directory');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'easy-release-capture-'));
  try {
    validateTar(capture.bytes);
    run('tar',['-xf','-','-C',scratch],{input:capture.bytes,timeout:30000});
    verifyRelease({directory:scratch,expectedSha256:capture.manifestSha256});
    const build=(target,outputTag)=>{
      const args=['build','--quiet','--platform','linux/amd64','--build-arg',
        `RELEASE_MANIFEST_SHA256=${capture.manifestSha256}`];
      if(target)args.push('--target',target);
      args.push('-f','server/ops/Dockerfile.railway','-t',outputTag,'-');
      run('docker',args,{input:capture.bytes,timeout:12*60*1000,maxBuffer:MAX_TOOL_OUTPUT});
      const imageId=run('docker',['image','inspect',outputTag,'--format','{{.Id}}']).toString('utf8').trim();
      if(!/^sha256:[a-f0-9]{64}$/.test(imageId))throw new Error('Docker returned an invalid image ID');
      const label=run('docker',['image','inspect',imageId,'--format',
        '{{index .Config.Labels "org.easynews.release-manifest-sha256"}}']).toString('utf8').trim();
      if(label!==capture.manifestSha256)throw new Error('Image release digest label mismatch');
      return imageId;
    };
    const imageId=build(null,finalTag);
    const toolchainId=build('build',buildTag);
    if(evidence)fs.writeFileSync(evidence,capture.bytes,{flag:'wx',mode:0o600});
    return {manifestSha256:capture.manifestSha256,sourceTarSha256:capture.sha256,
      sourceTarBytes:capture.bytes.length,imageId,toolchainId};
  } finally {
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
function buildReleaseImages(options) {
  return buildCapturedRelease({...options,capture:captureRelease(options)});
}
module.exports={captureRelease,buildCapturedRelease,buildReleaseImages};
if(require.main===module) {
  try {
    const [releaseDirectory,manifestSha256,imageTag,toolchainTag,evidenceTarPath,...extra]=process.argv.slice(2);
    if(extra.length||!releaseDirectory||!manifestSha256||!imageTag||!toolchainTag)
      throw new Error('Usage: build-release-image <absolute-release-dir> <manifest-sha256> <image-tag> <toolchain-tag> [new-evidence-tar]');
    console.log(JSON.stringify(buildReleaseImages({releaseDirectory,manifestSha256,imageTag,toolchainTag,evidenceTarPath})));
  } catch(error) {console.error('Release image rejected:',error.message);process.exitCode=1;}
}

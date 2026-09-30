'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {constants:fsConstants}=require('node:fs');
const {createHash}=require('node:crypto');

const MAX_REGISTRY_BYTES=1024*1024;
const MAX_SNAPSHOT_BYTES=8*1024*1024;
const messages=Object.freeze({
  usage:'Expected one absolute candidate-registry JSON path.',
  invalid_path:'Registry and snapshots must be regular, non-symlink files.',
  file_too_large:'Registry or snapshot exceeds its intake limit.',
  invalid_json:'Registry or snapshot is not valid JSON.',
  invalid_metadata:'Candidate metadata or snapshot integrity is invalid.'
});

function fail(code){throw new Error(code);}
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function exact(value,names){return record(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));}
function text(value,max){return typeof value==='string'&&value.trim().length>0&&value.length<=max&&!value.includes('\0');}
function iso(value){return text(value,40)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&new Date(value).toISOString().startsWith(value.slice(0,19));}
function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}

function readBounded(filePath,maxBytes){
  if(typeof filePath!=='string'||!path.isAbsolute(filePath))fail('invalid_path');
  const resolved=path.resolve(filePath);let fd;
  try{
    const before=fs.lstatSync(resolved);
    if(!before.isFile()||before.isSymbolicLink()||before.size>maxBytes||fs.realpathSync(resolved)!==resolved)
      fail(before.size>maxBytes?'file_too_large':'invalid_path');
    fd=fs.openSync(resolved,fsConstants.O_RDONLY);
    const opened=fs.fstatSync(fd);
    if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>maxBytes)
      fail(opened.size>maxBytes?'file_too_large':'invalid_path');
    const bytes=Buffer.alloc(opened.size);let offset=0;
    while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!count)fail('invalid_path');offset+=count;}
    const after=fs.fstatSync(fd);
    if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)fail('invalid_path');
    let json;try{json=JSON.parse(bytes.toString('utf8'));}catch{fail('invalid_json');}
    return {json,bytes,resolved};
  }catch(error){if(messages[error?.message])throw error;fail('invalid_path');}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}

function validUrl(value){
  if(!text(value,8000))return false;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}
  catch{return false;}
}

function summarize(registryPath){
  const loaded=readBounded(registryPath,MAX_REGISTRY_BYTES),registry=loaded.json;
  if(!exact(registry,['version','status','topic','createdAt','restrictions','sources','candidateClaims'])||
    registry.version!==1||registry.status!=='unreviewed'||!text(registry.topic,500)||!iso(registry.createdAt)||
    !record(registry.restrictions)||registry.restrictions.notGroundTruth!==true||
    registry.restrictions.notForPublication!==true||registry.restrictions.independentDoubleReviewRequired!==true||
    typeof registry.restrictions.sourceTextStored!=='boolean'||
    (registry.restrictions.sourceTextCoverage!==undefined&&!text(registry.restrictions.sourceTextCoverage,500))||
    !Array.isArray(registry.sources)||!registry.sources.length||registry.sources.length>500||
    !Array.isArray(registry.candidateClaims)||!registry.candidateClaims.length||registry.candidateClaims.length>1000)
    fail('invalid_metadata');
  const sourceIds=new Set(),snapshots=[];
  for(const source of registry.sources){
    if(!record(source)||!text(source.id,200)||sourceIds.has(source.id)||!text(source.publisher,500)||
      !text(source.title,1000)||!validUrl(source.url)||
      (source.publishedAt!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt))||
      !text(source.kind,100)||source.access!=='public'||!text(source.snapshotStatus,100)||!text(source.limitations,4000))
      fail('invalid_metadata');
    sourceIds.add(source.id);
    const hasArtifact=Object.hasOwn(source,'snapshotArtifact')||Object.hasOwn(source,'snapshotSha256')||
      Object.hasOwn(source,'snapshotRetrievedAt');
    if(!hasArtifact)continue;
    if(!text(source.snapshotArtifact,240)||path.basename(source.snapshotArtifact)!==source.snapshotArtifact||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,230}\.json$/.test(source.snapshotArtifact)||
      !/^[a-f0-9]{64}$/.test(source.snapshotSha256||'')||!iso(source.snapshotRetrievedAt))fail('invalid_metadata');
    const artifactPath=path.resolve(path.dirname(loaded.resolved),source.snapshotArtifact);
    if(path.dirname(artifactPath)!==path.dirname(loaded.resolved))fail('invalid_metadata');
    const artifact=readBounded(artifactPath,MAX_SNAPSHOT_BYTES);
    if(digest(artifact.bytes)!==source.snapshotSha256||!record(artifact.json)||
      artifact.json.sourceId!==source.id||artifact.json.url!==source.url||
      artifact.json.retrievedAt!==source.snapshotRetrievedAt||!text(artifact.json.retrievalMethod,100)||
      !text(artifact.json.captureScope,200)||
      artifact.json.reviewStatus!=='unreviewed'||artifact.json.notGroundTruth!==true||
      artifact.json.notForPublication!==true||typeof artifact.json.completePageSnapshot!=='boolean')
      fail('invalid_metadata');
    snapshots.push(source.id);
  }
  const claimIds=new Set();
  for(const claim of registry.candidateClaims){
    if(!exact(claim,['id','wording','sourceIds','assertionType','qualification','reviewStatus'])||
      !text(claim.id,200)||claimIds.has(claim.id)||!text(claim.wording,4000)||
      !Array.isArray(claim.sourceIds)||!claim.sourceIds.length||claim.sourceIds.length>50||
      new Set(claim.sourceIds).size!==claim.sourceIds.length||claim.sourceIds.some(id=>!sourceIds.has(id))||
      !text(claim.assertionType,100)||!text(claim.qualification,4000)||claim.reviewStatus!=='unreviewed')
      fail('invalid_metadata');
    claimIds.add(claim.id);
  }
  if(registry.restrictions.sourceTextStored!==(snapshots.length>0))fail('invalid_metadata');
  return {status:'valid_unreviewed_candidates',registrySha256:digest(loaded.bytes),
    counts:{sources:sourceIds.size,claims:claimIds.size,snapshots:snapshots.length},
    restrictions:{notGroundTruth:true,notForPublication:true,independentDoubleReviewRequired:true}};
}

function main(argv){if(argv.length!==1||!path.isAbsolute(argv[0]))fail('usage');return summarize(argv[0]);}
if(require.main===module){try{process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)))}\n`);}
catch(error){const code=messages[error?.message]?error.message:'invalid_metadata';process.stderr.write(`${JSON.stringify({status:'error',code,message:messages[code]})}\n`);process.exitCode=1;}}

module.exports={main,summarize,MAX_REGISTRY_BYTES,MAX_SNAPSHOT_BYTES};

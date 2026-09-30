'use strict';

const {createHash}=require('node:crypto');
const {loadAnalysisVersion}=require('./persistence');

function fail(code){throw Object.assign(new Error(`Analysis view ${code}`),{code});}
function versionMetadata(row){return {id:row.id,claimId:row.claim_id,
  claimContextVersionId:row.claim_context_version_id,packetVersion:row.packet_version,
  draftSha256:row.draft_sha256,modelVersion:row.model_version,promptVersion:row.prompt_version,
  actorId:row.actor_id,createdAtMs:row.created_at_ms};}
function jobMetadata(row){return {id:row.id,analysisVersionId:row.analysis_version_id,
  policyVersion:row.policy_version,decisionModel:row.decision_model,admissionHash:row.admission_hash,
  state:row.state,attempts:row.attempts,maxAttempts:row.max_attempts,enqueuedBy:row.enqueued_by,
  enqueuedAtMs:row.enqueued_at_ms,taskDeadlineAtMs:row.task_deadline_at_ms,
  retryReadyAtMs:row.retry_ready_at_ms,leaseUntilMs:row.lease_until_ms,
  dispatchStartedAtMs:row.dispatch_started_at_ms,reportId:row.report_id,lastError:row.last_error};}
function permissionMetadata(row){return row?{id:row.id,jobId:row.job_id,admissionHash:row.admission_hash,
  allowed:row.allowed===1,actorId:row.actor_id,reason:row.reason,occurredAtMs:row.occurred_at_ms}:null;}
function reportMetadata(row){return {id:row.id,analysisVersionId:row.analysis_version_id,
  checkedVersionHash:row.checked_version_hash,policyVersion:row.policy_version,
  decisionModel:row.decision_model,stage:row.stage,blockingCount:row.blocking_count,
  createdAtMs:row.created_at_ms};}
function loadJob(db,id){return db.prepare('SELECT id,analysis_version_id,policy_version,decision_model,admission_hash,state,attempts,max_attempts,enqueued_by,enqueued_at_ms,task_deadline_at_ms,retry_ready_at_ms,lease_until_ms,dispatch_started_at_ms,report_id,last_error FROM analysis_verification_jobs WHERE id=?').get(id);}
function latestPermission(db,jobId){return db.prepare(`SELECT id,job_id,admission_hash,allowed,actor_id,reason,occurred_at_ms
  FROM analysis_verification_permission_events WHERE job_id=? ORDER BY id DESC LIMIT 1`).get(jobId);}
function loadReport(db,job){
  if(job.report_id===null)return null;
  const row=db.prepare(`SELECT id,analysis_version_id,checked_version_hash,policy_version,decision_model,
    report_json,report_sha256,stage,blocking_count,created_at_ms FROM analysis_verification_reports WHERE id=?`).get(job.report_id);
  if(!row||row.analysis_version_id!==job.analysis_version_id||row.policy_version!==job.policy_version||
    row.decision_model!==job.decision_model||job.state!=='done'||
    createHash('sha256').update(row.report_json).digest('hex')!==row.report_sha256)fail('integrity');
  let report;try{report=JSON.parse(row.report_json);}catch{fail('integrity');}
  if(!report||typeof report!=='object'||Array.isArray(report)||
    report.stage!==row.stage||report.checkedVersionHash!==row.checked_version_hash||
    !Array.isArray(report.blockingIssues)||report.blockingIssues.length!==row.blocking_count||
    !['mechanical_blocked','semantic_candidate','semantic_incomplete'].includes(report.stage))fail('integrity');
  return {metadata:reportMetadata(row),report};
}
function jobDetail(db,id){
  const job=loadJob(db,id);if(!job)return null;
  let version;try{version=loadAnalysisVersion(db,job.analysis_version_id);}catch{fail('integrity');}
  const permission=latestPermission(db,id);
  if(permission&&permission.admission_hash!==job.admission_hash)fail('integrity');
  return {job:jobMetadata(job),analysisVersion:versionMetadata(version),
    permission:permissionMetadata(permission),report:loadReport(db,job)};
}
function validateDraftTree(draft){
  if(!draft||typeof draft!=='object'||Array.isArray(draft))fail('invalid_draft_tree');
  const stack=[[draft,0]],seen=new Set();let nodes=0;
  while(stack.length){
    const [value,depth]=stack.pop();nodes++;
    if(nodes>20000||depth>12)fail('invalid_draft_tree');
    if(value===null||typeof value==='boolean')continue;
    if(typeof value==='string'){if(value.length>20000)fail('invalid_draft_tree');continue;}
    if(typeof value==='number'){if(!Number.isFinite(value))fail('invalid_draft_tree');continue;}
    if(typeof value!=='object'||seen.has(value))fail('invalid_draft_tree');
    seen.add(value);
    if(Array.isArray(value)){
      if(value.length>1000)fail('invalid_draft_tree');
      for(const item of value)stack.push([item,depth+1]);
    }else{
      if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)
        fail('invalid_draft_tree');
      const keys=Object.keys(value);
      if(keys.length>200)fail('invalid_draft_tree');
      for(const key of keys){
        if(key.length>128||['__proto__','prototype','constructor'].includes(key))fail('invalid_draft_tree');
        stack.push([value[key],depth+1]);
      }
    }
  }
}
function draftHash(draft){
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  return createHash('sha256').update(JSON.stringify(stable(draft))).digest('hex');
}
module.exports={versionMetadata,jobMetadata,permissionMetadata,loadJob,latestPermission,jobDetail,
  validateDraftTree,draftHash};

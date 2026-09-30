'use strict';

const {createHash}=require('node:crypto');
const {buildEvidencePacket}=require('../evidence/packet');
const {buildAssertionInventory}=require('./coverage');
const {verifyCurrentAnalysis}=require('./verify');

function fail(code){throw Object.assign(new Error(`Analysis persistence ${code}`),{code});}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function serialize(value,limit,code){let json;try{json=JSON.stringify(stable(value));}catch{fail(code);}if(!json||Buffer.byteLength(json,'utf8')>limit)fail(code);return json;}
function sha(value){return createHash('sha256').update(value).digest('hex');}
function loadAnalysisVersion(db,id){
  if(!Number.isSafeInteger(id)||id<1)fail('invalid_request');
  const row=db.prepare('SELECT * FROM analysis_versions WHERE id=?').get(id);if(!row)fail('unknown_version');
  if(sha(row.draft_json)!==row.draft_sha256)fail('draft_integrity');
  let draft;try{draft=JSON.parse(row.draft_json);}catch{fail('draft_integrity');}
  if(!draft?.provenance||draft.provenance.claimVersionId!==row.claim_context_version_id||
    draft.provenance.packetVersion!==row.packet_version||draft.provenance.model!==row.model_version||
    draft.provenance.promptVersion!==row.prompt_version)fail('draft_integrity');
  return {...row,draft};
}
function saveAnalysisVersion(db,{claimId,actorId,draft,now=Date.now()}){
  if(!db||typeof db.prepare!=='function'||!Number.isSafeInteger(claimId)||claimId<1||
    !Number.isSafeInteger(actorId)||actorId<1||!Number.isSafeInteger(now)||now<0)fail('invalid_request');
  return db.transaction(()=>{
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(actorId)?.role!=='editor')fail('editor_required');
    const packet=buildEvidencePacket(db,claimId);
    buildAssertionInventory({draft,packet});
    if(draft.provenance.claimVersionId!==packet.context?.id)fail('version_changed');
    const draftJson=serialize(draft,262144,'draft_too_large'),draftSha256=sha(draftJson);
    db.prepare(`INSERT INTO analysis_versions(claim_id,claim_context_version_id,packet_version,draft_json,
      draft_sha256,model_version,prompt_version,actor_id,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(claim_id,draft_sha256) DO NOTHING`).run(claimId,packet.context.id,packet.version,draftJson,
        draftSha256,draft.provenance.model,draft.provenance.promptVersion,actorId,now);
    const row=db.prepare('SELECT * FROM analysis_versions WHERE claim_id=? AND draft_sha256=?').get(claimId,draftSha256);
    if(row.packet_version!==packet.version||row.claim_context_version_id!==packet.context.id||
      row.model_version!==draft.provenance.model||row.prompt_version!==draft.provenance.promptVersion)
      fail('version_conflict');
    return {...row,draft:JSON.parse(row.draft_json)};
  }).immediate();
}
async function verifyAndRecordAnalysis(db,{analysisVersionId,policy},decisionAdapter,{clock=Date.now,commitGuard,...options}={}){
  if(typeof clock!=='function')fail('invalid_request');
  const version=loadAnalysisVersion(db,analysisVersionId);
  const report=await verifyCurrentAnalysis({db,claimId:version.claim_id,draft:version.draft,policy},decisionAdapter,{...options,clock});
  const reportJson=serialize(report,1048576,'report_too_large'),reportSha256=sha(reportJson),now=clock();
  if(!Number.isSafeInteger(now)||now<0||!['mechanical_blocked','semantic_candidate','semantic_incomplete'].includes(report.stage)||
    !Array.isArray(report.blockingIssues)||report.blockingIssues.length>1000||!/^[a-f0-9]{64}$/.test(report.checkedVersionHash))
    fail('invalid_report');
  return db.transaction(()=>{
    const current=loadAnalysisVersion(db,analysisVersionId),packet=buildEvidencePacket(db,current.claim_id);
    if(current.draft_sha256!==version.draft_sha256||packet.version!==current.packet_version||
      packet.version!==current.draft.provenance.packetVersion)fail('version_changed');
    db.prepare(`INSERT INTO analysis_verification_reports(analysis_version_id,checked_version_hash,
      policy_version,decision_model,report_json,report_sha256,stage,blocking_count,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(analysis_version_id,checked_version_hash,policy_version,decision_model)
      DO NOTHING`).run(current.id,report.checkedVersionHash,policy.version,policy.decisionModel,reportJson,
        reportSha256,report.stage,report.blockingIssues.length,now);
    const saved=db.prepare(`SELECT * FROM analysis_verification_reports WHERE analysis_version_id=?
      AND checked_version_hash=? AND policy_version=? AND decision_model=?`).get(current.id,
        report.checkedVersionHash,policy.version,policy.decisionModel);
    if(saved.report_sha256!==reportSha256)fail('report_conflict');
    if(commitGuard)commitGuard(saved,now);
    return {...saved,report:JSON.parse(saved.report_json)};
  }).immediate();
}
module.exports={saveAnalysisVersion,loadAnalysisVersion,verifyAndRecordAnalysis};

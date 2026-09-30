'use strict';
const {createHash}=require('node:crypto');
const {loadAnalysisVersion}=require('../analysis/persistence');
const {projectPublicationDto}=require('./dto');
const {ownerEvent,requireEditor,requirePublicationOwner}=require('./owner-authority');
function fail(code){throw Object.assign(new Error(`Publication ${code}`),{code});}
const sha=value=>createHash('sha256').update(value).digest('hex');
function validId(value){return Number.isSafeInteger(value)&&value>0;}
function expectedId(value){return value===null||validId(value);}
function args({actorId,reason,requestKey,now}){
  if(!validId(actorId)||typeof reason!=='string'||!reason.trim()||reason.length>500||
    /[\x00-\x1f\x7f]/.test(reason)||typeof requestKey!=='string'||
    !/^[A-Za-z0-9_-]{16,120}$/.test(requestKey)||!Number.isSafeInteger(now)||now<0||now>8640000000000000)
    fail('invalid_request');
}
function hash64(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function current(db,analysisVersionId){
  if(!validId(analysisVersionId))fail('invalid_request');
  const version=loadAnalysisVersion(db,analysisVersionId),projection=projectPublicationDto(db,version);
  return {version,projection};
}
function report(db,reportId,version){
  if(!validId(reportId))fail('invalid_request');
  const row=db.prepare(`SELECT r.* FROM analysis_verification_reports r WHERE r.id=? AND
    r.analysis_version_id=? AND EXISTS(SELECT 1 FROM analysis_verification_jobs j
      WHERE j.report_id=r.id AND j.state='done' AND j.analysis_version_id=r.analysis_version_id AND
      j.policy_version=r.policy_version AND j.decision_model=r.decision_model)`).get(reportId,version.id);
  if(!row)fail('report_conflict');
  if(sha(row.report_json)!==row.report_sha256)fail('report_integrity');
  let body;try{body=JSON.parse(row.report_json);}catch{fail('report_integrity');}
  if(body?.checkedVersionHash!==row.checked_version_hash||body.stage!==row.stage||
    !Array.isArray(body.blockingIssues)||body.blockingIssues.length!==row.blocking_count)
    fail('report_integrity');
  return {row,body};
}
function latestReview(db,versionId){return db.prepare('SELECT * FROM publication_review_events WHERE analysis_version_id=? ORDER BY id DESC LIMIT 1').get(versionId)??null;}
function head(db,claimId){return db.prepare('SELECT * FROM publication_manifest_heads WHERE claim_id=?').get(claimId)??null;}
function checkHead(row,expectedGeneration,expectedHeadEventId){
  if(!(expectedGeneration===null||Number.isSafeInteger(expectedGeneration)&&expectedGeneration>0)||
    !expectedId(expectedHeadEventId))fail('invalid_request');
  if((row?.generation??null)!==expectedGeneration||(row?.event_id??null)!==expectedHeadEventId)
    fail('head_conflict');
}
function idempotent(db,table,requestKey,requestHash){
  const prior=db.prepare(`SELECT * FROM ${table} WHERE request_key=?`).get(requestKey);
  if(prior&&prior.request_hash!==requestHash)fail('idempotency_conflict');
  return prior??null;
}
function enqueueDeliveryTasks(db,claimId,generation,now){
  const outbox=db.prepare('SELECT id FROM publication_outbox WHERE claim_id=? AND generation=?')
    .get(claimId,generation);
  for(const target of ['public_index','static_snapshot','cache','document_preview'])
    db.prepare(`INSERT INTO publication_delivery_tasks(outbox_id,target,generation,ready_at_ms)
      VALUES(?,?,?,?)`).run(outbox.id,target,generation,now);
}
function previewVersion(db,{analysisVersionId,actorId}){
  requireEditor(db,actorId);
  const {version,projection}=current(db,analysisVersionId);
  return {analysisVersionId:version.id,draftSha256:version.draft_sha256,
    packetVersion:version.packet_version,dto:projection.dto,dtoSha256:projection.dtoSha256,
    dependencySha256:projection.dependencySha256};
}
function publicationHeadState(db,{claimId,actorId}){
  requireEditor(db,actorId);
  if(!validId(claimId))fail('invalid_request');
  if(!db.prepare('SELECT id FROM research_claims WHERE id=?').get(claimId))fail('unknown_claim');
  const currentHead=head(db,claimId);
  let activeVersionId=null;
  if(currentHead?.state==='active'){
    const snapshot=db.prepare('SELECT analysis_version_id FROM publication_snapshots WHERE id=? AND claim_id=?')
      .get(currentHead.snapshot_id,claimId);
    if(!validId(snapshot?.analysis_version_id))fail('publication_integrity');
    activeVersionId=snapshot.analysis_version_id;
  }
  return {claimId,head:currentHead?{generation:currentHead.generation,
    eventId:currentHead.event_id,state:currentHead.state,
    analysisVersionId:activeVersionId}:null,
    isPublicationOwner:ownerEvent(db,actorId)?.allowed===1};
}
function publicationVersionState(db,{analysisVersionId,reportId,actorId}){
  requireEditor(db,actorId);
  const {version,projection}=current(db,analysisVersionId);
  const checked=report(db,reportId,version);
  const claimState=publicationHeadState(db,{claimId:version.claim_id,actorId});
  const review=latestReview(db,version.id);
  return {analysisVersionId:version.id,claimId:version.claim_id,
    preview:projection.dto,draftSha256:version.draft_sha256,
    reportSha256:checked.row.report_sha256,
    checkedVersionHash:checked.row.checked_version_hash,
    dtoSha256:projection.dtoSha256,dependencySha256:projection.dependencySha256,
    latestReview:review?{id:review.id,decision:review.decision,
      occurredAtMs:review.occurred_at_ms}:null,
    head:claimState.head,isPublicationOwner:claimState.isPublicationOwner};
}
function approveVersion(db,{analysisVersionId,reportId,expectedDraftSha256,expectedReportSha256,
  expectedCheckedVersionHash,expectedDtoSha256,expectedReviewEventId,actorId,reason,
  requestKey,now=Date.now(),decision='approved'}){
  args({actorId,reason,requestKey,now});
  if(!validId(analysisVersionId)||!validId(reportId)||!hash64(expectedDraftSha256)||
    !hash64(expectedReportSha256)||!hash64(expectedCheckedVersionHash)||
    !hash64(expectedDtoSha256)||!expectedId(expectedReviewEventId)||
    !['approved','rejected'].includes(decision))fail('invalid_request');
  const requestHash=sha(JSON.stringify([analysisVersionId,reportId,expectedDraftSha256,
    expectedReportSha256,expectedCheckedVersionHash,expectedDtoSha256,expectedReviewEventId,
    actorId,reason,decision]));
  return db.transaction(()=>{
    requireEditor(db,actorId);
    const prior=idempotent(db,'publication_review_events',requestKey,requestHash);if(prior)return prior;
    const {version,projection}=current(db,analysisVersionId),checked=report(db,reportId,version);
    const activeHead=head(db,version.claim_id);
    if(activeHead?.state==='active'){
      const snapshot=db.prepare('SELECT analysis_version_id FROM publication_snapshots WHERE id=? AND claim_id=?')
        .get(activeHead.snapshot_id,version.claim_id);
      if(!validId(snapshot?.analysis_version_id))fail('publication_integrity');
      if(snapshot.analysis_version_id===version.id)fail('review_conflict');
    }
    if(version.draft_sha256!==expectedDraftSha256||checked.row.report_sha256!==expectedReportSha256||
      checked.row.checked_version_hash!==expectedCheckedVersionHash||
      projection.dtoSha256!==expectedDtoSha256)fail('version_changed');
    if((latestReview(db,version.id)?.id??null)!==expectedReviewEventId)fail('review_conflict');
    const result=db.prepare(`INSERT INTO publication_review_events(analysis_version_id,draft_sha256,
      report_id,report_sha256,checked_version_hash,policy_version,decision_model,
      claim_context_version_id,packet_version,dto_sha256,actor_id,decision,reason,
      previous_review_event_id,request_key,request_hash,occurred_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(version.id,version.draft_sha256,checked.row.id,
      checked.row.report_sha256,checked.row.checked_version_hash,checked.row.policy_version,
      checked.row.decision_model,version.claim_context_version_id,version.packet_version,
      projection.dtoSha256,actorId,decision,reason,expectedReviewEventId,requestKey,requestHash,now);
    return db.prepare('SELECT * FROM publication_review_events WHERE id=?').get(result.lastInsertRowid);
  }).immediate();
}
function eligible(checked,projection){
  if(checked.row.stage!=='semantic_candidate'||checked.body.stage!=='semantic_candidate'||
    !projection.packet.coverage.complete||projection.packet.coverage.gaps.length||
    checked.body.blockingIssues.some(issue=>issue?.code!=='human_confirmation_required')||
    !checked.body.blockingIssues.some(issue=>issue?.code==='human_confirmation_required'))
    fail('publication_blocked');
}
function commitSnapshot(db,{version,projection,review,action,actorId,reason,requestKey,requestHash,
  now,expectedGeneration,expectedHeadEventId}){
  const old=head(db,version.claim_id);checkHead(old,expectedGeneration,expectedHeadEventId);
  if(action==='publish'&&old||action==='correct'&&old?.state!=='active')fail('head_conflict');
  const generation=(old?.generation??0)+1;
  const snapshotResult=db.prepare(`INSERT INTO publication_snapshots(claim_id,analysis_version_id,
    review_event_id,dto_json,dto_sha256,dependency_sha256,created_at_ms) VALUES(?,?,?,?,?,?,?)`)
    .run(version.claim_id,version.id,review.id,projection.dtoJson,projection.dtoSha256,
      projection.dependencySha256,now);
  const snapshotId=Number(snapshotResult.lastInsertRowid);
  for(const dependency of projection.dependencies)db.prepare(`INSERT INTO publication_dependencies
    (snapshot_id,source_id,source_access_event_id,claim_event_id) VALUES(?,?,?,?)`)
    .run(snapshotId,dependency.sourceId,dependency.sourceAccessEventId,dependency.claimEventId);
  const eventResult=db.prepare(`INSERT INTO publication_events(claim_id,snapshot_id,action,generation,
    previous_event_id,actor_id,reason,request_key,request_hash,occurred_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(version.claim_id,snapshotId,action,generation,
      old?.event_id??null,actorId,reason,requestKey,requestHash,now);
  const eventId=Number(eventResult.lastInsertRowid);
  if(old)db.prepare(`UPDATE publication_manifest_heads SET generation=?,event_id=?,snapshot_id=?,
    dto_sha256=?,state='active' WHERE claim_id=? AND generation=?`)
    .run(generation,eventId,snapshotId,projection.dtoSha256,version.claim_id,old.generation);
  else db.prepare(`INSERT INTO publication_manifest_heads
    (claim_id,generation,event_id,snapshot_id,dto_sha256,state) VALUES(?,?,?,?,?,'active')`)
    .run(version.claim_id,generation,eventId,snapshotId,projection.dtoSha256);
  db.prepare(`INSERT INTO publication_outbox(claim_id,generation,event_id,action,dto_sha256,created_at_ms)
    VALUES(?,?,?,'activate',?,?)`).run(version.claim_id,generation,eventId,projection.dtoSha256,now);
  enqueueDeliveryTasks(db,version.claim_id,generation,now);
  return db.prepare('SELECT * FROM publication_events WHERE id=?').get(eventId);
}
function publishOrCorrect(db,input,action){
  const {analysisVersionId,reviewEventId,expectedDraftSha256,expectedReportSha256,
    expectedCheckedVersionHash,expectedDtoSha256,expectedGeneration,expectedHeadEventId,
    actorId,reason,requestKey,now=Date.now()}=input;
  args({actorId,reason,requestKey,now});
  if(!validId(analysisVersionId)||!validId(reviewEventId)||!hash64(expectedDraftSha256)||
    !hash64(expectedReportSha256)||!hash64(expectedCheckedVersionHash)||!hash64(expectedDtoSha256)||
    !(expectedGeneration===null||validId(expectedGeneration))||!expectedId(expectedHeadEventId))
    fail('invalid_request');
  const requestHash=sha(JSON.stringify([action,analysisVersionId,reviewEventId,expectedDraftSha256,
    expectedReportSha256,expectedCheckedVersionHash,expectedDtoSha256,expectedGeneration,
    expectedHeadEventId,actorId,reason]));
  return db.transaction(()=>{
    requireEditor(db,actorId);
    const prior=idempotent(db,'publication_events',requestKey,requestHash);if(prior)return prior;
    const {version,projection}=current(db,analysisVersionId);
    const review=latestReview(db,version.id);
    if(!review||review.id!==reviewEventId||review.decision!=='approved'||
      review.draft_sha256!==expectedDraftSha256||version.draft_sha256!==expectedDraftSha256||
      review.dto_sha256!==expectedDtoSha256||projection.dtoSha256!==expectedDtoSha256)
      fail('review_conflict');
    const checked=report(db,review.report_id,version);
    if(review.report_sha256!==expectedReportSha256||checked.row.report_sha256!==expectedReportSha256||
      review.checked_version_hash!==expectedCheckedVersionHash||
      checked.row.checked_version_hash!==expectedCheckedVersionHash||
      review.packet_version!==version.packet_version||
      review.claim_context_version_id!==version.claim_context_version_id)
      fail('version_changed');
    eligible(checked,projection);
    const old=head(db,version.claim_id);
    if(action==='correct'&&old?.snapshot_id){
      const oldSnapshot=db.prepare('SELECT analysis_version_id FROM publication_snapshots WHERE id=?').get(old.snapshot_id);
      if(oldSnapshot?.analysis_version_id===version.id)fail('correction_requires_new_version');
    }
    return commitSnapshot(db,{version,projection,review,action,actorId,reason,requestKey,
      requestHash,now,expectedGeneration,expectedHeadEventId});
  }).immediate();
}
function publishVersion(db,input){return publishOrCorrect(db,input,'publish');}
function correctVersion(db,input){return publishOrCorrect(db,input,'correct');}
function tombstone(db,{claimId,actorId,reason,requestKey,requestHash,now,action,
  expectedGeneration,expectedHeadEventId}){
  const old=head(db,claimId);checkHead(old,expectedGeneration,expectedHeadEventId);
  if(old?.state!=='active')fail('head_conflict');
  const generation=old.generation+1;
  const result=db.prepare(`INSERT INTO publication_events(claim_id,snapshot_id,action,generation,
    previous_event_id,actor_id,reason,request_key,request_hash,occurred_at_ms)
    VALUES(?,NULL,?,?,?,?,?,?,?,?)`).run(claimId,action,generation,old.event_id,
      actorId,reason,requestKey,requestHash,now);
  const eventId=Number(result.lastInsertRowid);
  db.prepare(`UPDATE publication_manifest_heads SET generation=?,event_id=?,snapshot_id=NULL,
    dto_sha256=NULL,state='tombstone' WHERE claim_id=? AND generation=?`)
    .run(generation,eventId,claimId,old.generation);
  db.prepare(`INSERT INTO publication_outbox(claim_id,generation,event_id,action,dto_sha256,created_at_ms)
    VALUES(?,?,?,'invalidate',NULL,?)`).run(claimId,generation,eventId,now);
  enqueueDeliveryTasks(db,claimId,generation,now);
  return db.prepare('SELECT * FROM publication_events WHERE id=?').get(eventId);
}
function retractVersion(db,{claimId,actorId,reason,requestKey,expectedGeneration,
  expectedHeadEventId,now=Date.now()}){
  args({actorId,reason,requestKey,now});if(!validId(claimId)||
    !(expectedGeneration===null||validId(expectedGeneration))||!expectedId(expectedHeadEventId))
    fail('invalid_request');
  const requestHash=sha(JSON.stringify(['retract',claimId,actorId,reason,expectedGeneration,expectedHeadEventId]));
  return db.transaction(()=>{
    requirePublicationOwner(db,actorId);
    const prior=idempotent(db,'publication_events',requestKey,requestHash);if(prior)return prior;
    return tombstone(db,{claimId,actorId,reason,requestKey,requestHash,now,action:'retract',
      expectedGeneration,expectedHeadEventId});
  }).immediate();
}
function invalidateClaimForChange(db,{claimId,actorId,reason,now=Date.now(),restricted=false}){
  const old=head(db,claimId);if(old?.state!=='active')return null;
  if(restricted)requirePublicationOwner(db,actorId);else requireEditor(db,actorId);
  const requestKey=`invalidation_claim_${claimId}_${old.generation}_${now}`;
  return tombstone(db,{claimId,actorId,reason:reason.slice(0,500),requestKey,
    requestHash:sha(JSON.stringify(['invalidate',claimId,old.generation,actorId,restricted])),now,
    action:restricted?'restrict':'invalidate',expectedGeneration:old.generation,
    expectedHeadEventId:old.event_id});
}
function invalidateSourceForChange(db,{sourceId,actorId,reason,now=Date.now(),restricted=false}){
  const claims=db.prepare(`SELECT h.claim_id,h.generation FROM publication_manifest_heads h
    JOIN publication_dependencies d ON d.snapshot_id=h.snapshot_id
    WHERE h.state='active' AND d.source_id=? ORDER BY h.claim_id`).all(sourceId);
  if(claims.length){if(restricted)requirePublicationOwner(db,actorId);else requireEditor(db,actorId);}
  const events=[];
  for(const item of claims){const event=invalidateClaimForChange(db,{claimId:item.claim_id,
    actorId,reason,now,restricted});if(event)events.push(event);}
  return events;
}
function restrictClaim(db,{claimId,actorId,reason,expectedEventId}){
  requirePublicationOwner(db,actorId);
  return require('../research-lifecycle').appendClaimEvent(db,{claimId,actorId,type:'restricted',
    reason,expectedEventId});
}
function restrictSource(db,{sourceId,actorId,reason,expectedEventId}){
  requirePublicationOwner(db,actorId);
  return require('../source-provenance').setSourceAccess(db,{sourceId,actorId,policy:'restricted',
    reason,expectedEventId});
}
// Private exporter boundary: only the immutable sanitized DTO and fixed sink
// identity leave this module. No draft, report, packet, or evidence is returned.
function loadExportCommand(db,{outboxId,target,sinkId}){
  if(!validId(outboxId)||!['public_index','static_snapshot','cache','document_preview'].includes(target)||
    typeof sinkId!=='string'||!/^[0-9a-f-]{36}$/.test(sinkId))fail('invalid_request');
  const outbox=db.prepare('SELECT * FROM publication_outbox WHERE id=?').get(outboxId);
  if(!outbox)fail('unknown_outbox');
  const command={sinkId,outboxId,target,claimId:outbox.claim_id,generation:outbox.generation,
    action:outbox.action,dtoSha256:outbox.dto_sha256};
  const desired=head(db,outbox.claim_id);
  if(!desired||desired.generation!==outbox.generation||desired.event_id!==outbox.event_id)
    return {command,dtoJson:null,superseded:true};
  if(outbox.action==='invalidate'){
    if(desired.state!=='tombstone'||desired.snapshot_id!==null||desired.dto_sha256!==null)
      fail('head_conflict');
    return {command,dtoJson:null,superseded:false};
  }
  if(desired.state!=='active'||desired.dto_sha256!==outbox.dto_sha256||!desired.snapshot_id)
    fail('head_conflict');
  const snapshot=db.prepare('SELECT * FROM publication_snapshots WHERE id=?').get(desired.snapshot_id);
  if(!snapshot||snapshot.claim_id!==outbox.claim_id||snapshot.dto_sha256!==outbox.dto_sha256||
    sha(snapshot.dto_json)!==snapshot.dto_sha256)fail('snapshot_integrity');
  const {version,projection}=current(db,snapshot.analysis_version_id);
  const review=db.prepare('SELECT * FROM publication_review_events WHERE id=?').get(snapshot.review_event_id);
  if(!review||review.decision!=='approved'||review.analysis_version_id!==version.id||
    latestReview(db,version.id)?.id!==review.id||
    review.dto_sha256!==snapshot.dto_sha256||projection.dtoSha256!==snapshot.dto_sha256||
    projection.dtoJson!==snapshot.dto_json||projection.dependencySha256!==snapshot.dependency_sha256)
    fail('snapshot_integrity');
  const checked=report(db,review.report_id,version);
  if(checked.row.report_sha256!==review.report_sha256||
    checked.row.checked_version_hash!==review.checked_version_hash)fail('report_changed');
  eligible(checked,projection);
  const stored=db.prepare(`SELECT source_id AS sourceId,source_access_event_id AS sourceAccessEventId,
    claim_event_id AS claimEventId FROM publication_dependencies WHERE snapshot_id=? ORDER BY source_id`)
    .all(snapshot.id);
  if(JSON.stringify(stored)!==JSON.stringify(projection.dependencies))fail('dependency_changed');
  return {command,dtoJson:snapshot.dto_json,superseded:false,
    snapshotId:snapshot.id,reviewId:review.id,analysisVersionId:version.id,
    dependencySha256:snapshot.dependency_sha256,preparedDtoSha256:sha(snapshot.dto_json)};
}
function fenceExportCommand(db,prepared){
  const {command}=prepared??{};
  if(!command)fail('invalid_request');
  const outbox=db.prepare('SELECT * FROM publication_outbox WHERE claim_id=? AND generation=?')
    .get(command.claimId,command.generation);
  if(!outbox||outbox.id!==command.outboxId||outbox.action!==command.action||
    outbox.dto_sha256!==command.dtoSha256)
    fail('outbox_changed');
  const desired=head(db,command.claimId);
  if(!desired||desired.generation!==command.generation||desired.event_id!==outbox.event_id)
    return {superseded:true,appliedGeneration:desired?.generation??null};
  if(command.action==='invalidate'){
    if(desired.state!=='tombstone'||desired.snapshot_id!==null)fail('head_conflict');
    return {superseded:false,appliedGeneration:command.generation};
  }
  if(db.prepare('SELECT state FROM work_admission_state WHERE id=1').get()?.state!=='running')
    fail('work_paused');
  if(desired.state!=='active'||desired.dto_sha256!==command.dtoSha256||!desired.snapshot_id||
    desired.snapshot_id!==prepared.snapshotId||typeof prepared.dtoJson!=='string'||
    prepared.preparedDtoSha256!==command.dtoSha256)
    fail('snapshot_integrity');
  const snapshot=db.prepare(`SELECT id,claim_id,analysis_version_id,review_event_id,
    dto_sha256,dependency_sha256 FROM publication_snapshots WHERE id=?`).get(desired.snapshot_id);
  const review=db.prepare('SELECT * FROM publication_review_events WHERE id=?').get(prepared.reviewId);
  if(!snapshot||snapshot.claim_id!==command.claimId||
    snapshot.analysis_version_id!==prepared.analysisVersionId||
    snapshot.dto_sha256!==command.dtoSha256||
    snapshot.review_event_id!==prepared.reviewId||
    snapshot.dependency_sha256!==prepared.dependencySha256||
    !review||review.decision!=='approved'||review.dto_sha256!==command.dtoSha256||
    review.analysis_version_id!==prepared.analysisVersionId||
    latestReview(db,prepared.analysisVersionId)?.id!==review.id)
    fail('snapshot_integrity');
  const changed=db.prepare(`SELECT 1 FROM publication_dependencies d
    WHERE d.snapshot_id=? AND (d.claim_event_id IS NOT
      (SELECT id FROM claim_events WHERE claim_id=? ORDER BY id DESC LIMIT 1)
      OR d.source_access_event_id IS NOT
      (SELECT id FROM source_access_events WHERE source_id=d.source_id ORDER BY id DESC LIMIT 1)
      OR NOT EXISTS(SELECT 1 FROM source_access_events a WHERE a.id=d.source_access_event_id
        AND a.policy IN ('excerpt_only','public_original'))) LIMIT 1`).get(snapshot.id,command.claimId);
  if(changed)fail('dependency_changed');
  return {superseded:false,appliedGeneration:command.generation};
}
module.exports={previewVersion,publicationHeadState,publicationVersionState,
  approveVersion,publishVersion,correctVersion,retractVersion,
  restrictClaim,restrictSource,invalidateClaimForChange,invalidateSourceForChange,
  loadExportCommand,fenceExportCommand};

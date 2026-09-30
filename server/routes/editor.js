const express=require('express');
const {createHash}=require('crypto');
const {createTopic,proposeClaim,addPassage}=require('../research');
const {appendClaimEvent,getClaimState}=require('../research-lifecycle');
const {appendClaimContext,getClaimContext}=require('../claim-context');
const {importTextOriginal}=require('../evidence/import-original');
const {listRetrievals}=require('../source-provenance');
const {recordHumanAssessment,listHumanAssessments}=require('../human-assessments');
const {searchPassages}=require('../retrieval/search');
const {retrieveCandidates}=require('../retrieval');
const {buildEvidencePacket}=require('../evidence/packet');
const {enqueueClaimJob,claimJobIneligibility,STAGE}=require('../claim-jobs');
const {prepareClaimEvaluation}=require('../claim-decision');
const {getProviderPermission,setProviderPermission,recoverProviderQueue}=require('../provider-permission');
const {enqueueFetchJob}=require('../discovery/fetch-jobs');
const {extractFetchText}=require('../evidence/extract-fetch');
const {listDocumentExtractions,getExtraction,recordExtractionReview}=require('../evidence/extraction-review');
const {linkSourceChain,getSourceChain}=require('../source-chains');
const {appendClaimRelationship,revokeClaimRelationship,correctClaimRelationship,listClaimRelationships,appendClaimSearchAttempt,
  listClaimSearchAttempts,appendClaimCoverageEvent,listClaimCoverageEvents,projectClaimResearch}=require('../claim-research');
const budgetOps=require('../models/budget-ops');
const {changeWorkAdmission,workAdmissionStatus}=require('../ops/work-admission');
const {saveAnalysisVersion,loadAnalysisVersion}=require('../analysis/persistence');
const {enqueueVerificationJob,authorizeVerificationJob,admissionHash,POLICY}=require('../analysis/jobs');
const analysisView=require('../analysis/view');
const publication=require('../publication/service');
const fetchFields='id,topic_id,source_policy_id,url,state,failures,max_failures,next_attempt,last_error';

function exactBody(body,keys){return body!==null&&typeof body==='object'&&!Array.isArray(body)&&
  Object.keys(body).length===keys.length&&keys.every(key=>Object.hasOwn(body,key));}
function analysisBad(){throw Object.assign(new Error('Invalid analysis request'),{code:'analysis_bad_request'});}
function analysisAfter(query){if(query.after===undefined)return 0;return id(query.after);}
function publicationError(error,res){
  const code=error.code;
  if(code==='unknown_claim'||code==='unknown_version')return res.status(404).json({error:'Publication record not found'});
  if(['editor_required','publication_owner_required'].includes(code))
    return res.status(403).json({error:'Publication access denied'});
  if(['publication_blocked','source_not_public','invalid_public_text','invalid_public_url',
    'dto_too_large','invalid_draft','citation_changed'].includes(code))
    return res.status(422).json({error:'Publication is blocked'});
  if(['head_conflict','review_conflict','version_changed','report_conflict',
    'idempotency_conflict','correction_requires_new_version'].includes(code))
    return res.status(409).json({error:'Publication state changed; reload and retry'});
  if(code==='invalid_request'||error.message==='Invalid identifier')
    return res.status(400).json({error:'Invalid publication request'});
  return res.status(500).json({error:'Publication integrity failure'});
}
function publicationRoute(fn){return (req,res)=>{
  try {fn(req,res);} catch(error) {publicationError(error,res);}
};}
function publicationId(value){
  if(typeof value!=='string'||!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))
    throw Object.assign(new Error('Invalid publication identifier'),{code:'invalid_request'});
  return Number(value);
}
function publicationBody(body,keys){
  if(!exactBody(body,keys))throw Object.assign(new Error('Invalid publication body'),{code:'invalid_request'});
}
function publicationEventView(row){return {id:row.id,claimId:row.claim_id,action:row.action,
  generation:row.generation,occurredAtMs:row.occurred_at_ms};}
function publicationReviewView(row){return {id:row.id,analysisVersionId:row.analysis_version_id,
  decision:row.decision,occurredAtMs:row.occurred_at_ms};}

function id(value) {
  if((typeof value!=='number' && typeof value!=='string') || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid identifier');
  return Number(value);
}
function createEditorRouter(db,{archive,sourceRegistry,htmlExtraction,pdfExtraction,budgetLimits={dailyMicros:0,monthlyMicros:0},
  budgetGuard=null,clock=Date.now}={}) {
  const router=express.Router();
  router.get('/claims/:id/publication-state',publicationRoute((req,res)=>{
    const state=publication.publicationHeadState(db,{claimId:publicationId(req.params.id),actorId:req.userId});
    res.json({claimId:state.claimId,head:state.head?{generation:state.head.generation,
      eventId:state.head.eventId,state:state.head.state}:null,
      isPublicationOwner:state.isPublicationOwner});
  }));
  router.get('/analysis-versions/:id/publication-state',publicationRoute((req,res)=>{
    if(Object.keys(req.query).length!==1||typeof req.query.reportId!=='string')
      throw Object.assign(new Error('Invalid publication query'),{code:'invalid_request'});
    const state=publication.publicationVersionState(db,{analysisVersionId:publicationId(req.params.id),
      reportId:publicationId(req.query.reportId),actorId:req.userId});
    res.json({analysisVersionId:state.analysisVersionId,claimId:state.claimId,
      preview:state.preview,draftSha256:state.draftSha256,reportSha256:state.reportSha256,
      checkedVersionHash:state.checkedVersionHash,dtoSha256:state.dtoSha256,
      dependencySha256:state.dependencySha256,latestReview:state.latestReview?{
        id:state.latestReview.id,decision:state.latestReview.decision,
        occurredAtMs:state.latestReview.occurredAtMs}:null,
      head:state.head?{generation:state.head.generation,eventId:state.head.eventId,
        state:state.head.state}:null,isPublicationOwner:state.isPublicationOwner});
  }));
  router.post('/analysis-versions/:id/publication-reviews',publicationRoute((req,res)=>{
    publicationBody(req.body,['reportId','expectedDraftSha256','expectedReportSha256',
      'expectedCheckedVersionHash','expectedDtoSha256','expectedReviewEventId',
      'decision','reason','requestKey']);
    const body=req.body;
    const row=publication.approveVersion(db,{analysisVersionId:publicationId(req.params.id),
      reportId:body.reportId,expectedDraftSha256:body.expectedDraftSha256,
      expectedReportSha256:body.expectedReportSha256,
      expectedCheckedVersionHash:body.expectedCheckedVersionHash,
      expectedDtoSha256:body.expectedDtoSha256,
      expectedReviewEventId:body.expectedReviewEventId,decision:body.decision,
      reason:body.reason,requestKey:body.requestKey,actorId:req.userId,now:clock()});
    res.status(201).json({review:publicationReviewView(row)});
  }));
  router.post('/analysis-versions/:id/publication-actions',publicationRoute((req,res)=>{
    publicationBody(req.body,['action','reviewEventId','expectedDraftSha256',
      'expectedReportSha256','expectedCheckedVersionHash','expectedDtoSha256',
      'expectedGeneration','expectedHeadEventId','reason','requestKey']);
    const body=req.body;
    if(!['publish','correct'].includes(body.action))
      throw Object.assign(new Error('Invalid publication action'),{code:'invalid_request'});
    const input={analysisVersionId:publicationId(req.params.id),reviewEventId:body.reviewEventId,
      expectedDraftSha256:body.expectedDraftSha256,
      expectedReportSha256:body.expectedReportSha256,
      expectedCheckedVersionHash:body.expectedCheckedVersionHash,
      expectedDtoSha256:body.expectedDtoSha256,
      expectedGeneration:body.expectedGeneration,expectedHeadEventId:body.expectedHeadEventId,
      reason:body.reason,requestKey:body.requestKey,actorId:req.userId,now:clock()};
    const row=body.action==='publish'?publication.publishVersion(db,input):publication.correctVersion(db,input);
    res.status(201).json({event:publicationEventView(row)});
  }));
  router.post('/claims/:id/publication-retraction',publicationRoute((req,res)=>{
    publicationBody(req.body,['expectedGeneration','expectedHeadEventId','reason','requestKey']);
    const body=req.body;
    const row=publication.retractVersion(db,{claimId:publicationId(req.params.id),
      expectedGeneration:body.expectedGeneration,expectedHeadEventId:body.expectedHeadEventId,
      reason:body.reason,requestKey:body.requestKey,actorId:req.userId,now:clock()});
    res.status(201).json({event:publicationEventView(row)});
  }));
  router.get('/claims/:id/analysis-versions',(req,res)=>{
    const claimId=id(req.params.id),after=analysisAfter(req.query);
    if(!db.prepare('SELECT id FROM research_claims WHERE id=?').get(claimId))return res.status(404).json({error:'Claim not found'});
    const rows=db.prepare(`SELECT id,claim_id,claim_context_version_id,packet_version,draft_sha256,
      model_version,prompt_version,actor_id,created_at_ms FROM analysis_versions
      WHERE claim_id=? AND id>? ORDER BY id LIMIT 100`).all(claimId,after);
    res.json({items:rows.map(analysisView.versionMetadata)});
  });
  router.post('/claims/:id/analysis-versions',(req,res)=>{
    const claimId=id(req.params.id);
    if(!exactBody(req.body,['draft']))analysisBad();
    analysisView.validateDraftTree(req.body.draft);
    if(!db.prepare('SELECT id FROM research_claims WHERE id=?').get(claimId))return res.status(404).json({error:'Claim not found'});
    const hash=analysisView.draftHash(req.body.draft);
    const prior=db.prepare('SELECT id FROM analysis_versions WHERE claim_id=? AND draft_sha256=?').get(claimId,hash);
    const version=saveAnalysisVersion(db,{claimId,actorId:req.userId,draft:req.body.draft,now:clock()});
    res.status(prior?200:201).json({version:analysisView.versionMetadata(version),draft:version.draft});
  });
  router.get('/analysis-versions/:id',(req,res)=>{
    const versionId=id(req.params.id);
    if(!db.prepare('SELECT id FROM analysis_versions WHERE id=?').get(versionId))return res.status(404).json({error:'Analysis version not found'});
    const version=loadAnalysisVersion(db,versionId);
    res.json({version:analysisView.versionMetadata(version),draft:version.draft});
  });
  router.get('/analysis-versions/:id/verification-jobs',(req,res)=>{
    const versionId=id(req.params.id),after=analysisAfter(req.query);
    if(!db.prepare('SELECT id FROM analysis_versions WHERE id=?').get(versionId))return res.status(404).json({error:'Analysis version not found'});
    const rows=db.prepare(`SELECT id,analysis_version_id,policy_version,decision_model,admission_hash,
      state,attempts,max_attempts,enqueued_by,enqueued_at_ms,task_deadline_at_ms,retry_ready_at_ms,
      lease_until_ms,dispatch_started_at_ms,report_id,last_error FROM analysis_verification_jobs
      WHERE analysis_version_id=? AND id>? ORDER BY id LIMIT 100`).all(versionId,after);
    res.json({items:rows.map(row=>({job:analysisView.jobMetadata(row),
      permission:analysisView.permissionMetadata(analysisView.latestPermission(db,row.id))}))});
  });
  router.post('/analysis-versions/:id/verification-jobs',(req,res)=>{
    const versionId=id(req.params.id);
    if(!exactBody(req.body,['maxAttempts','deadlineMs']))analysisBad();
    if(!db.prepare('SELECT id FROM analysis_versions WHERE id=?').get(versionId))return res.status(404).json({error:'Analysis version not found'});
    const version=loadAnalysisVersion(db,versionId),hash=admissionHash(version);
    const prior=db.prepare(`SELECT id FROM analysis_verification_jobs WHERE analysis_version_id=? AND
      policy_version=? AND decision_model=? AND admission_hash=?`).get(versionId,POLICY.version,POLICY.decisionModel,hash);
    const job=enqueueVerificationJob(db,{analysisVersionId:versionId,actorId:req.userId,
      maxAttempts:req.body.maxAttempts,deadlineMs:req.body.deadlineMs,now:clock()});
    res.status(prior?200:201).json({job:analysisView.jobMetadata(job),
      permission:analysisView.permissionMetadata(analysisView.latestPermission(db,job.id))});
  });
  router.get('/analysis-verification-jobs/:id',(req,res)=>{
    const detail=analysisView.jobDetail(db,id(req.params.id));
    if(!detail)return res.status(404).json({error:'Analysis verification job not found'});
    res.json(detail);
  });
  router.post('/analysis-verification-jobs/:id/permission',(req,res)=>{
    const jobId=id(req.params.id);
    if(!exactBody(req.body,['allowed','reason','expectedEventId','expectedAdmissionHash']))analysisBad();
    authorizeVerificationJob(db,{jobId,actorId:req.userId,allowed:req.body.allowed,
      reason:req.body.reason,expectedEventId:req.body.expectedEventId,
      expectedAdmissionHash:req.body.expectedAdmissionHash,now:clock()});
    res.status(201).json(analysisView.jobDetail(db,jobId));
  });
  // The existing authenticated editor role is the operator authority. Never read actor from the body.
  router.get('/work-admission',(req,res)=>{
    res.set('Cache-Control','private, no-store');
    res.json(workAdmissionStatus(db,{now:clock(),guard:budgetGuard}));
  });
  for(const action of ['pause','resume'])router.post(`/work-admission/${action}`,(req,res)=>{
    try {
      const result=changeWorkAdmission(db,{actorId:req.userId,action,
        expectedVersion:req.body?.expectedVersion,reason:req.body?.reason,
        requestId:req.body?.requestId,now:clock()});
      res.set('Cache-Control','private, no-store');
      res.status(result.status==='recorded'?201:200).json({status:result.status,
        admission:workAdmissionStatus(db,{now:clock(),guard:budgetGuard})});
    } catch(error) {
      if(error.code?.startsWith('SQLITE_'))throw error;
      const conflict=/conflict|changed/i.test(error.message);
      res.status(conflict?409:400).json({error:conflict?'Work admission request conflicts with current state':'Invalid work admission request'});
    }
  });
  router.get('/provider-queue',(req,res)=>{
    res.set('Cache-Control','private, no-store');
    const state=db.prepare('SELECT paused_at,reason,pause_version FROM provider_queue_state WHERE id=1').get();
    res.json({pausedAt:state.paused_at,reason:state.reason,pauseVersion:state.pause_version});
  });
  router.post('/provider-queue/recover',(req,res)=>{
    try {
      const {reason,requestId,expectedPauseVersion,expectedPausedAt,expectedReason,afterJobId}=req.body||{};
      const result=recoverProviderQueue(db,{actorId:req.userId,reason,requestId,expectedPauseVersion,
        expectedPausedAt,expectedReason,afterJobId,now:clock()});
      res.set('Cache-Control','private, no-store');
      res.status(result.status==='already_recorded'?200:201).json(result);
    }catch(error) {
      if(error.code?.startsWith('SQLITE_'))throw error;
      const conflict=/changed|conflict|batch exceeds|charge reconciliation/i.test(error.message);
      res.status(conflict?409:400).json({error:conflict?'Provider recovery conflicts with current state':'Invalid provider recovery'});
    }
  });
  router.get('/budget',(req,res)=>{
    try {
      const cursor=name=>req.query[name]===undefined?Number.MAX_SAFE_INTEGER:id(req.query[name]);
      const limit=req.query.limit===undefined?50:id(req.query.limit);
      res.set('Cache-Control','private, no-store');
      res.json(budgetOps.view(db,budgetLimits,new Date(clock()).toISOString(),{
        beforeReservationId:cursor('beforeReservationId'),beforeUnresolvedId:cursor('beforeUnresolvedId'),
        beforeAlertId:cursor('beforeAlertId'),beforeLateHoldId:cursor('beforeLateHoldId'),limit,guard:budgetGuard}));
    } catch(error) {res.status(400).json({error:'Invalid budget page'});}
  });
  router.post('/budget/policy',(req,res)=>{
    try {
      if(req.body?.effectiveAt!==undefined)return res.status(400).json({error:'Policy time is server controlled'});
      const result=budgetOps.appendPolicy(db,{actorId:req.userId,requestId:req.body?.requestId,
        reason:req.body?.reason,policy:req.body?.policy,clock},budgetLimits);
      if(result.status==='clock_rollback')return res.status(409).json({error:'Budget clock moved backward'});
      res.status(result.status==='recorded'?201:200).json(result);
    } catch(error) {
      if(error.code?.startsWith('SQLITE_'))throw error;
      res.status(/conflict/i.test(error.message)?409:400).json({error:/conflict/i.test(error.message)?
        'Budget policy request conflicts with an existing event':'Invalid budget policy'});
    }
  });
  router.post('/budget/reconcile',(req,res)=>{
    try {
      const result=budgetOps.reconcileUnknown(db,{reservationId:req.body?.reservationId,status:req.body?.status,
        actualMicros:req.body?.actualMicros,actorId:req.userId,reason:req.body?.reason,
        requestId:req.body?.requestId,clock});
      if(result.status==='clock_rollback')return res.status(409).json({error:'Budget clock moved backward'});
      res.status(result.status==='recorded'?201:200).json(result);
    } catch(error) {
      if(error.code?.startsWith('SQLITE_'))throw error;
      res.status(/conflict|latest unknown|recoverable|must be recovered/i.test(error.message)?409:400).json({error:/conflict|latest unknown|recoverable|must be recovered/i.test(error.message)?
        'Charge reconciliation conflicts with current state':'Invalid charge reconciliation'});
    }
  });
  router.post('/budget/recover',(req,res)=>{
    try {
      const result=budgetOps.recoverExpired(db,{reservationId:req.body?.reservationId,actorId:req.userId,
        reason:req.body?.reason,requestId:req.body?.requestId,clock});
      if(result.status==='clock_rollback')return res.status(409).json({error:'Budget clock moved backward'});
      res.status(result.status==='recorded'?201:200).json(result);
    } catch(error) {
      if(error.code?.startsWith('SQLITE_'))throw error;
      res.status(/conflict|recoverable/i.test(error.message)?409:400).json({error:/conflict|recoverable/i.test(error.message)?
        'Attempt recovery conflicts with current state':'Invalid attempt recovery'});
    }
  });
  router.post('/budget/late-hold/resolve',(req,res)=>{
    try {
      const result=budgetOps.resolveLateHold(db,{holdId:req.body?.holdId,status:req.body?.status,
        actualMicros:req.body?.actualMicros,actorId:req.userId,reason:req.body?.reason,
        requestId:req.body?.requestId,clock});
      if(result.status==='clock_rollback')return res.status(409).json({error:'Budget clock moved backward'});
      res.status(result.status==='recorded'?201:200).json(result);
    } catch(error) {
      if(error.code?.startsWith('SQLITE_'))throw error;
      const conflict=/conflict|already resolved|unavailable/i.test(error.message);
      res.status(conflict?409:400).json({error:conflict?'Late hold resolution conflicts with current state':
        'Invalid late hold resolution'});
    }
  });
  router.post('/budget/guard/restore',(req,res)=>{
    try {
      const result=budgetOps.restoreGuardExposure(db,budgetGuard,{reservationId:req.body?.reservationId,
        actorId:req.userId,reason:req.body?.reason,requestId:req.body?.requestId,clock});
      if(result.status==='clock_rollback')return res.status(409).json({error:'Budget clock moved backward'});
      res.status(result.status==='recorded'?201:200).json(result);
    } catch(error) {
      if(error.code?.startsWith('SQLITE_'))throw error;
      res.status(/conflict|tripped|finalized/i.test(error.message)?409:400).json({error:'Budget guard restoration unavailable'});
    }
  });
  router.post('/budget/guard/rearm',(req,res)=>{
    try {
      const result=budgetOps.rearmGuard(db,budgetGuard,{actorId:req.userId,reason:req.body?.reason,
        requestId:req.body?.requestId,clock});
      if(result.status==='clock_rollback')return res.status(409).json({error:'Budget clock moved backward'});
      res.status(result.status==='recorded'?201:200).json(result);
    } catch(error) {
      if(error.code?.startsWith('SQLITE_'))throw error;
      res.status(/conflict|intervention|restored|rearm/i.test(error.message)?409:400).json({error:'Budget guard rearm unavailable'});
    }
  });
  // Mount only behind session + editor middleware; identity comes from req.userId.
  router.get('/extractions/:id',(req,res)=>{
    const extraction=getExtraction(db,id(req.params.id));
    if(!extraction) return res.status(404).json({error:'Extraction not found'});
    res.json(extraction);
  });
  router.get('/extractions/:id/original',async(req,res)=>{
    if(!archive) return res.status(503).json({error:'Original storage is not configured'});
    const extraction=getExtraction(db,id(req.params.id));
    if(!extraction) return res.status(404).json({error:'Extraction not found'});
    const original=db.prepare('SELECT * FROM original_objects WHERE sha256=?').get(extraction.original_sha256);
    if(!original) throw new Error('Original unavailable');
    const bytes=await archive.readOriginal(original);
    if(!Buffer.isBuffer(bytes)||bytes.length!==original.size||bytes.length>26214400||
      createHash('sha256').update(bytes).digest('hex')!==original.sha256) throw new Error('Original integrity failure');
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(req.userId)?.role!=='editor')
      return res.status(403).json({error:'Editor access is required'});
    // Never render an untrusted original as active HTML on the application's
    // origin. This authenticated download is private and not a public asset.
    res.set({'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff',
      'Content-Disposition':`attachment; filename="original-${original.sha256}.bin"`,
      'Cache-Control':'private, no-store','Content-Security-Policy':"sandbox; default-src 'none'"});
    res.send(bytes);
  });
  router.post('/extractions/:id/reviews',(req,res)=>{
    const {expectedManifestSha256,expectedEventId,decision,originalCompared,reason}=req.body||{};
    res.status(201).json(recordExtractionReview(db,{extractionId:id(req.params.id),actorId:req.userId,
      expectedManifestSha256,expectedEventId,decision,originalCompared,reason}));
  });
  router.get('/extractions/:id/renders/:page',async(req,res)=>{
    if(!archive)return res.status(503).json({error:'Private storage is not configured'});
    const extraction=getExtraction(db,id(req.params.id)),page=id(req.params.page);
    if(!extraction)return res.status(404).json({error:'Extraction not found'});
    const render=db.prepare('SELECT * FROM extraction_renders WHERE extraction_id=? AND page=?').get(extraction.id,page);
    if(!render)return res.status(404).json({error:'Rendered page not found'});
    const reference=extraction.manifest.renders?.find(r=>r.page===page);
    if(!reference||reference.sha256!==render.sha256||reference.size!==render.size||reference.key!==render.key)
      throw new Error('Rendered page manifest mismatch');
    const bytes=await archive.readOriginal(render);
    if(!Buffer.isBuffer(bytes)||bytes.length!==render.size||bytes.length>8388608||
      createHash('sha256').update(bytes).digest('hex')!==render.sha256)throw new Error('Rendered page integrity failure');
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(req.userId)?.role!=='editor')
      return res.status(403).json({error:'Editor access is required'});
    res.set({'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store',
      'Content-Disposition':`inline; filename="page-${page}.png"`,'Content-Security-Policy':"sandbox; default-src 'none'"});
    res.send(bytes);
  });
  router.get('/fetch-jobs/:id',(req,res)=>{
    const jobId=id(req.params.id);
    const job=db.prepare(`SELECT ${fetchFields} FROM fetch_jobs WHERE id=?`).get(jobId);
    if(!job) return res.status(404).json({error:'Fetch job not found'});
    const receipt=db.prepare(`SELECT id,url,final_url,status,retrieved_at,sha256,mime,size,retention,redirects_json
      FROM fetch_receipts WHERE job_id=?`).get(jobId);
    const extractionAvailable=Boolean(archive&&receipt?.retention==='private'&&
      (receipt.mime==='text/plain'||(receipt.mime==='text/html'&&htmlExtraction)||(receipt.mime==='application/pdf'&&pdfExtraction)));
    res.json({job,extractionAvailable,receipt:receipt?{...receipt,redirects:JSON.parse(receipt.redirects_json),redirects_json:undefined}:null});
  });
  router.post('/fetch-jobs/:id/extract',async(req,res)=>{
    if(!archive) return res.status(503).json({error:'Original storage is not configured'});
    const jobId=id(req.params.id);
    if(!db.prepare('SELECT id FROM fetch_jobs WHERE id=?').get(jobId)) return res.status(404).json({error:'Fetch job not found'});
    const receipt=db.prepare('SELECT id,mime,retention FROM fetch_receipts WHERE job_id=?').get(jobId);
    if(!receipt) return res.status(409).json({error:'Download has not completed'});
    if(receipt.retention!=='private'||!['text/plain','text/html','application/pdf'].includes(receipt.mime))
      return res.status(422).json({error:'Extraction requires a supported privately stored original'});
    if(receipt.mime==='text/html'||receipt.mime==='application/pdf') {
      const pdf=receipt.mime==='application/pdf';
      const extractionService=pdf?pdfExtraction:htmlExtraction;
      if(!extractionService) return res.status(503).json({error:pdf?'PDF extraction is not enabled':'HTML extraction is not enabled'});
      const controller=new AbortController(),abort=()=>controller.abort();
      req.once('aborted',abort);res.once('close',abort);
      if(req.aborted||res.destroyed) controller.abort();
      try {
        const method=pdf?'extractReceipt':'extract';
        const document=await extractionService[method]({receiptId:receipt.id,actorId:req.userId},{signal:controller.signal});
        if(!controller.signal.aborted) res.status(201).json(document);
      } catch(error) {if(!res.destroyed) throw error;}
      finally {req.removeListener('aborted',abort);res.removeListener('close',abort);}
    } else res.status(201).json(await extractFetchText(db,{receiptId:receipt.id,actorId:req.userId},archive));
  });
  router.get('/topics/:id/fetch-jobs',(req,res)=>{
    const topicId=id(req.params.id),after=req.query.after===undefined?0:id(req.query.after);
    if(!db.prepare('SELECT id FROM research_topics WHERE id=?').get(topicId)) return res.status(404).json({error:'Topic not found'});
    res.json({items:db.prepare(`SELECT ${fetchFields} FROM fetch_jobs WHERE topic_id=? AND id>? ORDER BY id LIMIT 100`).all(topicId,after)});
  });
  router.post('/topics/:id/fetch-jobs',(req,res)=>{
    if(!sourceRegistry) return res.status(503).json({error:'Source ingestion is not configured'});
    const topicId=id(req.params.id);
    if(!db.prepare('SELECT id FROM research_topics WHERE id=?').get(topicId)) return res.status(404).json({error:'Topic not found'});
    const {sourceId,url}=req.body||{};
    try {
      const job=enqueueFetchJob(db,{topicId,actorId:req.userId,sourceId,url,registry:sourceRegistry});
      res.status(201).json(db.prepare(`SELECT ${fetchFields} FROM fetch_jobs WHERE id=?`).get(job.id));
    } catch(error) {
      if(error.code?.startsWith('SQLITE_')) throw error;
      res.status(400).json({error:'Invalid or unapproved source submission'});
    }
  });
  router.get('/topics/:id/claims',(req,res)=>{
    const topicId=id(req.params.id),after=req.query.after===undefined?0:id(req.query.after);
    if(!db.prepare('SELECT id FROM research_topics WHERE id=?').get(topicId)) return res.status(404).json({error:'Topic not found'});
    const rows=db.prepare('SELECT * FROM research_claims WHERE topic_id=? AND id>? ORDER BY id LIMIT 100').all(topicId,after);
    res.json({items:rows.map(row=>({...row,state:getClaimState(db,row.id)}))});
  });
  router.get('/topics/:id/documents',(req,res)=>{
    const topicId=id(req.params.id),after=req.query.after===undefined?0:id(req.query.after);
    if(!db.prepare('SELECT id FROM research_topics WHERE id=?').get(topicId)) return res.status(404).json({error:'Topic not found'});
    res.json({items:db.prepare(`SELECT d.*,s.title,s.url,s.source,s.published_at FROM research_documents d
      JOIN research_topic_documents t ON t.document_id=d.id JOIN source_items s ON s.id=d.source_id
      WHERE t.topic_id=? AND d.id>? ORDER BY d.id LIMIT 100`).all(topicId,after)});
  });
  router.get('/claims/:id/jobs',(req,res)=>{
    const claimId=id(req.params.id),after=req.query.after===undefined?0:id(req.query.after);
    if(!db.prepare('SELECT id FROM research_claims WHERE id=?').get(claimId)) return res.status(404).json({error:'Claim not found'});
    const rows=db.prepare('SELECT * FROM claim_jobs WHERE claim_id=? AND id>? ORDER BY id LIMIT 100').all(claimId,after);
    res.json({items:rows.map(({lease_token,...row})=>row)});
  });
  router.post('/claims/:id/jobs',(req,res)=>{
    const {passageId,contextVersionId}=req.body || {};
    const {lease_token,...visible}=enqueueClaimJob(db,{claimId:id(req.params.id),passageId:id(passageId),contextVersionId,
      stage:STAGE,model:'jev-1.13.0',questionVersion:'passage-v1',policyVersion:'passage-shadow-v1',now:clock()});
    res.status(201).json(visible);
  });
  router.get('/jobs/:id',(req,res)=>{
    const jobId=id(req.params.id);
    const job=db.prepare('SELECT * FROM claim_jobs WHERE id=?').get(jobId);
    if(!job) return res.status(404).json({error:'Job not found'});
    const {lease_token,...visible}=job;
    const saved=db.prepare(`SELECT d.*,r.result_json FROM claim_decisions d JOIN model_call_results r
      ON r.reservation_id=d.reservation_id WHERE d.job_id=?`).get(jobId);
    const decision=saved?{id:saved.id,reservationId:saved.reservation_id,inputHash:saved.input_hash,
      policyVersion:saved.policy_version,createdAt:saved.created_at,
      currentEligibilityIssue:claimJobIneligibility(db,job),routing:JSON.parse(saved.routing_json),result:JSON.parse(saved.result_json)}:null;
    res.json({job:visible,input:prepareClaimEvaluation(db,jobId),permission:getProviderPermission(db,jobId),decision});
  });
  router.post('/jobs/:id/provider-permission',(req,res)=>{
    const {allowed,reason,expectedEventId,expectedInputHash}=req.body || {};
    const result=setProviderPermission(db,{jobId:id(req.params.id),actorId:req.userId,
      allowed,reason,expectedEventId,expectedInputHash,now:clock()});
    res.status(result.reason==='deadline_expired'?409:201).json(result);
  });
  router.get('/claims/:id/evidence-packet',(req,res)=>{
    const claimId=id(req.params.id);
    if(!db.prepare('SELECT id FROM research_claims WHERE id=?').get(claimId)) return res.status(404).json({error:'Claim not found'});
    res.json(buildEvidencePacket(db,claimId));
  });
  router.get('/claims/:id/relationships',(req,res)=>{
    const claimId=id(req.params.id),after=req.query.after===undefined?0:id(req.query.after);
    res.json({items:listClaimRelationships(db,claimId,after)});
  });
  router.post('/claims/:id/relationships',(req,res)=>{
    const {otherClaimId,type,reason,requestId}=req.body||{};
    res.status(201).json(appendClaimRelationship(db,{claimId:id(req.params.id),otherClaimId:id(otherClaimId),
      type,reason,requestId,actorId:req.userId}));
  });
  router.post('/claims/:id/relationships/:relationshipId/revoke',(req,res)=>{
    const claimId=id(req.params.id),relationshipId=id(req.params.relationshipId);
    const relationship=db.prepare('SELECT claim_id,other_claim_id FROM claim_relationships WHERE id=?').get(relationshipId);
    if(!relationship||![relationship.claim_id,relationship.other_claim_id].includes(claimId))
      return res.status(404).json({error:'Relationship not found'});
    const {reason,requestId}=req.body||{};
    res.status(201).json(revokeClaimRelationship(db,{relationshipId,actorId:req.userId,reason,requestId}));
  });
  router.post('/claims/:id/relationships/:relationshipId/correct',(req,res)=>{
    const claimId=id(req.params.id),relationshipId=id(req.params.relationshipId);
    const relationship=db.prepare('SELECT claim_id,other_claim_id FROM claim_relationships WHERE id=?').get(relationshipId);
    if(!relationship||![relationship.claim_id,relationship.other_claim_id].includes(claimId))
      return res.status(404).json({error:'Relationship not found'});
    const {otherClaimId,type,reason,requestId}=req.body||{};
    res.status(201).json(correctClaimRelationship(db,{relationshipId,claimId,otherClaimId:id(otherClaimId),
      type,actorId:req.userId,reason,requestId}));
  });
  router.get('/claims/:id/search-attempts',(req,res)=>{
    const claimId=id(req.params.id),after=req.query.after===undefined?0:id(req.query.after);
    res.json({items:listClaimSearchAttempts(db,claimId,after)});
  });
  router.post('/claims/:id/search-attempts',(req,res)=>{
    const {query,sourceUrl,outcome,note,requestId}=req.body||{};
    res.status(201).json(appendClaimSearchAttempt(db,{claimId:id(req.params.id),actorId:req.userId,
      query,sourceUrl:sourceUrl??null,outcome,note,requestId}));
  });
  router.get('/claims/:id/coverage-events',(req,res)=>{
    const claimId=id(req.params.id),after=req.query.after===undefined?0:id(req.query.after);
    res.json({items:listClaimCoverageEvents(db,claimId,after)});
  });
  router.post('/claims/:id/coverage-events',(req,res)=>{
    const {dimension,state,reason,expectedEventId,expectedContextVersionId,requestId}=req.body||{};
    res.status(201).json(appendClaimCoverageEvent(db,{claimId:id(req.params.id),actorId:req.userId,
      dimension,state,reason,expectedEventId,expectedContextVersionId,requestId}));
  });
  router.get('/topics/:id/search',(req,res)=>{
    res.json(searchPassages(db,{topicId:id(req.params.id),query:req.query.q,
      limit:req.query.limit===undefined?30:id(req.query.limit)}));
  });
  router.post('/claims/:id/assessments',(req,res)=>{
    const {passageId,expectedVersionId,relevance,relation,evidenceType,rationale}=req.body || {};
    res.status(201).json(recordHumanAssessment(db,{claimId:id(req.params.id),actorId:req.userId,
      passageId:id(passageId),expectedVersionId,relevance,relation,evidenceType,rationale}));
  });
  router.get('/claims/:id/assessments',(req,res)=>{
    const claimId=id(req.params.id);
    if(!db.prepare('SELECT id FROM research_claims WHERE id=?').get(claimId)) return res.status(404).json({error:'Claim not found'});
    const after=req.query.after===undefined?0:id(req.query.after);
    res.json({items:listHumanAssessments(db,claimId,after)});
  });
  router.post('/documents/:id/passages',(req,res)=>{
    const documentId=id(req.params.id);
    if(!db.prepare('SELECT id FROM research_documents WHERE id=?').get(documentId)) return res.status(404).json({error:'Document not found'});
    const {start,end,locator}=req.body || {};
    res.status(201).json(addPassage(db,{documentId,start,end,locator}));
  });
  router.post('/documents/:id/source-chain/parents',(req,res)=>{
    const documentId=id(req.params.id),{parentId,reason}=req.body||{};
    res.status(201).json(linkSourceChain(db,{documentId,parentId:id(parentId),reason,actorId:req.userId}));
  });
  router.get('/documents/:id/passages',(req,res)=>{
    const documentId=id(req.params.id);
    if(!db.prepare('SELECT id FROM research_documents WHERE id=?').get(documentId)) return res.status(404).json({error:'Document not found'});
    const after=req.query.after===undefined?0:id(req.query.after);
    res.json({items:db.prepare('SELECT * FROM research_passages WHERE document_id=? AND id>? ORDER BY id LIMIT 100').all(documentId,after)});
  });
  router.post('/documents/text',async(req,res)=>{
    if(!archive) return res.status(503).json({error:'Document archive is not configured'});
    const {topicId,source,url,title,text,kind,originChain,retrievedAt,publishedAt}=req.body || {};
    if(typeof text!=='string' || !text.trim() || text.length>1000000) throw new Error('Invalid text');
    const result=await importTextOriginal(db,{topicId:id(topicId),source,url,title,
      bytes:Buffer.from(text,'utf8'),kind,originChain,retrievedAt,publishedAt},archive);
    res.status(201).json(result);
  });
  router.get('/documents/:id',(req,res)=>{
    const document=db.prepare('SELECT * FROM research_documents WHERE id=?').get(id(req.params.id));
    if(!document) return res.status(404).json({error:'Document not found'});
    const source=db.prepare('SELECT * FROM source_items WHERE id=?').get(document.source_id);
    const originals=db.prepare(`SELECT o.* FROM original_objects o JOIN document_originals d
      ON d.sha256=o.sha256 WHERE d.document_id=? ORDER BY o.sha256`).all(document.id);
    res.json({document,source,originals,retrievals:listRetrievals(db,source.id),
      extractions:listDocumentExtractions(db,document.id),sourceChain:getSourceChain(db,document.id)});
  });
  router.get('/topics',(req,res)=>{
    const after=req.query.after===undefined?0:id(req.query.after);
    res.json({items:db.prepare('SELECT * FROM research_topics WHERE id>? ORDER BY id LIMIT 100').all(after)});
  });
  router.post('/topics',(req,res)=>{
    const {slug,title}=req.body || {};
    if(typeof slug==='string' && slug.length>200) throw new Error('Invalid slug');
    res.status(201).json(createTopic(db,slug,title));
  });
  router.post('/claims',(req,res)=>{
    const {topicId,original,attribution,originUrl,qualifiers}=req.body || {};
    res.status(201).json(proposeClaim(db,{topicId:id(topicId),original,attribution,originUrl,
      qualifiers,actorId:req.userId}));
  });
  router.get('/claims/:id',(req,res)=>{
    const claimId=id(req.params.id);
    const claim=db.prepare('SELECT * FROM research_claims WHERE id=?').get(claimId);
    if(!claim) return res.status(404).json({error:'Claim not found'});
    res.json({claim,state:getClaimState(db,claimId),context:getClaimContext(db,claimId),
      research:projectClaimResearch(db,claimId)});
  });
  router.post('/claims/:id/retrieval-runs',(req,res)=>{
    const {queryVariants,limit,requestId,expectedContextVersionId}=req.body||{};
    if(!Number.isSafeInteger(expectedContextVersionId)||expectedContextVersionId<1||
      typeof requestId!=='string')
      return res.status(400).json({code:'retrieval_invalid',error:'Invalid retrieval request'});
    try {
      const result=retrieveCandidates({claimId:id(req.params.id),queryVariants,limit,requestId,
        expectedContextVersionId,actorId:req.userId},db);
      res.status(201).json(result);
    } catch(error) {
      if(error.code==='retrieval_stale'||error.code==='retrieval_conflict')
        return res.status(409).json({code:error.code,error:'Retrieval request conflicts with current state'});
      if(error.code==='retrieval_ineligible')
        return res.status(409).json({code:error.code,error:'Claim is unavailable for retrieval'});
      if(error.code==='retrieval_invalid')
        return res.status(400).json({code:error.code,error:'Invalid retrieval request'});
      if(error.code==='retrieval_resource')
        return res.status(422).json({code:error.code,error:'Retrieval resource limit exceeded'});
      throw error;
    }
  });
  router.post('/claims/:id/events',(req,res)=>{
    const {type,reason,expectedEventId,supersedesId}=req.body || {};
    res.status(201).json(appendClaimEvent(db,{claimId:id(req.params.id),actorId:req.userId,type,reason,expectedEventId,supersedesId}));
  });
  router.post('/claims/:id/context',(req,res)=>{
    const {expectedVersionId,normalizedWording,observedAt,entities,timeframe,location,reason}=req.body || {};
    res.status(201).json(appendClaimContext(db,{claimId:id(req.params.id),actorId:req.userId,
      expectedVersionId,normalizedWording,observedAt,entities,timeframe,location,reason}));
  });
  router.use((error,req,res,next)=>{
    if(error.code==='unknown_version'||error.code==='unknown_job')return res.status(404).json({error:'Analysis record not found'});
    if(['permission_conflict','job_settled','version_changed','version_conflict'].includes(error.code))
      return res.status(409).json({error:'Analysis request conflicts with current state'});
    if(['invalid_draft_tree','invalid_draft','invalid_packet','version_mismatch','draft_too_large'].includes(error.code))
      return res.status(422).json({error:'Invalid analysis draft'});
    if(error.code==='analysis_bad_request'||error.code==='invalid_request')
      return res.status(400).json({error:'Invalid analysis request'});
    if(error.code==='editor_required')return res.status(403).json({error:'Editor access required'});
    if(error.code==='publication_owner_required')
      return res.status(403).json({error:'Publication owner access required'});
    if(['integrity','draft_integrity','report_conflict'].includes(error.code))
      return res.status(500).json({error:'Analysis record integrity failure'});
    if(error.code==='claim_proposal_conflict') return res.status(409).json({
      code:'claim_proposal_conflict',error:'Claim proposal conflicts with an existing claim'});
    if(error.code==='pdf_busy')return res.set('Retry-After','1').status(429).json({error:'PDF extraction is busy; retry shortly'});
    if(error.code==='pdf_stopped')return res.status(503).json({error:'PDF extraction is stopping'});
    if(error.code==='pdf_cancelled')return res.status(409).json({error:'PDF extraction was cancelled'});
    if(error.code==='html_busy') return res.set('Retry-After','1').status(429).json({error:'HTML extraction is busy; retry shortly'});
    if(error.code==='html_stopped') return res.status(503).json({error:'HTML extraction is stopping'});
    if(error.code==='html_cancelled') return res.status(409).json({error:'HTML extraction was cancelled'});
    if(/changed/.test(error.message)) return res.status(409).json({error:'Record changed; reload before reviewing'});
    if(/^(Invalid|Unknown|Unexpected|Claim already|Claim is not|Claim job unavailable)/.test(error.message) || error.code?.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(400).json({error:'Invalid research request'});
    }
    res.status(500).json({error:'Research operation failed'});
  });
  return router;
}
module.exports={createEditorRouter};

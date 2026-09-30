'use strict';

const {runJevCall}=require('../models/jev-call');
const {buildPassageRequest}=require('../models/jev');
const {passageQuestions,QUESTION_VERSION}=require('../models/questions');
const {DECISION_MODEL,POLICY_VERSION,DECISION_INSTRUCTIONS,hashDecisionRequest}=require('./verify');

const ORDER=['contradicts','supports','mentions_only','insufficient'];
const KEY=/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
function fail(code){throw Object.assign(new Error(`Assertion decision ${code}`),{code});}
function exact(value,names){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));}
function string(value,max){return typeof value==='string'&&value.length>0&&value.length<=max;}
function safeTime(value){return Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;}
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
function serialized(value){return JSON.stringify(stable(value));}
function validatedRelation(result){
  const questions=passageQuestions(),names=Object.keys(questions);
  if(!exact(result,['model','answers','usage','requestId','questionVersion'])||
    result.model!==DECISION_MODEL||result.questionVersion!==QUESTION_VERSION||
    !exact(result.answers,names)||!exact(result.usage,['input_tokens','output_tokens'])||
    !Number.isSafeInteger(result.usage.input_tokens)||result.usage.input_tokens<0||result.usage.input_tokens>64000||
    !Number.isSafeInteger(result.usage.output_tokens)||result.usage.output_tokens<0||result.usage.output_tokens>4096||
    !(result.requestId===null||string(result.requestId,200)))fail('invalid_response');
  for(const [name,question] of Object.entries(questions)){
    const answer=result.answers[name],choices=Object.keys(question.criteria);
    if(!exact(answer,['type','choice','probabilities','confidence'])||answer.type!=='choice'||
      !choices.includes(answer.choice)||!exact(answer.probabilities,choices)||
      !Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)fail('invalid_response');
    const probabilities=Object.values(answer.probabilities);
    if(probabilities.some(value=>!Number.isFinite(value)||value<0||value>1)||
      Math.abs(probabilities.reduce((a,b)=>a+b,0)-1)>0.00001||
      answer.probabilities[answer.choice]<Math.max(...probabilities))fail('invalid_response');
  }
  return result.answers.relation.choice;
}
function validatedInput(request,options){
  if(!exact(request,['assertionId','task','untrustedEvidence','packetVersion','policyVersion','decisionModel'])||
    !string(request.assertionId,120)||!KEY.test(request.assertionId)||
    !exact(request.task,['kind','instructions'])||request.task.kind!=='assertion_relation'||
    request.task.instructions!==DECISION_INSTRUCTIONS||
    !exact(request.untrustedEvidence,['assertion','claim','passages'])||
    !string(request.untrustedEvidence.assertion,2000)||
    !exact(request.untrustedEvidence.claim,['wording','attribution','normalizedWording'])||
    !string(request.untrustedEvidence.claim.wording,16000)||
    !(request.untrustedEvidence.claim.attribution===null||string(request.untrustedEvidence.claim.attribution,4000))||
    !(request.untrustedEvidence.claim.normalizedWording===null||string(request.untrustedEvidence.claim.normalizedWording,16000))||
    !Array.isArray(request.untrustedEvidence.passages)||!request.untrustedEvidence.passages.length||
    request.untrustedEvidence.passages.length>100||
    !/^[a-f0-9]{64}$/.test(request.packetVersion)||
    request.policyVersion!==POLICY_VERSION||request.decisionModel!==DECISION_MODEL||
    !exact(options,['inputHash','signal','deadlineAt','requestKey','leaseGuard','preDispatch'])||
    !/^[a-f0-9]{64}$/.test(options.inputHash)||options.inputHash!==hashDecisionRequest(request)||
    !string(options.requestKey,150)||!KEY.test(options.requestKey)||
    !safeTime(options.deadlineAt)||typeof options.leaseGuard!=='function'||
    typeof options.preDispatch!=='function'||
    (options.signal!==undefined&&(!options.signal||typeof options.signal.aborted!=='boolean'||
      typeof options.signal.addEventListener!=='function')))fail('invalid_request');
  const seen=new Set(),inputs=[];
  for(const passage of request.untrustedEvidence.passages){
    if(!exact(passage,['id','quote','context','locator','extractionQuality','assessments'])||
      !Number.isSafeInteger(passage.id)||passage.id<1||seen.has(passage.id)||
      !string(passage.quote,16000)||!string(passage.context,20000)||
      !(passage.locator===null||string(passage.locator,1000))||
      passage.extractionQuality!=='accepted'||!Array.isArray(passage.assessments)||
      passage.assessments.length>20||passage.assessments.some(assessment=>
        !exact(assessment,['relevance','relation','evidenceType'])||
        !['direct','background','unrelated','uncertain'].includes(assessment.relevance)||
        !ORDER.includes(assessment.relation)||
        !['mention','allegation','testimony','finding','other','uncertain'].includes(assessment.evidenceType)))
      fail('invalid_request');
    seen.add(passage.id);
    const input={model:DECISION_MODEL,questionVersion:QUESTION_VERSION,
      claim:request.untrustedEvidence.assertion,
      passage:serialized(passage),
      context:serialized({claim:request.untrustedEvidence.claim,
        task:request.task,packetVersion:request.packetVersion,
        policyVersion:POLICY_VERSION,decisionModel:DECISION_MODEL})};
    buildPassageRequest(input);
    inputs.push({id:passage.id,input});
  }
  return inputs;
}
function settlement(db,reservationId){return db.prepare(`SELECT s.status,r.reserved_at FROM model_settlements s
  JOIN model_reservations r ON r.id=s.reservation_id WHERE s.reservation_id=?
  ORDER BY s.id DESC LIMIT 1`).get(reservationId)??null;}
function priorReservation(db,key){return db.prepare('SELECT id FROM model_reservations WHERE request_key=?').get(key)?.id??null;}
function typed(code){fail(/^[a-z_]{1,64}$/.test(code||'')?code:'provider_error');}
function createAssertionDecisionAdapter({db,client,limits,guard,clock=Date.now}){
  if(typeof db?.prepare!=='function'||typeof client?.evaluate!=='function'||
    typeof guard?.check!=='function'||typeof guard?.arm!=='function'||
    typeof guard?.disarm!=='function'||typeof clock!=='function'||!limits)
    fail('invalid_request');
  return Object.freeze({admission:'durable-budgeted-v1',async evaluate(request,options){
    const inputs=validatedInput(request,options);
    if(options.signal?.aborted)fail('aborted');
    if(clock()>=options.deadlineAt)fail('deadline_expired');
    const relations=[];
    for(const {id,input} of inputs){
      if(options.signal?.aborted)fail('aborted');
      if(clock()>=options.deadlineAt)fail('deadline_expired');
      options.leaseGuard({now:clock()});
      const baseKey=`${options.requestKey}:passage:${id}`;
      if(baseKey.length>185)fail('invalid_request');
      for(let attempt=1;attempt<=3;attempt++){
        options.leaseGuard({now:clock()});
        const key=attempt===1?baseKey:`${baseKey}:retry:${attempt}`;
        const existed=priorReservation(db,key)!==null;
        const call=await runJevCall(db,{requestKey:key,input,limits,guard,clock,
          signal:options.signal,attemptNumber:attempt,retryIdentity:baseKey,
          taskDeadlineAt:options.deadlineAt,preDispatch:options.preDispatch},client);
        if(call.status==='succeeded'||call.status==='cached'){
          if(settlement(db,call.reservationId)?.status!=='billed')fail('pending_reconciliation');
          relations.push({id,relation:validatedRelation(call.result)});
          break;
        }
        if(call.status==='pending_reconciliation')fail('pending_reconciliation');
        if(call.status!=='failed')typed(call.status);
        const bill=settlement(db,call.reservationId);
        if(bill===null||bill.status==='unknown')fail('pending_reconciliation');
        const retryable=(['provider_rate_limited','provider_overloaded','work_paused',
          'budget_guard_tripped','permission_required','lease_lost','provider_paused','aborted']
          .includes(call.errorCode)||(call.errorCode==='deadline_expired'&&clock()<options.deadlineAt))&&
          bill.status==='not_billed';
        if(!retryable||attempt===3)typed(call.errorCode);
        const observed=call.observedAtMs??Date.parse(bill.reserved_at);
        const delay=Math.max(1000*2**attempt,call.retryAfterMs??0);
        if(!existed||!safeTime(observed)||clock()<observed+delay)typed(call.errorCode);
      }
    }
    const relation=ORDER.find(choice=>relations.some(item=>item.relation===choice));
    return {assertionId:request.assertionId,relation,
      passageIds:relations.filter(item=>item.relation===relation).map(item=>item.id),
      modelVersion:DECISION_MODEL,policyVersion:POLICY_VERSION,inputHash:options.inputHash};
  }});
}
module.exports={createAssertionDecisionAdapter};

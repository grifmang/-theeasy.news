'use strict';

const {verifyAndRecordAnalysis}=require('./persistence');
const {POLICY,claimNextVerificationJob,gateAdapterCall,settleVerificationJob,
  completeVerificationJobInTransaction}=require('./jobs');

function safeClock(clock){const now=clock();if(!Number.isSafeInteger(now)||now<0||now>8640000000000000)
  throw new Error('Invalid worker clock');return now;}
function category(error){
  const code=error?.code;
  if(['work_paused','permission_required','version_changed','lease_lost','deadline_expired',
    'aborted','timeout','provider_paused','provider_auth','provider_rate_limited',
    'provider_overloaded','provider_configuration','provider_error','budget_guard_tripped',
    'pending_reconciliation','budget_exhausted','concurrency_exhausted','price_unavailable',
    'clock_rollback'].includes(code))return code;
  return 'provider_error';
}
async function runNextVerificationJob(db,{decisionAdapter,clock=Date.now,signal,leaseMs=30000}={}){
  if(decisionAdapter?.admission!=='durable-budgeted-v1'||
    typeof decisionAdapter.evaluate!=='function'||typeof clock!=='function')
    throw new Error('Invalid verification worker adapter admission');
  const job=claimNextVerificationJob(db,{now:safeClock(clock),leaseMs});
  if(!job)return null;
  const gatedAdapter={evaluate(request,options){
    gateAdapterCall(db,job,{now:safeClock(clock),leaseMs});
    return decisionAdapter.evaluate(request,{...options,
      requestKey:`analysis-verification-job:${job.id}:input:${options.inputHash}`,
      leaseGuard:({now})=>gateAdapterCall(db,job,{now,leaseMs,renew:true}),
      preDispatch:({now})=>gateAdapterCall(db,job,{now,leaseMs,dispatch:true})});
  }};
  try{
    const report=await verifyAndRecordAnalysis(db,{analysisVersionId:job.analysis_version_id,policy:POLICY},
      gatedAdapter,{clock,signal,deadlineAt:job.task_deadline_at_ms,
        commitGuard:(saved,now)=>completeVerificationJobInTransaction(db,job,saved,now)});
    return {jobId:job.id,state:'done',reportId:report.id};
  }catch(error){
    const code=category(error);
    const settled=settleVerificationJob(db,job,{now:safeClock(clock),error:code});
    return {jobId:job.id,state:settled?code:'lease_lost',reportId:null};
  }
}
module.exports={runNextVerificationJob};

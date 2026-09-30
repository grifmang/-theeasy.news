const {claimFetchJob,releaseFetchJob}=require('./fetch-jobs');
const {fetchDocument}=require('./fetch-document');
const {storeFetchReceipt}=require('./fetch-receipt');
const {isPaused}=require('../ops/work-admission');

// One bounded unit of work. Startup/scheduling is deliberately separate.
async function runNextFetch({db,registry,archive,signal,clock=Date.now,resolver,request}) {
  if(signal?.aborted) return {status:'stopped'};
  if(isPaused(db)) return {status:'work_paused'};
  const job=claimFetchJob(db,{registry,now:clock()});
  if(!job) return {status:'idle'};
  try {
    const continuation=job.continuation_json===null?undefined:JSON.parse(job.continuation_json);
    const result=await fetchDocument({db,registry,sourceId:job.source_policy_id,url:job.url,signal,continuation,job},
      {clock,resolver,request});
    if(signal?.aborted) throw Object.assign(new Error('Fetch interrupted'),{code:'aborted'});
    const receipt=await storeFetchReceipt(db,job,result,{registry,archive,clock});
    return {status:receipt?'fetched':'lease_or_access_lost',jobId:job.id};
  } catch(error) {
    const now=clock();
    const workPaused=error?.code==='work_paused';
    const pause=['rate_limited','upstream_backoff'].includes(error?.code)&&
      Number.isSafeInteger(error.retryAt)&&error.retryAt>now&&error.continuation;
    const code=workPaused?'work_paused':pause?error.code:['timeout','aborted'].includes(error?.code)?error.code:'fetch_failed';
    const retryAt=workPaused?now+1:pause?error.retryAt:now+Math.min(60000,1000*2**job.failures);
    const released=releaseFetchJob(db,job,{now,retryAt,code,...(pause||workPaused?{continuation:error.continuation}:{})});
    if(!released) return {status:'lease_or_access_lost',jobId:job.id};
    const state=db.prepare('SELECT state FROM fetch_jobs WHERE id=?').get(job.id).state;
    return {status:workPaused?'work_paused':pause?'deferred':state,jobId:job.id};
  }
}
module.exports={runNextFetch};

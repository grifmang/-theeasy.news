const {resolveTarget}=require('./network-target');
const {requestPinned}=require('./pinned-request');
const {readDocumentBody}=require('./document-body');
const {screenDocumentFormat}=require('./document-format');
const {reserveFetchSlot,deferFetchHost}=require('./fetch-admission');
const {isPaused}=require('../ops/work-admission');
const {createHash}=require('crypto');
const failure=(code)=>Object.assign(new Error('Document fetch rejected: '+code),{code});
const REDIRECTS=new Set([301,302,303,307,308]);

// Internal worker primitive. Not a public URL proxy. Source policy review and
// job admission/rate scheduling are required before exposing this to editors.
async function fetchDocument({db,registry,sourceId,url,signal,continuation,job},{resolver,request=requestPinned,clock=Date.now}={}) {
  if(!db || typeof db.prepare!=='function') throw failure('admission_store_required');
  const normalize=raw=>{
    registry.resolve(sourceId,raw);const parsed=new URL(raw);parsed.hash='';return parsed.href;
  };
  const original=normalize(url);
  let resumeUrl=original,resumeHistory=[];
  // Continuations are worker-owned state, never accepted from a public client.
  // Validate even persisted state so corrupt records cannot relax fetch policy.
  if(continuation!==undefined) {
    if(!continuation||!Array.isArray(continuation.redirects)||continuation.redirects.length>3) throw failure('invalid_continuation');
    resumeUrl=normalize(continuation.url);
    resumeHistory=continuation.redirects.map(hop=>{
      if(!hop||!REDIRECTS.has(hop.status)) throw failure('invalid_continuation');
      return {url:normalize(hop.url),status:hop.status};
    });
    if((resumeHistory.length?resumeHistory[0].url!==original:resumeUrl!==original)||
      new Set([...resumeHistory.map(hop=>hop.url),resumeUrl]).size!==resumeHistory.length+1) throw failure('invalid_continuation');
  }
  const controller=new AbortController();let timedOut=false,response;
  const cancel=()=>controller.abort();
  const abortError=()=>failure(timedOut?'timeout':'aborted');
  const check=()=>{if(controller.signal.aborted) throw abortError();};
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted) cancel();
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},15000);
  const interrupted=new Promise((resolve,reject)=>{
    if(controller.signal.aborted) return reject(abortError());
    controller.signal.addEventListener('abort',()=>{response?.destroy();reject(abortError());},{once:true});
  });
  const run=async()=>{
    let current=resumeUrl;const seen=new Set(resumeHistory.map(hop=>hop.url)),redirects=[...resumeHistory];
    for(let hop=redirects.length;;hop++) {
      check();
      const pause=()=>Object.assign(failure('work_paused'),{
        continuation:{url:current,redirects:redirects.map(item=>({...item}))}});
      if(isPaused(db)) throw pause();
      const policy=registry.resolve(sourceId,current);
      const parsed=new URL(current);parsed.hash='';current=parsed.href;
      if(seen.has(current)) throw failure('redirect_loop');
      seen.add(current);
      const hopNow=clock();
      const pendingHost=db.prepare('SELECT next_allowed_ms FROM source_fetch_limits WHERE host=?').get(parsed.hostname);
      if(pendingHost&&hopNow<pendingHost.next_allowed_ms) {
        throw Object.assign(failure('rate_limited'),{retryAt:pendingHost.next_allowed_ms,
          continuation:{url:current,redirects:redirects.map(hop=>({...hop}))}});
      }
      const target=await resolveTarget({registry,sourceId,url:current,signal:controller.signal},resolver);
      check();
      let pending,invocationError;
      db.transaction(()=>{
        if(isPaused(db))throw pause();
        if(job) {
          const sendNow=clock();
          const live=db.prepare(`SELECT * FROM fetch_jobs WHERE id=? AND state='leased'
            AND lease_token=? AND lease_until>?`).get(job.id,job.lease_token,sendNow);
          if(!live||live.source_policy_id!==sourceId||live.url!==original||
            db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(live.actor_id)?.role!=='editor')
            throw failure('lease_or_access_lost');
          const json=JSON.stringify({...policy,hosts:[...policy.hosts].sort(),mimeTypes:[...policy.mimeTypes].sort()});
          if(json!==live.policy_json||createHash('sha256').update(json).digest('hex')!==live.policy_hash)
            throw failure('source_policy_changed');
        }
        const admission=reserveFetchSlot(db,{host:parsed.hostname,requestsPerMinute:policy.requestsPerMinute,now:hopNow});
        if(!admission.allowed)throw Object.assign(failure('rate_limited'),{retryAt:admission.retryAt,
          continuation:{url:current,redirects:redirects.map(item=>({...item}))}});
        // requestPinned calls https.request and req.end synchronously before returning.
        // The promise is consumed only after SQLite commits this short send fence.
        try {pending=request({url:current,target,signal:controller.signal});}
        catch(error) {invocationError=error;}
      }).immediate();
      if(invocationError)throw invocationError?.code==='work_paused'?failure('fetch_failed'):invocationError;
      try {response=await pending;}
      catch(error) {throw error?.code==='work_paused'?failure('fetch_failed'):error;}
      if(controller.signal.aborted) {response.destroy();check();}
      const status=response.statusCode;
      if(status===429||status===503) {
        const retryAt=deferFetchHost(db,{host:parsed.hostname,now:clock(),retryAfter:response.headers?.['retry-after']});
        throw Object.assign(failure('upstream_backoff'),{retryAt,
          continuation:{url:current,redirects:redirects.map(hop=>({...hop}))}});
      }
      if(REDIRECTS.has(status)) {
        const location=response.headers?.location;response.destroy();response=null;
        if(hop>=3) throw failure('redirect_limit');
        if(typeof location!=='string'||!location||location.length>8192||/[\u0000-\u0020\u007f\\]/.test(location)) throw failure('invalid_redirect');
        let next;
        try {next=new URL(location,current).href;} catch {throw failure('invalid_redirect');}
        redirects.push({url:current,status});current=next;continue;
      }
      if(status!==200) throw failure('http_status');
      const metadata={};
      for(const key of ['content-type','etag','last-modified']) {
        const value=response.headers?.[key];
        if(typeof value==='string' && value.length<=4096 && !/[\r\n\0]/.test(value)) metadata[key]=value;
      }
      const body=await readDocumentBody(response,{mimeTypes:policy.mimeTypes,signal:controller.signal});
      check();
      screenDocumentFormat(body.bytes,body.mime);
      return {...body,finalUrl:current,status,headers:metadata,redirects};
    }
  };
  try {return await Promise.race([run(),interrupted]);}
  finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);response?.destroy();}
}
module.exports={fetchDocument};

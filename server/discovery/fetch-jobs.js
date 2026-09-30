const {createHash,randomUUID}=require('crypto');
const {isPaused}=require('../ops/work-admission');
const serializePolicy=policy=>JSON.stringify({...policy,hosts:[...policy.hosts].sort(),mimeTypes:[...policy.mimeTypes].sort()});
const policyHash=json=>createHash('sha256').update(json).digest('hex');
function enqueueFetchJob(db,{topicId,actorId,sourceId,url,registry}) {
  if(!Number.isSafeInteger(topicId)||topicId<1||!Number.isSafeInteger(actorId)||actorId<1) throw new Error('Invalid fetch owner');
  const policy=registry.resolve(sourceId,url);
  const normalized=new URL(url);normalized.hash='';
  const policyJson=serializePolicy(policy);
  const hash=policyHash(policyJson);
  return db.transaction(()=>{
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(actorId)?.role!=='editor') throw new Error('Editor required');
    if(!db.prepare('SELECT id FROM research_topics WHERE id=?').get(topicId)) throw new Error('Unknown topic');
    db.prepare(`INSERT INTO fetch_jobs(topic_id,actor_id,source_policy_id,policy_hash,policy_json,url)
      VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(topicId,actorId,sourceId,hash,policyJson,normalized.href);
    return db.prepare('SELECT * FROM fetch_jobs WHERE topic_id=? AND source_policy_id=? AND policy_hash=? AND url=?').get(topicId,sourceId,hash,normalized.href);
  }).immediate();
}
function claimFetchJob(db,{now=Date.now(),leaseMs=30000,registry}={}) {
  if(!registry||typeof registry.resolve!=='function') throw new Error('Live source registry required');
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>300000||!Number.isSafeInteger(now+leaseMs)) throw new Error('Invalid fetch lease');
  return db.transaction(()=>{
    if(isPaused(db))return null;
    db.prepare(`UPDATE fetch_jobs SET failures=failures+1,
      state=CASE WHEN failures+1>=max_failures THEN 'exhausted' ELSE 'retry_wait' END,
      lease_token=NULL,lease_until=NULL,last_error='lease_expired'
      WHERE state='leased' AND lease_until<=?`).run(now);
    db.prepare(`UPDATE fetch_jobs SET state='blocked',last_error='editor_revoked'
      WHERE state IN ('queued','retry_wait') AND NOT EXISTS
      (SELECT 1 FROM user_roles WHERE user_id=fetch_jobs.actor_id AND role='editor')`).run();
    const candidates=db.prepare("SELECT * FROM fetch_jobs WHERE state IN ('queued','retry_wait') AND next_attempt<=? AND failures<max_failures ORDER BY id LIMIT 100").all(now);
    for(const job of candidates) {
      let approved=false;
      try {
        const live=serializePolicy(registry.resolve(job.source_policy_id,job.url));
        approved=live===job.policy_json&&policyHash(live)===job.policy_hash;
      } catch { /* Withdrawn or malformed policy fails closed. */ }
      if(!approved) {
        db.prepare("UPDATE fetch_jobs SET state='blocked',last_error='source_policy_changed' WHERE id=?").run(job.id);
        continue;
      }
      db.prepare("UPDATE fetch_jobs SET state='leased',lease_token=?,lease_until=? WHERE id=?").run(randomUUID(),now+leaseMs,job.id);
      return db.prepare('SELECT * FROM fetch_jobs WHERE id=?').get(job.id);
    }
    return null;
  }).immediate();
}
// Internal worker transition; never accepts raw upstream error messages.
function releaseFetchJob(db,job,{now=Date.now(),retryAt,code,continuation}={}) {
  if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(retryAt)||retryAt<=now||
    typeof code!=='string'||!/^[a-z_]{1,64}$/.test(code)) throw new Error('Invalid fetch retry');
  const paused=code==='rate_limited'||code==='upstream_backoff'||code==='work_paused';
  return db.transaction(()=>{
    const current=code==='work_paused'?db.prepare("SELECT * FROM fetch_jobs WHERE id=? AND state='leased' AND lease_token=?")
      .get(job.id,job.lease_token):db.prepare("SELECT * FROM fetch_jobs WHERE id=? AND state='leased' AND lease_token=? AND lease_until>?")
      .get(job.id,job.lease_token,now);
    if(!current) return false;
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(current.actor_id)?.role!=='editor') {
      db.prepare("UPDATE fetch_jobs SET state='blocked',last_error='editor_revoked',lease_token=NULL,lease_until=NULL WHERE id=?").run(current.id);
      return false;
    }
    let saved=current.continuation_json;
    if((code==='work_paused'&&continuation!==undefined)||
      (code!=='work_paused'&&paused)) {
      const {createSourceRegistry}=require('./registry');
      const registry=createSourceRegistry([JSON.parse(current.policy_json)]);
      const normalize=raw=>{registry.resolve(current.source_policy_id,raw);const parsed=new URL(raw);parsed.hash='';return parsed.href;};
      if(!continuation||!Array.isArray(continuation.redirects)||continuation.redirects.length>3) throw new Error('Invalid continuation');
      const url=normalize(continuation.url);
      const redirects=continuation.redirects.map(hop=>{
        if(!hop||![301,302,303,307,308].includes(hop.status)) throw new Error('Invalid continuation');
        return {url:normalize(hop.url),status:hop.status};
      });
      if((redirects.length?redirects[0].url!==current.url:url!==current.url)||
        new Set([...redirects.map(hop=>hop.url),url]).size!==redirects.length+1) throw new Error('Invalid continuation');
      saved=JSON.stringify({url,redirects});
    } else if(continuation!==undefined) throw new Error('Unexpected continuation');
    const failures=current.failures+(paused?0:1);
    const state=failures>=current.max_failures?'exhausted':'retry_wait';
    db.prepare(`UPDATE fetch_jobs SET state=?,failures=?,next_attempt=?,last_error=?,continuation_json=?,
      lease_token=NULL,lease_until=NULL WHERE id=?`).run(state,failures,retryAt,code,saved,current.id);
    return true;
  }).immediate();
}
module.exports={enqueueFetchJob,claimFetchJob,releaseFetchJob};

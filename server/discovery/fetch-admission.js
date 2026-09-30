// Shared by all jobs/policies for a host. Reservation is never refunded after
// network failure: retries must wait as well. No sleeping or network activity.
function reserveFetchSlot(db,{host,requestsPerMinute,now}) {
  if(typeof host!=='string'||host.length>253||!host.includes('.')||
    !host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||
    !Number.isSafeInteger(requestsPerMinute)||requestsPerMinute<1||requestsPerMinute>60||
    !Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-60000) throw new Error('Invalid fetch reservation');
  const interval=Math.ceil(60000/requestsPerMinute);
  return db.transaction(()=>{
    const previous=db.prepare('SELECT next_allowed_ms FROM source_fetch_limits WHERE host=?').get(host);
    if(previous && now<previous.next_allowed_ms) return {allowed:false,retryAt:previous.next_allowed_ms};
    const retryAt=now+interval;
    db.prepare('INSERT INTO source_fetch_limits(host,next_allowed_ms) VALUES(?,?) ON CONFLICT(host) DO UPDATE SET next_allowed_ms=excluded.next_allowed_ms').run(host,retryAt);
    return {allowed:true,retryAt};
  }).immediate();
}
function deferFetchHost(db,{host,now,retryAfter}) {
  // Reuse admission validation without modifying reservations on this path.
  if(typeof host!=='string'||host.length>253||!host.includes('.')||
    !host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||
    !Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-86400000) throw new Error('Invalid fetch backoff');
  let delay=60000;
  if(typeof retryAfter==='string' && retryAfter.length<=128) {
    if(/^\d+$/.test(retryAfter)) delay=Math.min(Number(retryAfter)*1000,86400000);
    else if(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter)) {
      const until=Date.parse(retryAfter);if(Number.isFinite(until))delay=until-now;
    }
  }
  const retryAt=now+Math.max(1000,Math.min(delay,86400000));
  return db.transaction(()=>{
    db.prepare('INSERT INTO source_fetch_limits(host,next_allowed_ms) VALUES(?,?) ON CONFLICT(host) DO UPDATE SET next_allowed_ms=MAX(source_fetch_limits.next_allowed_ms,excluded.next_allowed_ms)').run(host,retryAt);
    return db.prepare('SELECT next_allowed_ms FROM source_fetch_limits WHERE host=?').get(host).next_allowed_ms;
  }).immediate();
}
module.exports={reserveFetchSlot,deferFetchHost};

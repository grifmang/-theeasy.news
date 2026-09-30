const {createHash}=require('crypto');
const {isIP}=require('net');
const {TextDecoder}=require('util');
const FIELDS=['timestamp','original','statuscode','mimetype','digest'];
const error=code=>Object.assign(new Error('Archive discovery unavailable'),{code});
function original(value) {
  if(typeof value!=='string'||value.length>8000||/[\u0000-\u0020\u007f\\*]/.test(value)||/%2a/i.test(value))
    throw error('archive_invalid_input');
  let url;try {url=new URL(value);} catch {throw error('archive_invalid_input');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||url.hash||
    isIP(url.hostname)||!url.hostname.includes('.')||!url.hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
    throw error('archive_invalid_input');
  return url.href;
}
function utc(value) {
  return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
}
function captureTime(value) {
  if(typeof value!=='string'||!/^\d{14}$/.test(value)) throw error('archive_invalid_response');
  const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}.000Z`;
  if(!utc(iso)) throw error('archive_invalid_response');
  return iso;
}

// Internal discovery only, not evidence intake or permission to disclose a URL.
// Caller must authorize the source URL first. No default network adapter: the
// approved transport must enforce pinned DNS, redirects, streaming byte limits,
// provider access policy and global rate/daily budgets. This module never saves
// pages, fetches replay resources, retries challenges, or claims completeness.
async function lookupCaptures({originalUrl,before,limit=20,signal},adapter) {
  const source=original(originalUrl);
  if(!utc(before)||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof adapter?.readCdx!=='function')
    throw error('archive_invalid_input');
  if(signal?.aborted) throw error('archive_cancelled');
  const url=new URL('https://web.archive.org/cdx/search/cdx');
  for(const [key,value] of Object.entries({url:source,matchType:'exact',output:'json',
    fl:FIELDS.join(','),filter:'statuscode:200',to:before.replace(/[-:T]/g,'').slice(0,14),limit:String(-limit),gzip:'false'}))
    url.searchParams.set(key,value);
  const controller=new AbortController(),cancel=()=>controller.abort();
  signal?.addEventListener('abort',cancel,{once:true});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},10000);
  let onAbort;
  try {
    const aborted=new Promise((resolve,reject)=>{
      onAbort=()=>reject(error(timedOut?'archive_timeout':'archive_cancelled'));
      controller.signal.addEventListener('abort',onAbort,{once:true});
    });
    const response=await Promise.race([Promise.resolve().then(()=>adapter.readCdx({url:url.href,signal:controller.signal,maxBytes:1048576})),aborted]);
    if(controller.signal.aborted) throw error(timedOut?'archive_timeout':'archive_cancelled');
    if(response?.status===429) throw error('archive_rate_limited');
    if(response?.status!==200) throw error('archive_provider_unavailable');
    if(!Buffer.isBuffer(response.body)||response.body.length>1048576) throw error('archive_invalid_response');
    let rows;try {rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.body));} catch {throw error('archive_invalid_response');}
    if(!Array.isArray(rows)||rows.length>limit+1) throw error('archive_invalid_response');
    if(!rows.length) return [];
    if(JSON.stringify(rows[0])!==JSON.stringify(FIELDS)) throw error('archive_invalid_response');
    const captures=new Map();
    for(const row of rows.slice(1)) {
      if(!Array.isArray(row)||row.length!==5||row.some(value=>typeof value!=='string')) throw error('archive_invalid_response');
      const [timestamp,rawOriginal,status,mime,digest]=row,capturedAt=captureTime(timestamp);
      let normalized;try {normalized=original(rawOriginal);} catch {throw error('archive_invalid_response');}
      if(normalized!==source||capturedAt>before||status!=='200'||!['text/html','text/plain','application/pdf'].includes(mime)) continue;
      if(digest!=='-'&&!/^[A-Z2-7]{32}$/.test(digest)) throw error('archive_invalid_response');
      const capture={provider:'wayback',originalUrl:source,
        archiveUrl:`https://web.archive.org/web/${timestamp}/${source}`,capturedAt,requestedBefore:before,
        captureTimeSource:'cdx_index',mime,archiveDigest:digest==='-'?null:digest,
        originChain:'fetch-url:'+createHash('sha256').update(source).digest('hex'),
        requiresReview:true,contentVerified:false};
      const previous=captures.get(capture.archiveUrl);
      if(previous&&JSON.stringify(previous)!==JSON.stringify(capture)) throw error('archive_invalid_response');
      captures.set(capture.archiveUrl,capture);
    }
    return [...captures.values()].sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    if(onAbort) controller.signal.removeEventListener('abort',onAbort);
  }
}
module.exports={lookupCaptures,normalizeArchiveOriginal:original,parseCaptureTimestamp:captureTime};

const {isIP}=require('net');
const MIME_TYPES=new Set(['text/html','text/plain','application/pdf']);
function validHost(host) {
  return typeof host==='string' && host.length<=253 && host===host.toLowerCase() &&
    !isIP(host) && host.includes('.') && !host.endsWith('.') &&
    host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

// Operator-supplied policy only. This registry performs no network requests.
// Host approval is NOT DNS/IP safety: the fetcher must validate and pin every hop.
function createSourceRegistry(entries) {
  if(!Array.isArray(entries)) throw new Error('Source policies must be an array');
  const policies=new Map();
  for(const entry of entries) {
    if(!entry || typeof entry.id!=='string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.id) ||
      policies.has(entry.id) || entry.accessReviewed!==true || entry.robotsReviewed!==true ||
      !['private','metadata-only'].includes(entry.retention) ||
      !Number.isSafeInteger(entry.requestsPerMinute) || entry.requestsPerMinute<1 || entry.requestsPerMinute>60 ||
      !Array.isArray(entry.hosts) || !entry.hosts.length || !entry.hosts.every(validHost) ||
      !Array.isArray(entry.mimeTypes) || !entry.mimeTypes.length || !entry.mimeTypes.every(mime=>MIME_TYPES.has(mime))) {
      throw new Error('Invalid or unapproved source policy');
    }
    policies.set(entry.id,Object.freeze({id:entry.id,
      hosts:Object.freeze([...new Set(entry.hosts)]),mimeTypes:Object.freeze([...new Set(entry.mimeTypes)]),
      retention:entry.retention,accessReviewed:true,robotsReviewed:true,requestsPerMinute:entry.requestsPerMinute}));
  }
  return Object.freeze({resolve(id,rawUrl) {
    const policy=policies.get(id);
    if(!policy || typeof rawUrl!=='string' || rawUrl.length>8192 || rawUrl!==rawUrl.trim() || /[\u0000-\u0020\u007f\\]/.test(rawUrl)) {
      throw new Error('Unapproved source target');
    }
    let url;
    try {url=new URL(rawUrl);} catch {throw new Error('Invalid source URL');}
    if(url.protocol!=='https:' || url.username || url.password || url.port ||
      !policy.hosts.includes(url.hostname)) throw new Error('Unapproved source target');
    return policy;
  }});
}
module.exports={createSourceRegistry};

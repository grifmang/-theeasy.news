const MAX_RETRY_AFTER_MS=300000;
function failure(code,details={}) {return Object.assign(new Error('Jev transport failed'),{code,...details});}
function requestId(headers) {
  const raw=headers?.get('x-request-id');
  return raw && /^[A-Za-z0-9_.:-]{1,200}$/.test(raw)?raw:null;
}
function retryAfterMs(headers,now=Date.now()) {
  const raw=headers?.get('retry-after');
  if(!raw || raw.length>64) return null;
  let ms;
  if(/^\d{1,9}$/.test(raw.trim())) ms=Number(raw.trim())*1000;
  else if(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw))
    ms=Date.parse(raw)-now;
  else return null;
  return Number.isFinite(ms)?Math.min(MAX_RETRY_AFTER_MS,Math.max(0,Math.ceil(ms))):null;
}
function createJevTransport({apiKey,fetchImpl=globalThis.fetch}) {
  if(typeof apiKey!=='string' || !apiKey || apiKey.length>4096 || /\s/.test(apiKey)) throw new Error('Valid server-side API key required');
  if(typeof fetchImpl!=='function') throw new Error('HTTP transport required');
  async function evaluate(request,{signal}={}) {
    if(signal?.aborted) throw failure('aborted');
    let payload;
    try {payload=JSON.stringify(request);} catch {throw failure('invalid_request');}
    if(!payload || request.model!=='jev-1.13.0' || Buffer.byteLength(payload)>24000) throw failure('invalid_request');
    const deadline=AbortSignal.timeout(10000);
    const activeSignal=signal?AbortSignal.any([signal,deadline]):deadline;
    let response;
    try {
      response=await fetchImpl('https://api.typesafe.ai/v1/systemone',{
        method:'POST',redirect:'error',signal:activeSignal,
        headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json',Accept:'application/json'},body:payload
      });
    } catch {throw failure(activeSignal.aborted?'aborted':'provider_network_error');}
    if(!response.ok) {
      try {await response.body?.cancel();} catch {}
      throw failure('provider_http_error',{status:Number.isInteger(response.status)?response.status:undefined,
        retryAfterMs:retryAfterMs(response.headers),requestId:requestId(response.headers)});
    }
    const mime=response.headers.get('content-type') || '';
    if(!/^application\/json(?:\s*;|$)/i.test(mime) || !response.body) {
      try {await response.body?.cancel();} catch {}
      throw failure('invalid_provider_response');
    }
    const reader=response.body.getReader();
    let size=0,body;
    const chunks=[];
    try {
      for(;;) {
        const {done,value}=await reader.read();if(done) break;
        size+=value.byteLength;
        if(size>65536) throw failure('invalid_provider_response');
        chunks.push(Buffer.from(value));
      }
      body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    } catch {
      try {await reader.cancel();} catch {}
      throw failure(activeSignal.aborted?'aborted':'invalid_provider_response');
    } finally {reader.releaseLock();}
    return {body,requestId:requestId(response.headers)};
  }
  return {evaluate};
}
module.exports={createJevTransport};

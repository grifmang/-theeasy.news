const https=require('https');
const failure=(code,message)=>Object.assign(new Error(message),{code});

// Internal primitive only: target must come from resolveTarget. Redirects and
// bounded body decoding belong to the fetch orchestrator, not to this function.
function requestPinned({url:rawUrl,target,signal},request=https.request) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) return reject(failure('aborted','Document request cancelled'));
    let url;
    try {url=new URL(rawUrl);} catch {return reject(failure('blocked_target','Invalid network target'));}
    if(!target || url.protocol!=='https:' || url.hostname!==target.hostname ||
      target.servername!==target.hostname || typeof target.lookup!=='function' ||
      url.port || url.username || url.password) return reject(failure('blocked_target','Invalid network target'));
    let req,response,closed=false;
    const cleanup=()=>{
      if(closed) return;
      closed=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
    };
    const fail=error=>{
      if(closed) return;
      cleanup();reject(error);
      response?.destroy(error);req?.destroy(error);
    };
    const onAbort=()=>fail(failure('aborted','Document request cancelled'));
    const timer=setTimeout(()=>fail(failure('timeout','Document request timed out')),15000);
    timer.unref();
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted) return onAbort();
    try {
      req=request({protocol:'https:',hostname:target.hostname,port:443,
        servername:target.servername,lookup:target.lookup,family:target.family,
        method:'GET',path:url.pathname+url.search,agent:false,rejectUnauthorized:true,
        maxHeaderSize:16384,headers:{accept:'text/html, text/plain, application/pdf',
          'accept-encoding':'gzip, deflate, br','user-agent':'EasyNewsResearch/1.0'}
      },incoming=>{
        if(closed) {incoming.destroy();return;}
        response=incoming;
        response.once('end',cleanup);response.once('close',cleanup);
        // A body consumer must still reject stream errors; this listener prevents
        // an unhandled error between headers arriving and consumer attachment.
        response.on('error',()=>{});
        resolve(response);
      });
      req.on('error',()=>fail(failure('fetch_failed','Document request failed')));
      req.end();
    } catch {fail(failure('fetch_failed','Document request failed'));}
  });
}
module.exports={requestPinned};

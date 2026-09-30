const {spawn}=require('child_process');
// Internal bounded JSON-worker lifecycle. Used by HTML extraction and the
// isolated PDF mapping preflight; native PDF tool stdout uses pdf-process.js.
function runHtmlProcess(bytes,{executable,args,cwd,signal}) {
  return new Promise((resolve,reject)=>{
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>26214400||signal?.aborted) return reject(new Error('Invalid or cancelled HTML extraction'));
    const child=spawn(executable,args,
      {cwd,stdio:['pipe','pipe','pipe'],windowsHide:true,env:{},shell:false});
    // The launcher rejects /dev/null stdio. Drain without retaining/logging
    // diagnostics, which may contain untrusted document content.
    child.stderr.resume();
    let settled=false,failed=false,total=0;const chunks=[];
    const finish=(error,result)=>{
      if(settled) return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      if(error) reject(new Error('HTML extraction rejected')); else resolve(result);
    };
    const cancel=()=>{
      if(settled||failed) return;
      failed=true;chunks.length=0;
      child.stdin.destroy();child.kill('SIGKILL');
      // Completion is fenced on close, not merely on the signal being sent.
    };
    const timer=setTimeout(cancel,5000);
    signal?.addEventListener('abort',cancel,{once:true});
    child.on('error',cancel);child.stdin.on('error',cancel);
    child.stdout.on('data',chunk=>{if(failed) return;total+=chunk.length;if(total>8388608) cancel();else chunks.push(chunk);});
    child.on('close',code=>{
      if(failed||code!==0) return finish(true);
      try {finish(false,JSON.parse(Buffer.concat(chunks).toString('utf8')));} catch {finish(true);}
    });
    if(signal?.aborted) return cancel();
    child.stdin.end(bytes);
  });
}
module.exports={runHtmlProcess};

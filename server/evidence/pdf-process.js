const {spawn}=require('child_process');
const path=require('path');

// INTERNAL lifecycle adapter. Caller must verify/seal the operator-owned bundle,
// admit concurrency, create private scratch, and remove scratch only after close.
// This does not establish trust in a bundle and is not an HTTP/API entry point.
function runPdfProcess(bytes,{launcher,runtime,scratch,tool,page,signal}={}) {
  return new Promise((resolve,reject)=>{
    const failure=()=>new Error('PDF process rejected');
    if(process.platform!=='linux'||process.arch!=='x64'||
      !Buffer.isBuffer(bytes)||bytes.length<5||bytes.length>26214400||
      (tool==='ocr'?bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
        bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(16)>4096||
        bytes.readUInt32BE(20)<1||bytes.readUInt32BE(20)>4096:bytes.subarray(0,5).toString('ascii')!=='%PDF-')||signal?.aborted||
      ![launcher,runtime,scratch].every(p=>typeof p==='string'&&path.isAbsolute(p)&&!p.includes('\0'))||
      !['info','text','render','ocr-render','ocr'].includes(tool)||
      (tool!=='info'&&(!Number.isSafeInteger(page)||page<1||page>200))) {
      reject(failure());return;
    }
    // No document filenames, passwords, caller-supplied flags or shell expansion.
    const commands={
      info:['pdfinfo','-'],
      text:['pdftotext','-f',String(page),'-l',String(page),'-bbox-layout','-','-'],
      render:['render','-f',String(page),'-l',String(page),'-scale-to','1600','-singlefile','-png','-'],
      'ocr-render':['render','-f',String(page),'-l',String(page),'-scale-to','4096','-singlefile','-png','-'],
      ocr:['tesseract','stdin','stdout','--tessdata-dir',path.join(runtime,'tessdata'),'-l','eng',
        '--dpi','300','--psm','3','-c','tessedit_create_tsv=1']
    };
    const [binary,...flags]=commands[tool];
    let child;
    try {
      child=spawn(launcher,[runtime,scratch,path.join(runtime,binary),...flags],
        {cwd:scratch,env:{},stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true});
    } catch {reject(failure());return;}
    const chunks=[];let total=0,failed=false,closed=false;
    const cancel=()=>{
      if(closed||failed)return;
      failed=true;chunks.length=0;
      child.stdin.destroy();child.kill('SIGKILL');
      // Never settle on kill alone: caller cleanup must wait for child close.
    };
    const timer=setTimeout(cancel,5000);
    signal?.addEventListener('abort',cancel,{once:true});
    child.on('error',cancel);
    child.stdin.on('error',cancel);
    child.stdout.on('error',cancel);
    child.stderr.on('error',cancel);
    // Diagnostics can contain private document text. Reject rather than record
    // warnings: exit0 alone previously hid missing fonts and blank rendering.
    child.stderr.on('data',cancel);
    child.stdout.on('data',chunk=>{
      if(failed)return;
      total+=chunk.length;
      if(total>8388608)cancel();else chunks.push(chunk);
    });
    child.on('close',(code,exitSignal)=>{
      closed=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      if(failed||code!==0||exitSignal||!total)return reject(failure());
      resolve(Buffer.concat(chunks,total));
    });
    if(signal?.aborted)cancel();else child.stdin.end(bytes);
  });
}

module.exports={runPdfProcess};

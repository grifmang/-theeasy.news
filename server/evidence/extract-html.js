const fs=require('fs');
const path=require('path');
const {verifyParserBundle}=require('./native/parser-bundle');
const {runHtmlProcess}=require('./html-process');

// Operator configuration only. Never accept bundle paths/digests from documents
// or request bodies. No unsandboxed fallback on any platform or kernel failure.
async function extractHtml(bytes,{signal,bundleDirectory,manifestSha256,scratchParent}={}) {
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>26214400||signal?.aborted)
    throw new Error('Invalid or cancelled HTML extraction');
  const sourceLength=new TextDecoder('utf-8',{fatal:true}).decode(bytes).length;
  if(process.platform!=='linux'||process.arch!=='x64') throw new Error('HTML sandbox unavailable');
  if(typeof scratchParent!=='string'||!path.isAbsolute(scratchParent)||!fs.lstatSync(scratchParent).isDirectory())
    throw new Error('HTML sandbox requires an absolute scratch directory');
  const bundle=verifyParserBundle({directory:bundleDirectory,expectedManifestSha256:manifestSha256});
  const parent=fs.realpathSync(scratchParent),runtime=fs.realpathSync(bundle.runtime);
  const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep);
  if(parent===path.parse(parent).root||overlaps(parent,runtime)||overlaps(runtime,parent))
    throw new Error('HTML scratch parent overlaps runtime');
  if(signal?.aborted) throw new Error('Cancelled HTML extraction');
  const scratch=fs.mkdtempSync(path.join(parent,'html-'));
  try {
    fs.chmodSync(scratch,0o700);
    const result=await runHtmlProcess(bytes,{signal,executable:bundle.launcher,cwd:scratch,
      args:[runtime,scratch,bundle.node,`--openssl-config=${path.join(runtime,'openssl.cnf')}`,
        '--jitless','--no-expose-wasm','--max-old-space-size=96','--max-semi-space-size=4',bundle.worker]});
    if(!result||typeof result.text!=='string'||!result.text.trim()||result.text.length>1000000||
      result.extractorVersion!=='parse5-8.0.1-text-v1'||!Array.isArray(result.pages)||result.pages.length||
      !Array.isArray(result.spans)||!result.spans.length||result.spans.length>50000||
      result.quality?.requiresReview!==true||!Number.isSafeInteger(result.quality.parseErrors)||result.quality.parseErrors<0||
      !Array.isArray(result.quality.warnings)||result.quality.warnings.length>20||
      result.quality.warnings.some(w=>typeof w!=='string'||w.length>200)) throw new Error('Invalid HTML extraction result');
    let previousEnd=0;
    for(const span of result.spans) {
      if(!span||![span.start,span.end,span.sourceStart,span.sourceEnd].every(Number.isSafeInteger)||
        span.start<previousEnd||span.end<=span.start||span.end>result.text.length||
        span.sourceStart<0||span.sourceEnd<=span.sourceStart||span.sourceEnd>sourceLength)
        throw new Error('Invalid HTML extraction offsets');
      previousEnd=span.end;
    }
    return result;
  } finally {
    // The runner settles after child close; cleanup cannot race the parser.
    // This fresh directory is the only deletion target owned here.
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
module.exports={extractHtml};

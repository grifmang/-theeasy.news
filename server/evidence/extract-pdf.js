const fs=require('fs'),path=require('path'),{createHash}=require('crypto');
const {requirePdfRuntime}=require('./pdf-runtime');
const {runPdfProcess}=require('./pdf-process');
const {runHtmlProcess}=require('./html-process');

function mapPage(bytes,options,worker,args) {
  return runHtmlProcess(bytes,{executable:options.launcher,cwd:options.scratch,signal:options.signal,
    args:[options.runtime,options.scratch,path.join(options.runtime,'node'),
      '--openssl-config='+path.join(options.runtime,'openssl.cnf'),'--jitless','--no-expose-wasm',
      '--max-old-space-size=96','--max-semi-space-size=4',path.join(options.runtime,worker),...args]});
}

// Internal: service admission/authorization and persistence belong to the caller.
// Only runtime objects returned by the completed startup gate are accepted.
async function extractPdf(bytes,{runtime,signal}={}) {
  requirePdfRuntime(runtime);
  if(!Buffer.isBuffer(bytes)||bytes.length>26214400||signal?.aborted)throw new Error('Invalid PDF extraction');
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,60000);
  let scratch;
  try {
    if(signal?.aborted)abort();
    scratch=fs.mkdtempSync(path.join(runtime.scratchParent,'pdf-'));
    fs.chmodSync(scratch,0o700);
    const options={launcher:path.join(runtime.bundleDirectory,'launcher'),runtime:runtime.runtimeDirectory,scratch,signal:controller.signal};
    const info=new TextDecoder('utf-8',{fatal:true}).decode(await runPdfProcess(bytes,{...options,tool:'info'}));
    // Metadata strings can contain newlines. Duplicate labels fail closed, so a
    // title cannot shadow the real page count or encryption status.
    const values=label=>info.split(/\r?\n/).filter(line=>line.startsWith(label+':')).map(line=>line.slice(label.length+1).trim());
    const counts=values('Pages'),encryption=values('Encrypted');
    if(counts.length!==1||!/^\d{1,3}$/.test(counts[0])||encryption.length!==1||encryption[0]!=='no')
      throw new Error('Encrypted or ambiguous PDF metadata');
    const count=Number(counts[0]);
    if(count<1||count>200)throw new Error('PDF page limit exceeded');
    let text='',renderBytes=0,lowConfidenceWords=0;
    const pages=[],spans=[],renders=[],ocrPages=[],ocrUnresolvedPages=[];
    for(let page=1;page<=count;page++) {
      if(controller.signal.aborted)throw new Error('PDF extraction cancelled');
      const bbox=await runPdfProcess(bytes,{...options,tool:'text',page});
      let mapped=await mapPage(bbox,options,'pdf-map-worker.mjs',[String(page)]);
      if(typeof mapped.text!=='string'||mapped.page?.page!==page||!Array.isArray(mapped.words)||
        mapped.quality?.requiresReview!==true||mapped.offsetUnit!=='utf16')throw new Error('Invalid PDF mapping');
      let textMethod='native';
      if(mapped.quality.requiresOcr) {
        const {width,height}=mapped.page;
        const raster=await runPdfProcess(bytes,{...options,tool:'ocr-render',page});
        const tsv=await runPdfProcess(raster,{...options,tool:'ocr',page});
        mapped=await mapPage(tsv,options,'ocr-map-worker.mjs',[String(page),String(width),String(height)]);
        if(typeof mapped.text!=='string'||mapped.page?.page!==page||mapped.page.width!==width||mapped.page.height!==height||
          !Array.isArray(mapped.words)||mapped.quality?.requiresReview!==true||mapped.quality?.ocrDerived!==true||
          mapped.quality?.requiresOcr!==false||mapped.offsetUnit!=='utf16')throw new Error('Invalid PDF OCR mapping');
        textMethod='ocr';ocrPages.push(page);
        if(!mapped.words.length)ocrUnresolvedPages.push(page);
        if(!Number.isSafeInteger(mapped.quality.lowConfidenceWords)||mapped.quality.lowConfidenceWords<0||
          mapped.quality.lowConfidenceWords>mapped.words.length)throw new Error('Invalid PDF OCR confidence');
        lowConfidenceWords+=mapped.quality.lowConfidenceWords;
      }
      const start=text.length;
      if(text.length+mapped.text.length+1>1000000||spans.length+mapped.words.length>50000)throw new Error('PDF text limit exceeded');
      text+=mapped.text;
      pages.push({...mapped.page,start,end:text.length,textMethod,
        ...(textMethod==='ocr'?{lowConfidenceWords:mapped.quality.lowConfidenceWords}:{})});
      for(const word of mapped.words) {
        if(!Number.isSafeInteger(word.start)||!Number.isSafeInteger(word.end)||word.start<0||word.end<=word.start||word.end>mapped.text.length||word.page!==page)
          throw new Error('Invalid PDF word range');
        spans.push({...word,method:word.method||'native',start:start+word.start,end:start+word.end});
      }
      // A separator is not attributed to either page or fabricated as source text.
      if(page<count)text+='\f';
      const image=await runPdfProcess(bytes,{...options,tool:'render',page});
      if(image.length<24||!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
        image.toString('ascii',12,16)!=='IHDR'||image.readUInt32BE(16)<1||image.readUInt32BE(16)>1600||
        image.readUInt32BE(20)<1||image.readUInt32BE(20)>1600)throw new Error('Invalid PDF render');
      renderBytes+=image.length;if(renderBytes>64*1024*1024)throw new Error('PDF render budget exceeded');
      renders.push({page,mime:'image/png',sha256:createHash('sha256').update(image).digest('hex'),bytes:image});
    }
    if(controller.signal.aborted)throw new Error('PDF extraction cancelled');
    return {text,pages,spans,renders,originalSha256:createHash('sha256').update(bytes).digest('hex'),
      extractorVersion:'poppler-22.12.0-deb12u3-tesseract-5.3.0-eng-v1',offsetUnit:'utf16',
      coordinateUnit:'pdf-point',coordinateOrigin:'top-left',
      quality:{requiresReview:true,requiresOcr:ocrUnresolvedPages.length>0,ocrPages,ocrUnresolvedPages,lowConfidenceWords,
        warnings:['reading_order_and_rendered_original_require_review',
          ...(ocrPages.length?['ocr_text_requires_original_comparison','ocr_english_only']:[]),
          ...(ocrUnresolvedPages.length?['ocr_found_no_text']:[])]}};
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',abort);
    if(scratch)fs.rmSync(scratch,{recursive:true,force:true});
  }
}
module.exports={extractPdf};

const fs=require('fs'),path=require('path');
const {loadHtmlRuntime}=require('./html-runtime');
const {runPdfProcess}=require('./pdf-process');
const {runHtmlProcess}=require('./html-process');
const verifiedRuntimes=new WeakSet();
function requirePdfRuntime(runtime) {
  if(!runtime||!verifiedRuntimes.has(runtime))throw new Error('Verified PDF runtime required');
  return runtime;
}

function probePdf() {
  const stream='BT /F1 12 Tf 72 720 Td (Evidence 2026 amount 123.45) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let value='%PDF-1.4\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(value));value+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(value);
  value+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

// Operator-only startup gate, not document intake. The separate PDF bundle
// deliberately includes the unchanged HTML/Node base and its integrity contract.
async function loadPdfRuntime(configuration) {
  // Reuse the full root-ownership, ancestor, capability, manifest, private-scratch
  // and actual Node/kernel checks. Do not replace these with hash checks alone.
  const installed=await loadHtmlRuntime(configuration);
  const root=installed.bundleDirectory,runtime=path.join(root,'runtime');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  if(manifest.kind!=='pdf-ocr-v1'||manifest.runtimeDirectory!==runtime||
    manifest.pdfPackages?.poppler!=='22.12.0-2+deb12u3'||manifest.pdfPackages?.fontsDejavu!=='2.37-6'||
    manifest.pdfPackages?.fontconfig!=='2.14.1-4'||
    manifest.pdfPackages?.tesseract!=='5.3.0-2'||manifest.pdfPackages?.englishData!=='1:4.1.0-2')
    throw new Error('Unsupported PDF runtime');
  const files=new Map(manifest.files.map(entry=>[entry.path,entry]));
  if(!manifest.files.some(entry=>entry.path.startsWith('runtime/fontconfig-cache/')&&entry.size>0))
    throw new Error('Incomplete PDF font cache');
  for(const name of ['pdfinfo','pdftotext','pdftoppm','render','pdf-page.mjs','pdf-map-worker.mjs',
    'fonts.conf','fonts/DejaVuSans.ttf','licenses/fonts-dejavu-copyright','licenses/poppler-copyright',
    'tesseract','tessdata/eng.traineddata','ocr-page.mjs','ocr-map-worker.mjs','licenses/tesseract-copyright','licenses/tesseract-eng-copyright']) {
    const entry=files.get('runtime/'+name);
    if(!entry||!entry.size)throw new Error('Incomplete PDF runtime');
    if(['pdfinfo','pdftotext','pdftoppm','render','tesseract'].includes(name)&&
      (!entry.executable||(fs.statSync(path.join(runtime,name)).mode&0o111)!==0o111))
      throw new Error('PDF executable unavailable');
  }
  const scratch=fs.mkdtempSync(path.join(installed.scratchParent,'pdf-preflight-'));
  try {
    fs.chmodSync(scratch,0o700);
    const options={launcher:path.join(root,'launcher'),runtime,scratch,page:1};
    const bytes=probePdf();
    const metadata=await runPdfProcess(bytes,{...options,tool:'info'});
    if(!/^Pages:\s+1\s*$/m.test(metadata.toString('utf8')))throw new Error('PDF metadata preflight failed');
    const bbox=await runPdfProcess(bytes,{...options,tool:'text'});
    const mapped=await runHtmlProcess(bbox,{executable:options.launcher,cwd:scratch,
      args:[runtime,scratch,path.join(runtime,'node'),'--openssl-config='+path.join(runtime,'openssl.cnf'),
        '--jitless','--no-expose-wasm','--max-old-space-size=96','--max-semi-space-size=4',
        path.join(runtime,'pdf-map-worker.mjs'),'1']});
    if(mapped.text!=='Evidence 2026 amount 123.45\n'||mapped.words?.length!==4||
      mapped.page?.page!==1||mapped.quality?.requiresReview!==true)throw new Error('PDF mapping preflight failed');
    const rendered=await runPdfProcess(bytes,{...options,tool:'render'});
    if(rendered.length<1000||!rendered.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      throw new Error('PDF renderer preflight failed');
    const ocr=await runPdfProcess(rendered,{...options,tool:'ocr'});
    const recognized=await runHtmlProcess(ocr,{executable:options.launcher,cwd:scratch,
      args:[runtime,scratch,path.join(runtime,'node'),'--openssl-config='+path.join(runtime,'openssl.cnf'),
        '--jitless','--no-expose-wasm','--max-old-space-size=96','--max-semi-space-size=4',
        path.join(runtime,'ocr-map-worker.mjs'),'1','612','792']});
    if(recognized.text!=='Evidence 2026 amount 123.45\n'||recognized.quality?.ocrDerived!==true||
      recognized.quality?.requiresReview!==true)throw new Error('OCR preflight failed');
    // This is tool availability, not visual fidelity approval for arbitrary PDFs.
    const result=Object.freeze({...installed,kind:manifest.kind,runtimeDirectory:runtime});
    verifiedRuntimes.add(result);
    return result;
  } finally {
    fs.rmSync(scratch,{recursive:true,force:true});
  }
}
module.exports={loadPdfRuntime,requirePdfRuntime};

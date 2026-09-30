const {TextDecoder}=require('util');
const {createHash}=require('crypto');
const {importDocument}=require('../research');
const {recordRetrieval}=require('../source-provenance');
const {extractHtml}=require('./extract-html');
const {stagePdfRenders,recordPdfRenders}=require('./pdf-renders');
const {describeArchiveReplay}=require('../discovery/archive-link');
// Internal editor-requested extraction. No classification or publication.
async function extractFetchText(db,request,archive) {
  return extractStored(db,request,archive,'text/plain');
}
// Runtime is trusted operator configuration, never fields from an HTTP request.
// The editor API reaches this only through the opt-in verified runtime service.
async function extractFetchHtml(db,request,archive,runtime={}) {
  return extractStored(db,request,archive,'text/html',runtime);
}
// Internal trusted service, never supplied by an HTTP request body.
async function extractFetchPdf(db,request,archive,service,{signal}={}) {
  return extractStored(db,request,archive,'application/pdf',{pdfService:service,signal});
}
async function extractStored(db,{receiptId,actorId},archive,mime,runtime={}) {
  if(!Number.isSafeInteger(receiptId)||receiptId<1||!Number.isSafeInteger(actorId)||actorId<1) throw new Error('Invalid extraction request');
  const authorize=()=>{
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(actorId)?.role!=='editor') throw new Error('Editor required');
  };
  authorize();
  const receipt=db.prepare(`SELECT r.*,j.topic_id,j.source_policy_id,j.original_sha256,j.state
    FROM fetch_receipts r JOIN fetch_jobs j ON j.id=r.job_id WHERE r.id=?`).get(receiptId);
  if(!receipt||receipt.state!=='fetched'||receipt.retention!=='private'||receipt.mime!==mime||receipt.original_sha256!==receipt.sha256)
    throw new Error(mime==='text/plain'?'Stored plain text required':mime==='application/pdf'?'Stored PDF required':'Stored HTML required');
  const original=db.prepare('SELECT * FROM original_objects WHERE sha256=?').get(receipt.sha256);
  const archiveReplay=describeArchiveReplay({url:receipt.url,finalUrl:receipt.final_url,
    redirects:JSON.parse(receipt.redirects_json),headers:JSON.parse(receipt.headers_json),retrievedAt:receipt.retrieved_at});
  if(!original||original.size!==receipt.size||original.mime!==receipt.mime) throw new Error('Original manifest mismatch');
  const bytes=await archive.readOriginal(original);
  if(!Buffer.isBuffer(bytes)||bytes.length!==receipt.size||createHash('sha256').update(bytes).digest('hex')!==receipt.sha256) throw new Error('Original integrity failure');
  const source=mime==='application/pdf'?null:new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  authorize();
  if(runtime.signal?.aborted) throw new Error('Cancelled extraction');
  const extracted=mime==='application/pdf'?await runtime.pdfService.extract(bytes,{signal:runtime.signal}):mime==='text/html'?await extractHtml(bytes,runtime):{
    text:source,extractorVersion:'http-utf8-v1',
    spans:[{start:0,end:source.length,sourceStart:0,sourceEnd:source.length}],pages:[],
    quality:{requiresReview:true,warnings:['plain_text_not_rendered']}
  };
  const content=extracted.text;
  if(!content.trim()||content.length>1000000) throw new Error('Invalid extracted text');
  authorize();
  if(mime==='application/pdf'&&extracted.originalSha256!==receipt.sha256)throw new Error('Extracted PDF original mismatch');
  const renders=mime==='application/pdf'?await stagePdfRenders(extracted,archive,{signal:runtime.signal}):[];
  return db.transaction(()=>{
    authorize();
    if(runtime.signal?.aborted) throw new Error('Cancelled extraction');
    // URL grouping is provenance bookkeeping, not proof of independent sourcing.
    const originChain='fetch-url:'+createHash('sha256').update(archiveReplay?.originalUrl||receipt.url).digest('hex');
    const retrievalMethod=archiveReplay?'wayback':'http';
    const document=importDocument(db,{topicId:receipt.topic_id,source:receipt.source_policy_id,
      url:receipt.final_url,title:receipt.final_url.slice(0,500),content,kind:'other',originChain,extractionMethod:extracted.extractorVersion});
    db.prepare('INSERT INTO document_originals(document_id,sha256) VALUES(?,?) ON CONFLICT DO NOTHING').run(document.id,receipt.sha256);
    const exists=db.prepare(`SELECT id FROM source_retrievals WHERE source_id=? AND url=? AND final_url=?
      AND retrieved_at=? AND sha256=? AND method=?`).get(document.source_id,receipt.url,receipt.final_url,receipt.retrieved_at,receipt.sha256,retrievalMethod);
    if(!exists) recordRetrieval(db,{sourceId:document.source_id,url:receipt.url,finalUrl:receipt.final_url,
      status:receipt.status,retrievedAt:receipt.retrieved_at,sha256:receipt.sha256,mime:receipt.mime,method:retrievalMethod});
    const textSha256=createHash('sha256').update(content).digest('hex');
    const manifestJson=JSON.stringify({schemaVersion:mime==='application/pdf'?2:1,offsetUnit:'utf16',
      originalSha256:receipt.sha256,textSha256,extractorVersion:extracted.extractorVersion,
      ...(mime==='application/pdf'?{sourceByteLength:bytes.length,coordinateUnit:extracted.coordinateUnit,
        coordinateOrigin:extracted.coordinateOrigin,renders}:{sourceLength:source.length}),textLength:content.length,
      spans:extracted.spans,pages:extracted.pages,quality:archiveReplay?
        {...extracted.quality,warnings:[...extracted.quality.warnings,'archive_replay_requires_review']}:extracted.quality,
      ...(archiveReplay?{archive:archiveReplay}:{})});
    const manifestSha256=createHash('sha256').update(manifestJson).digest('hex');
    const previous=db.prepare('SELECT * FROM extraction_manifests WHERE receipt_id=? AND extractor_version=?')
      .get(receipt.id,extracted.extractorVersion);
    if(previous) {
      if(previous.document_id!==document.id||previous.original_sha256!==receipt.sha256||previous.manifest_sha256!==manifestSha256)
        throw new Error('Extraction differs from recorded version');
    } else {
      db.prepare(`INSERT INTO extraction_manifests(document_id,receipt_id,original_sha256,text_sha256,
        extractor_version,manifest_json,manifest_sha256,requires_review,actor_id) VALUES(?,?,?,?,?,?,?,1,?)`)
        .run(document.id,receipt.id,receipt.sha256,textSha256,extracted.extractorVersion,manifestJson,manifestSha256,actorId);
    }
    if(renders.length) {
      const extraction=db.prepare('SELECT id FROM extraction_manifests WHERE receipt_id=? AND extractor_version=?').get(receipt.id,extracted.extractorVersion);
      recordPdfRenders(db,extraction.id,renders);
    }
    return document;
  }).immediate();
}
module.exports={extractFetchText,extractFetchHtml,extractFetchPdf};

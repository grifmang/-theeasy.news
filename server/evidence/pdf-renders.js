const {createHash}=require('crypto');
async function stagePdfRenders(extracted,archive,{signal}={}) {
  if(!Array.isArray(extracted.renders)||!extracted.renders.length||extracted.renders.length>200||
    extracted.renders.length!==extracted.pages?.length)throw new Error('Invalid PDF render inventory');
  const records=[];let total=0;
  for(const [index,render] of extracted.renders.entries()) {
    if(signal?.aborted)throw new Error('Cancelled PDF persistence');
    const bytes=render.bytes;
    if(render.page!==index+1||!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>8388608||
      render.mime!=='image/png'||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
      bytes.toString('ascii',12,16)!=='IHDR')throw new Error('Invalid PDF render');
    total+=bytes.length;if(total>64*1024*1024)throw new Error('PDF render budget exceeded');
    const sha256=createHash('sha256').update(bytes).digest('hex');
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    if(sha256!==render.sha256||width<1||width>1600||height<1||height>1600)throw new Error('PDF render integrity failure');
    // Reuse private content-addressed byte storage, NOT original_objects records.
    // On DB failure retain bytes for reconciliation; another extraction may share them.
    const stored=await archive.archiveOriginal({bytes,mime:'image/png',accessPolicy:'private'});
    if(stored.sha256!==sha256||stored.key!==sha256+'.bin'||stored.size!==bytes.length||stored.mime!=='image/png')
      throw new Error('Stored PDF render mismatch');
    records.push({...stored,page:render.page,width,height,rendererVersion:extracted.extractorVersion});
  }
  return records;
}
function recordPdfRenders(db,extractionId,records) {
  for(const record of records) {
    db.prepare(`INSERT INTO extraction_renders(extraction_id,page,sha256,key,size,mime,width,height,renderer_version)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(extraction_id,page) DO NOTHING`).run(extractionId,record.page,
        record.sha256,record.key,record.size,record.mime,record.width,record.height,record.rendererVersion);
    const stored=db.prepare('SELECT * FROM extraction_renders WHERE extraction_id=? AND page=?').get(extractionId,record.page);
    if(stored.sha256!==record.sha256||stored.key!==record.key||stored.size!==record.size||stored.mime!==record.mime||
      stored.width!==record.width||stored.height!==record.height||stored.renderer_version!==record.rendererVersion)
      throw new Error('PDF render differs from recorded version');
  }
}
module.exports={stagePdfRenders,recordPdfRenders};

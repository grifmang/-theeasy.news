const {TextDecoder}=require('util');
const {importDocument}=require('../research');
const {recordRetrieval}=require('../source-provenance');

// Internal manual intake: never fetches a URL or accepts a claimed extraction.
async function importTextOriginal(db,input,archive) {
  if(!Buffer.isBuffer(input.bytes) || input.bytes.length<1 || input.bytes.length>25*1024*1024) throw new Error('Invalid original size');
  const bytes=Buffer.from(input.bytes);
  const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!content.trim() || content.length>1000000) throw new Error('Invalid text content');
  const original=await archive.archiveOriginal({bytes,mime:'text/plain',accessPolicy:'private'});
  // Object storage cannot join a SQLite transaction. On failure preserve the
  // object for reconciliation; deleting it could break another import.
  return db.transaction(()=>{
    db.prepare(`INSERT INTO original_objects(sha256,key,size,mime) VALUES(?,?,?,?)
      ON CONFLICT(sha256) DO NOTHING`).run(original.sha256,original.key,original.size,original.mime);
    const stored=db.prepare('SELECT * FROM original_objects WHERE sha256=?').get(original.sha256);
    if(stored.key!==original.key || stored.size!==original.size || stored.mime!==original.mime) throw new Error('Original manifest mismatch');
    const document=importDocument(db,{...input,content,extractionMethod:'utf8-v1'});
    db.prepare('INSERT INTO document_originals(document_id,sha256) VALUES(?,?) ON CONFLICT DO NOTHING').run(document.id,original.sha256);
    const retrieval=recordRetrieval(db,{sourceId:document.source_id,url:input.url,finalUrl:input.url,
      status:200,retrievedAt:input.retrievedAt,sha256:original.sha256,mime:original.mime,method:'manual_import'});
    return {document,original:stored,retrieval};
  }).immediate();
}
module.exports={importTextOriginal};

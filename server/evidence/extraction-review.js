const {createHash}=require('crypto');
function getExtractionReview(db,extractionId) {
  const event=db.prepare('SELECT id,decision FROM extraction_review_events WHERE extraction_id=? ORDER BY id DESC LIMIT 1').get(extractionId);
  return event?{status:event.decision,eventId:event.id}:{status:'unreviewed',eventId:null};
}
function listDocumentExtractions(db,documentId) {
  const rows=db.prepare(`SELECT id,document_id,receipt_id,original_sha256,text_sha256,
    extractor_version,manifest_sha256,requires_review,actor_id,created_at
    FROM extraction_manifests WHERE document_id=? ORDER BY id LIMIT 101`).all(documentId);
  if(rows.length>100) throw new Error('Invalid extraction history size');
  return rows.map(row=>({...row,review:getExtractionReview(db,row.id)}));
}
function getExtraction(db,extractionId) {
  const row=db.prepare('SELECT * FROM extraction_manifests WHERE id=?').get(extractionId);
  if(!row) return null;
  if(createHash('sha256').update(row.manifest_json).digest('hex')!==row.manifest_sha256)
    throw new Error('Extraction manifest integrity failure');
  const {manifest_json,...summary}=row;
  return {...summary,manifest:JSON.parse(manifest_json),review:getExtractionReview(db,row.id)};
}
function recordExtractionReview(db,{extractionId,actorId,expectedManifestSha256,expectedEventId,decision,originalCompared,reason}) {
  if(!Number.isSafeInteger(extractionId)||extractionId<1||!Number.isSafeInteger(actorId)||actorId<1||
    !['accepted','rejected'].includes(decision)||typeof originalCompared!=='boolean'||
    (decision==='accepted'&&!originalCompared)||typeof reason!=='string'||!reason.trim()||reason.length>8000||
    typeof expectedManifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedManifestSha256)||
    (expectedEventId!==null&&(!Number.isSafeInteger(expectedEventId)||expectedEventId<1)))
    throw new Error('Invalid extraction review');
  return db.transaction(()=>{
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(actorId)?.role!=='editor') throw new Error('Invalid extraction reviewer');
    const extraction=getExtraction(db,extractionId);
    if(!extraction) throw new Error('Unknown extraction');
    if(extraction.manifest_sha256!==expectedManifestSha256||extraction.review.eventId!==expectedEventId)
      throw new Error('Extraction review changed');
    const result=db.prepare(`INSERT INTO extraction_review_events(extraction_id,actor_id,manifest_sha256,
      decision,original_compared,reason) VALUES(?,?,?,?,?,?)`)
      .run(extractionId,actorId,expectedManifestSha256,decision,originalCompared?1:0,reason);
    return db.prepare('SELECT * FROM extraction_review_events WHERE id=?').get(result.lastInsertRowid);
  }).immediate();
}
module.exports={getExtractionReview,listDocumentExtractions,getExtraction,recordExtractionReview};

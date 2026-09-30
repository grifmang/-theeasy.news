// Editor-only lexical retrieval. Rank is not confidence, evidence strength or truth.
function searchPassages(db,{topicId,query,limit=30}) {
  if(!Number.isSafeInteger(topicId) || topicId<1 || typeof query!=='string' || !query.trim() || query.length>500 ||
    !Number.isSafeInteger(limit) || limit<1 || limit>100) throw new Error('Invalid search request');
  if(!db.prepare('SELECT id FROM research_topics WHERE id=?').get(topicId)) throw new Error('Unknown topic');
  const tokens=query.match(/[\p{L}\p{N}]+/gu) || [];
  if(tokens.length>30) throw new Error('Invalid search request');
  if(!tokens.length) return {items:[],query};
  const match=tokens.map(token=>`"${token}"`).join(' AND ');
  const items=db.prepare(`SELECT p.*,d.source_id,d.kind,d.origin_chain,d.extraction_method,
      s.url,s.title,s.source,s.published_at,bm25(passage_search) AS lexical_rank
    FROM passage_search JOIN research_passages p ON p.id=passage_search.rowid
    JOIN research_documents d ON d.id=p.document_id JOIN source_items s ON s.id=d.source_id
    WHERE passage_search MATCH ? AND EXISTS (
      SELECT 1 FROM research_topic_documents td WHERE td.document_id=d.id AND td.topic_id=?
    ) AND COALESCE((SELECT a.policy FROM source_access_events a
      WHERE a.source_id=s.id ORDER BY a.id DESC LIMIT 1),'private')!='restricted'
    ORDER BY lexical_rank,p.id LIMIT ?`).all(match,topicId,limit);
  return {items,query};
}
module.exports={searchPassages};

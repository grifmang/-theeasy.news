function integer(value,name) {
  if(!Number.isSafeInteger(value)||value<1)throw new Error(`Invalid ${name}`);
  return value;
}
function reason(value) {
  if(typeof value!=='string'||!value.trim()||value.length>8000||Buffer.byteLength(value)>8000)
    throw new Error('Invalid source chain reason');
  return value.trim();
}
function requireDocument(db,id) {
  const row=db.prepare('SELECT id,origin_chain FROM research_documents WHERE id=?').get(integer(id,'document'));
  if(!row)throw new Error('Unknown document');
  return row;
}

function ancestryIds(db,documentId) {
  const ancestors=db.prepare(`WITH RECURSIVE ancestry(id) AS (
    VALUES(?)
    UNION
    SELECT links.parent_document_id FROM source_chain_links links JOIN ancestry ON links.document_id=ancestry.id
  ) SELECT id FROM ancestry LIMIT ?`).all(documentId,MAX_COMPONENT_NODES+1).map(row=>row.id);
  if(ancestors.length>MAX_COMPONENT_NODES)throw new Error('Invalid source chain node limit');
  return ancestors.sort((a,b)=>a-b);
}
function edgesFor(db,ancestors,includeAudit) {
  if(!ancestors.length)return [];
  const columns=includeAudit?'id,document_id,parent_document_id,actor_id,reason,created_at':'document_id,parent_document_id';
  const placeholders=ancestors.map(()=>'?').join(',');
  const edges=db.prepare(`SELECT ${columns} FROM source_chain_links WHERE document_id IN (${placeholders})
    ORDER BY document_id,parent_document_id,id LIMIT ?`).all(...ancestors,MAX_COMPONENT_LINKS+1);
  if(edges.length>MAX_COMPONENT_LINKS)throw new Error('Invalid source chain link limit');
  if(includeAudit&&edges.reduce((bytes,edge)=>bytes+Buffer.byteLength(edge.reason),0)>MAX_COMPONENT_REASON_BYTES)
    throw new Error('Invalid source chain reason limit');
  return edges;
}
function sourceChainSummary(db,document) {
  const ancestors=ancestryIds(db,document.id),edges=edgesFor(db,ancestors,false);
  const hasParent=new Set(edges.map(link=>link.document_id));
  return {documentId:document.id,legacyOriginChain:document.origin_chain,
    parentDocumentIds:edges.filter(link=>link.document_id===document.id).map(link=>link.parent_document_id),
    ancestorDocumentIds:ancestors.filter(id=>id!==document.id),
    rootDocumentIds:ancestors.filter(id=>!hasParent.has(id))};
}
function getSourceChain(db,documentId) {
  const document=requireDocument(db,documentId);
  const summary=sourceChainSummary(db,document);
  return {...summary,links:edgesFor(db,[document.id,...summary.ancestorDocumentIds],true)};
}
function componentStats(db,documentId) {
  return db.prepare(`WITH RECURSIVE component(id) AS (
    VALUES(?)
    UNION
    SELECT links.parent_document_id FROM source_chain_links links JOIN component ON links.document_id=component.id
    UNION
    SELECT links.document_id FROM source_chain_links links JOIN component ON links.parent_document_id=component.id
  ) SELECT COUNT(*) node_count,
    (SELECT COUNT(*) FROM source_chain_links WHERE document_id IN component) link_count,
    (SELECT COALESCE(SUM(length(CAST(reason AS BLOB))),0) FROM source_chain_links WHERE document_id IN component) reason_bytes
    FROM component`).get(documentId);
}
function assertComponentBounds(db,documentId) {
  const stats=componentStats(db,documentId);
  if(stats.node_count>MAX_COMPONENT_NODES)throw new Error('Source chain component node limit exceeded');
  if(stats.link_count>MAX_COMPONENT_LINKS)throw new Error('Source chain component link limit exceeded');
  if(stats.reason_bytes>MAX_COMPONENT_REASON_BYTES)throw new Error('Source chain component reason limit exceeded');
}

// Internal service. HTTP callers must bind actorId from the authenticated editor.
function linkSourceChain(db,{documentId,parentId,reason:why,actorId}) {
  integer(actorId,'actor');
  const explanation=reason(why);
  return db.transaction(()=>{
    requireDocument(db,documentId);requireDocument(db,parentId);
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(actorId)?.role!=='editor')
      throw new Error('Invalid source chain actor');
    const existing=db.prepare(`SELECT * FROM source_chain_links
      WHERE document_id=? AND parent_document_id=?`).get(documentId,parentId);
    if(existing) {
      if(existing.actor_id!==actorId||existing.reason!==explanation)throw new Error('Source chain link already exists');
      assertComponentBounds(db,documentId);
      return {link:existing,sourceChain:getSourceChain(db,documentId)};
    }
    const result=db.prepare(`INSERT INTO source_chain_links(document_id,parent_document_id,actor_id,reason)
      VALUES(?,?,?,?)`).run(documentId,parentId,actorId,explanation);
    assertComponentBounds(db,documentId);
    const link=db.prepare('SELECT * FROM source_chain_links WHERE id=?').get(result.lastInsertRowid);
    return {link,sourceChain:getSourceChain(db,documentId)};
  }).immediate();
}

function projectSourceChains(db,documentIds) {
  if(!Array.isArray(documentIds)||documentIds.length>1000||documentIds.some(id=>!Number.isSafeInteger(id)||id<1))
    throw new Error('Invalid source chain projection');
  const ids=[...new Set(documentIds)].sort((a,b)=>a-b);
  let references=0;
  const documents=ids.map(id=>{
    const summary=sourceChainSummary(db,requireDocument(db,id));
    references+=summary.parentDocumentIds.length+summary.ancestorDocumentIds.length+summary.rootDocumentIds.length;
    if(references>MAX_PROJECTION_REFERENCES)throw new Error('Invalid source chain projection size');
    return summary;
  });
  const owner=new Map(),groups=new Map();
  function root(id){while(groups.get(id)!==id)id=groups.get(id);return id;}
  function join(a,b){a=root(a);b=root(b);if(a!==b)groups.set(Math.max(a,b),Math.min(a,b));}
  for(const document of documents)groups.set(document.documentId,document.documentId);
  for(const document of documents) {
    for(const node of [document.documentId,...document.ancestorDocumentIds]) {
      const previous=owner.get(node);
      if(previous===undefined)owner.set(node,document.documentId);else join(document.documentId,previous);
    }
  }
  // Legacy identifiers remain a conservative deduplication fallback for records
  // that predate audited ancestry links.
  const legacy=new Map();
  for(const document of documents) {
    const previous=legacy.get(document.legacyOriginChain);
    if(previous===undefined)legacy.set(document.legacyOriginChain,document.documentId);else join(document.documentId,previous);
  }
  const projected=new Map();
  for(const document of documents) {
    const group=root(document.documentId);
    if(!projected.has(group))projected.set(group,[]);
    projected.get(group).push(document.documentId);
  }
  return {independenceVerified:false,documents,
    groups:[...projected.values()].map(group=>({documentIds:group.sort((a,b)=>a-b)})).sort((a,b)=>a.documentIds[0]-b.documentIds[0])};
}
module.exports={linkSourceChain,getSourceChain,projectSourceChains};
const MAX_COMPONENT_NODES=1001;
const MAX_COMPONENT_LINKS=2000;
const MAX_COMPONENT_REASON_BYTES=1000000;
const MAX_PROJECTION_REFERENCES=50000;

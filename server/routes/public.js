'use strict';
const express=require('express');
const {createHash}=require('node:crypto');
const {getClaimState}=require('../research-lifecycle');

const PUBLIC_CACHE='public, max-age=0, must-revalidate';
const PRIVATE_CACHE='private, no-store';
const TARGETS=['public_index','static_snapshot','cache','document_preview'];
const MAX_SCAN=1000;
const sha=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
const error=(res,status,code)=>res.set('Cache-Control','no-store').status(status).json({error:{code}});
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&
  !/[\x00-\x1f\x7f<>]/.test(value)&&!/\]\s*\(/.test(value)&&!/(?:javascript|data|file):/i.test(value);
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(key=>allowed.includes(key))&&allowed.every(key=>Object.hasOwn(value,key));
function dtoFrom(row){
  if(!row||typeof row.dto_json!=='string'||sha(row.dto_json)!==row.dto_sha256)return null;
  let d;try{d=JSON.parse(row.dto_json);}catch{return null;}
  if(JSON.stringify(d)!==row.dto_json||!keys(d,['schemaVersion','analysisVersionId','claimId','title',
    'attribution','status','findingEstablished','summary','sections','citations','limitations'])||
    d.schemaVersion!==1||d.analysisVersionId!==row.analysis_version_id||d.claimId!==row.claim_id||
    !text(d.title,300)||!(d.attribution===null||text(d.attribution,300))||
    d.status!=='unresolved'||d.findingEstablished!==false||
    !keys(d.summary,['support','contradiction','unknown'])||
    !['support','contradiction','unknown'].every(k=>text(d.summary[k],3000))||
    !Array.isArray(d.sections)||d.sections.length<1||d.sections.length>30||
    !d.sections.every(s=>keys(s,['kind','text','citationPassageIds'])&&
      ['evidence','inference','limitation'].includes(s.kind)&&text(s.text,4000)&&
      Array.isArray(s.citationPassageIds)&&s.citationPassageIds.length<=20&&
      s.citationPassageIds.every(v=>Number.isSafeInteger(v)&&v>0))||
    !Array.isArray(d.citations)||d.citations.length<1||d.citations.length>40||
    !d.citations.every(c=>keys(c,['passageId','locator','excerpts','url'])&&
      Number.isSafeInteger(c.passageId)&&c.passageId>0&&text(c.locator,200)&&
      Array.isArray(c.excerpts)&&c.excerpts.length>0&&c.excerpts.length<=5&&
      c.excerpts.every(v=>text(v,1000))&&
      (c.url===null||safeUrl(c.url)))||
    !keys(d.limitations,['coverageComplete','asOfDate','searchDateVerified','gaps'])||
    typeof d.limitations.coverageComplete!=='boolean'||d.limitations.asOfDate!==null||
    d.limitations.searchDateVerified!==false||!Array.isArray(d.limitations.gaps)||
    d.limitations.gaps.length>100||!d.limitations.gaps.every(v=>text(v,120)))return null;
  return d;
}
function safeUrl(value){
  if(typeof value!=='string'||value.length>2048)return false;
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&
    !u.hash&&!u.search&&u.href===value&&/^[a-z0-9.-]+$/.test(u.hostname)&&
    u.hostname.includes('.')&&!u.hostname.endsWith('.local')&&!/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)&&
    !/%[0-9a-f]{2}/i.test(u.pathname)&&
    !/(?:archive|originals|storage|private|\.bin(?:$|\/))/i.test(u.pathname);}catch{return false;}
}
function publicDto(db,row){
  const dto=dtoFrom(row);if(!dto)return null;
  const state=getClaimState(db,row.claim_id);
  if(state.restricted||state.status==='superseded')return null;
  const changed=db.prepare(`SELECT 1 FROM publication_dependencies d
    LEFT JOIN source_access_events latest ON latest.id=(
      SELECT MAX(a.id) FROM source_access_events a WHERE a.source_id=d.source_id)
    WHERE d.snapshot_id=? AND (latest.id IS NULL OR latest.id!=d.source_access_event_id
      OR latest.policy NOT IN ('excerpt_only','public_original')) LIMIT 1`).get(row.snapshot_id);
  return changed?null:dto;
}
function pagination(req,res){
  const parse=(value,fallback,max)=>value===undefined?fallback:
    typeof value==='string'&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)<=max?Number(value):null;
  const page=parse(req.query.page,1,10000),pageSize=parse(req.query.pageSize,20,50);
  const offset=page===null||pageSize===null?null:(page-1)*pageSize;
  if(offset===null||offset+pageSize>MAX_SCAN){error(res,400,'invalid_pagination');return null;}
  return {page,pageSize,offset};
}
function respond(req,res,body){
  const json=JSON.stringify(body),etag='"'+sha(json)+'"';
  res.set('Cache-Control',PUBLIC_CACHE);res.set('ETag',etag);
  if(req.headers['if-none-match']?.split(',').map(v=>v.trim()).includes(etag))return res.status(304).end();
  return res.type('json').send(json);
}

// A head is readable only when its current generation is installed at every
// private export target. Older receipts and pending desired state never qualify.
const visible=`FROM publication_manifest_heads h
  JOIN publication_snapshots s ON s.id=h.snapshot_id AND s.claim_id=h.claim_id
    AND s.dto_sha256=h.dto_sha256
  JOIN publication_events e ON e.id=h.event_id AND e.claim_id=h.claim_id
    AND e.generation=h.generation AND e.snapshot_id=s.id AND e.action IN ('publish','correct')
  JOIN publication_outbox o ON o.claim_id=h.claim_id AND o.generation=h.generation
    AND o.event_id=e.id AND o.action='activate' AND o.dto_sha256=h.dto_sha256
  JOIN analysis_versions v ON v.id=s.analysis_version_id AND v.claim_id=h.claim_id
  JOIN publication_review_events rev ON rev.id=s.review_event_id AND rev.analysis_version_id=v.id
    AND rev.decision='approved' AND rev.dto_sha256=s.dto_sha256
  JOIN research_claims c ON c.id=h.claim_id
  JOIN research_topics topic ON topic.id=c.topic_id
  WHERE h.state='active' AND rev.id=(
    SELECT MAX(latest_review.id) FROM publication_review_events latest_review
    WHERE latest_review.analysis_version_id=v.id) AND
    EXISTS(SELECT 1 FROM publication_dependencies d WHERE d.snapshot_id=s.id) AND
    (SELECT COUNT(*) FROM publication_delivery_tasks t
      JOIN publication_delivery_receipts r ON r.task_id=t.id AND r.outbox_id=o.id
        AND r.target=t.target AND r.claim_id=h.claim_id AND r.generation=h.generation
        AND r.action='activate' AND r.dto_sha256=h.dto_sha256
        AND r.outcome IN ('applied','replayed') AND r.applied_generation=h.generation
        AND r.artifact_sha256=h.dto_sha256 AND r.artifact_size=length(CAST(s.dto_json AS BLOB))
        AND r.manifest_sha256 IS NOT NULL
      JOIN publication_sinks sink ON sink.sink_id=r.sink_id AND sink.singleton=1
      WHERE t.outbox_id=o.id AND t.generation=h.generation AND t.state='done'
        AND t.target IN ('public_index','static_snapshot','cache','document_preview'))=4
    AND (SELECT COUNT(*) FROM publication_delivery_tasks t WHERE t.outbox_id=o.id)=4
    AND (SELECT COUNT(DISTINCT r.sink_id) FROM publication_delivery_receipts r
      WHERE r.outbox_id=o.id)=1`;
const select=`SELECT h.claim_id,s.id snapshot_id,s.analysis_version_id,s.dto_json,s.dto_sha256,
  topic.id topic_id ${visible}`;

function createPublicRouter(db){
  const router=express.Router();
  router.get('/topics',(req,res)=>{
    const p=pagination(req,res);if(!p)return;
    const rows=db.prepare(`${select} ORDER BY topic.id,h.claim_id LIMIT ?`).iterate(MAX_SCAN);
    const topics=new Map();
    for(const row of rows){if(!publicDto(db,row))continue;
      if(!topics.has(row.topic_id))topics.set(row.topic_id,{id:row.topic_id,slug:`topic-${row.topic_id}`});
      if(topics.size>=p.offset+p.pageSize)break;
    }
    return respond(req,res,{items:[...topics.values()].slice(p.offset),page:p.page,pageSize:p.pageSize});
  });
  router.get('/topics/:slug',(req,res)=>{
    const match=/^topic-([1-9]\d*)$/.exec(req.params.slug),topicId=match&&id(match[1]);
    if(!topicId)return error(res,400,'invalid_slug');
    const p=pagination(req,res);if(!p)return;
    const rows=db.prepare(`${select} AND topic.id=? ORDER BY h.claim_id LIMIT ?`)
      .iterate(topicId,MAX_SCAN);
    const items=[];let visibleCount=0;
    for(const row of rows){const dto=publicDto(db,row);if(!dto)continue;
      if(visibleCount>=p.offset)items.push({claimId:dto.claimId,title:dto.title,
        attribution:dto.attribution,status:dto.status,
        analysisSlug:`analysis-${dto.analysisVersionId}`,summary:dto.summary,
        limitations:dto.limitations});
      visibleCount++;
      if(visibleCount>=p.offset+p.pageSize)break;
    }
    if(!visibleCount)return error(res,404,'not_found');
    return respond(req,res,{topic:{id:topicId,slug:`topic-${topicId}`},items,
      page:p.page,pageSize:p.pageSize});
  });
  router.get('/claims/:id',(req,res)=>{
    const claimId=id(req.params.id);if(!claimId)return error(res,400,'invalid_id');
    const row=db.prepare(`${select} AND h.claim_id=?`).get(claimId),dto=publicDto(db,row);
    return dto?respond(req,res,{claim:dto,analysisSlug:`analysis-${dto.analysisVersionId}`}):error(res,404,'not_found');
  });
  router.get('/analyses/:slug',(req,res)=>{
    const match=/^analysis-([1-9]\d*)$/.exec(req.params.slug),versionId=match&&id(match[1]);
    if(!versionId)return error(res,400,'invalid_slug');
    const row=db.prepare(`${select} AND s.analysis_version_id=?`).get(versionId),dto=publicDto(db,row);
    return dto?respond(req,res,{analysis:dto,slug:`analysis-${versionId}`}):error(res,404,'not_found');
  });
  router.get('/search',(req,res)=>{
    const p=pagination(req,res);if(!p)return;
    const q=req.query.q;
    if(typeof q!=='string'||q.length<1||q.length>100||/[\x00-\x1f\x7f]/.test(q))
      return error(res,400,'invalid_query');
    const term=q.trim().toLowerCase();if(!term)return error(res,400,'invalid_query');
    // Search approved DTO text only, never raw drafts or private topic titles.
    const rows=db.prepare(`${select} ORDER BY h.claim_id LIMIT ?`).iterate(MAX_SCAN);
    const matching=[];
    for(const row of rows){const dto=publicDto(db,row);if(!dto)continue;
      const haystack=[dto.title,dto.attribution,dto.summary.support,dto.summary.contradiction,
        dto.summary.unknown,...dto.sections.map(s=>s.text)].filter(Boolean).join(' ').toLowerCase();
      if(haystack.includes(term))matching.push({claimId:dto.claimId,title:dto.title,
        status:dto.status,analysisSlug:`analysis-${dto.analysisVersionId}`});
      if(matching.length>=p.offset+p.pageSize)break;
    }
    return respond(req,res,{items:matching.slice(p.offset,p.offset+p.pageSize),page:p.page,
      pageSize:p.pageSize});
  });
  return router;
}
module.exports={createPublicRouter,PRIVATE_CACHE};

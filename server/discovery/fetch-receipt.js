const {createHash}=require('crypto');
const {screenDocumentFormat}=require('./document-format');
const {describeArchiveReplay}=require('./archive-link');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
// Raw retrieval provenance only: extraction and factual assessment are separate.
async function storeFetchReceipt(db,job,result,{registry,archive,clock=Date.now}) {
  const eligible=()=>{
    const now=clock();
    if(!Number.isSafeInteger(now)||now<0||now>8640000000000000) throw new Error('Invalid fetch clock');
    const current=db.prepare("SELECT * FROM fetch_jobs WHERE id=? AND state='leased' AND lease_token=? AND lease_until>?").get(job.id,job.lease_token,now);
    if(!current) return null;
    if(db.prepare('SELECT role FROM user_roles WHERE user_id=?').get(current.actor_id)?.role!=='editor') return null;
    let policy;
    try {
      policy=registry.resolve(current.source_policy_id,current.url);
      const json=JSON.stringify({...policy,hosts:[...policy.hosts].sort(),mimeTypes:[...policy.mimeTypes].sort()});
      if(json!==current.policy_json||digest(json)!==current.policy_hash) return null;
    } catch {return null;}
    return {current,policy,now};
  };
  const admitted=eligible();if(!admitted) return null;
  const {current,policy}=admitted;
  if(!Buffer.isBuffer(result.bytes)||result.bytes.length<1||result.bytes.length>26214400||
    result.status!==200||!policy.mimeTypes.includes(result.mime)) throw new Error('Invalid fetch result');
  const bytes=Buffer.from(result.bytes);screenDocumentFormat(bytes,result.mime);
  const normalize=raw=>{registry.resolve(current.source_policy_id,raw);const parsed=new URL(raw);parsed.hash='';return parsed.href;};
  const finalUrl=normalize(result.finalUrl);
  if(!Array.isArray(result.redirects)||result.redirects.length>3) throw new Error('Invalid fetch redirects');
  const redirects=result.redirects.map(hop=>{
    if(!hop||![301,302,303,307,308].includes(hop.status)) throw new Error('Invalid fetch redirects');
    return {url:normalize(hop.url),status:hop.status};
  });
  if((redirects.length?redirects[0].url!==current.url:finalUrl!==current.url)||
    new Set([...redirects.map(hop=>hop.url),finalUrl]).size!==redirects.length+1) throw new Error('Invalid fetch redirects');
  const headers={};
  for(const key of ['content-type','etag','last-modified','memento-datetime']) {
    const value=result.headers?.[key];
    if(typeof value==='string'&&value.length<=4096&&!/[\r\n\0]/.test(value)) headers[key]=value;
  }
  describeArchiveReplay({url:current.url,finalUrl,redirects,headers,retrievedAt:new Date(admitted.now).toISOString()});
  const sha256=digest(bytes),mime=result.mime,size=bytes.length;
  let original=null;
  if(policy.retention==='private') {
    original=await archive.archiveOriginal({bytes,mime,accessPolicy:'private'});
    if(original.sha256!==sha256||original.size!==size||original.mime!==mime||original.key!==`${sha256}.bin`) throw new Error('Archive manifest mismatch');
  }
  // Files cannot participate in a DB transaction. A lost lease can leave a
  // private unreferenced object for reconciliation, never a false completion.
  return db.transaction(()=>{
    if(!eligible()) return null;
    if(original) {
      db.prepare('INSERT INTO original_objects(sha256,key,size,mime) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(sha256,original.key,size,mime);
      const stored=db.prepare('SELECT * FROM original_objects WHERE sha256=?').get(sha256);
      if(stored.key!==original.key||stored.size!==size||stored.mime!==mime) throw new Error('Original manifest mismatch');
    }
    db.prepare(`INSERT INTO fetch_receipts(job_id,url,final_url,status,retrieved_at,sha256,mime,size,retention,redirects_json,headers_json)
      VALUES(?,?,?,200,?,?,?,?,?,?,?)`).run(current.id,current.url,finalUrl,new Date(admitted.now).toISOString(),sha256,mime,size,policy.retention,JSON.stringify(redirects),JSON.stringify(headers));
    db.prepare("UPDATE fetch_jobs SET state='fetched',original_sha256=?,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=?").run(original?sha256:null,current.id);
    return db.prepare('SELECT * FROM fetch_receipts WHERE job_id=?').get(current.id);
  }).immediate();
}
module.exports={storeFetchReceipt};

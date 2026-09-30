import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {apiRequest} from '../api';

export default function ReviewQueue(){
  const [items,setItems]=useState([]),[after,setAfter]=useState(null),[next,setNext]=useState(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    apiRequest(`/api/v1/editor/publication-review-queue${after?`?after=${after}`:''}`,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted){setItems(old=>after?[...old,...data.items]:data.items);setNext(data.nextAfter);}})
      .catch(()=>{if(!controller.signal.aborted)setError('Could not load the review queue.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[after,revision]);
  return <div className="public-reader"><div className="reader-main reader-page">
    <header className="reader-page__header"><p className="eyebrow">Editor workspace</p><h1>Publication review queue</h1><p>Saved analysis versions awaiting or recording an editorial decision.</p></header>
    {loading&&<p role="status">Loading review queue…</p>}
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setRevision(n=>n+1)}>Retry</button></p>}
    {!loading&&!error&&!items.length&&<p>No saved analysis versions yet.</p>}
    <ul className="reader-list">{items.map(item=><li className="reader-card" key={item.analysisVersionId}>
      <h2><Link to={`/editor/reviews/${item.analysisVersionId}`}>{item.title}</Link></h2>
      <p>Claim {item.claimId} · version {item.analysisVersionId} · verification {item.jobState||'not queued'} · review {item.reviewDecision||'not recorded'}</p>
    </li>)}</ul>
    {next&&<button type="button" disabled={loading} onClick={()=>setAfter(next)}>Load more</button>}
  </div></div>;
}

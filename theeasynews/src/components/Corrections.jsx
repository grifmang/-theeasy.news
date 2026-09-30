import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {apiRequest} from '../api';
import {RequestState} from './PublicReader';

export default function Corrections(){
  const [items,setItems]=useState([]),[error,setError]=useState(null),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(null);
    apiRequest('/api/v1/corrections',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setItems(data.items||[]);})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[revision]);
  return <div className="public-reader"><div className="reader-main reader-page">
    <header className="reader-page__header"><p className="eyebrow">Public record</p><h1>Corrections</h1><p>Published corrections to analyses that remain available in the public library.</p></header>
    <RequestState loading={loading} error={error} onRetry={()=>setRevision(n=>n+1)}/>
    {!loading&&!error&&(items.length?<ul className="reader-list">{items.map(item=><li className="reader-card" key={item.claimId}>
      <h2><Link to={`/claims/${item.claimId}`}>{item.title}</Link></h2>
      <p>Latest correction: <time dateTime={new Date(item.latestCorrectionAtMs).toISOString()}>{new Date(item.latestCorrectionAtMs).toLocaleDateString()}</time></p>
    </li>)}</ul>:<p>No current public analyses have a recorded correction.</p>)}
  </div></div>;
}

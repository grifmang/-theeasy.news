import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {apiRequest} from '../api';
import {RequestState} from './PublicReader';

export default function Corrections(){
  const [items,setItems]=useState([]),[error,setError]=useState(null),[loading,setLoading]=useState(true);
  const [page,setPage]=useState(1),[nextPage,setNextPage]=useState(null),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(null);if(page===1)setItems([]);
    apiRequest(`/api/v1/corrections?page=${page}`,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted){setItems(previous=>page===1?data.items||[]:[...previous,...(data.items||[])]);setNextPage(data.nextPage??null);}})
      .catch(reason=>{if(!controller.signal.aborted){setItems([]);setNextPage(null);setError(reason);}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[page,revision]);
  function retry(){setItems([]);setNextPage(null);setPage(1);setRevision(value=>value+1);}
  return <div className="public-reader"><div className="reader-main reader-page">
    <header className="reader-page__header"><p className="eyebrow">Public record</p><h1>Corrections</h1><p>Published corrections to analyses that remain available in the public library.</p></header>
    <RequestState loading={loading} error={error} onRetry={retry}/>
    {!error&&(items.length?<ul className="reader-list">{items.map(item=><li className="reader-card" key={item.claimId}>
      <h2><Link to={`/claims/${item.claimId}`}>{item.title}</Link></h2>
      <p>Latest correction: <time dateTime={new Date(item.latestCorrectionAtMs).toISOString()}>{new Date(item.latestCorrectionAtMs).toLocaleDateString()}</time></p>
    </li>)}</ul>:!loading&&<p>No current public analyses have a recorded correction.</p>)}
    {!loading&&!error&&nextPage&&<button type="button" className="reader-button" onClick={()=>setPage(nextPage)}>Load more corrections</button>}
    {!loading&&!error&&!nextPage&&items.length>0&&<p>End of corrections.</p>}
  </div></div>;
}

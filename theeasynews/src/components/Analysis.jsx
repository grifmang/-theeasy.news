import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../api';
import EvidencePanel from './EvidencePanel';
import { Breadcrumbs, LimitationsPanel, PublicationChronology, RequestState, StatusSummary } from './PublicReader';

export default function Analysis({userId}) {
  const { slug } = useParams();
  const [request, setRequest] = useState({ key: null, analysis: null, chronology:[], error: null, loading: true });
  const [saved,setSaved]=useState(false),[saveError,setSaveError]=useState(''),[saving,setSaving]=useState(false);
  const [revision, setRevision] = useState(0);
  const routeKey = JSON.stringify([slug, revision]);
  const current = request.key === routeKey ? request : { analysis: null, error: null, loading: true };
  const { error, loading } = current;
  const analysis = !loading && !error ? current.analysis : null;
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setRequest({ key: routeKey, analysis: null, error: null, loading: true });
    apiRequest(`/api/v1/analyses/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(data => { if (alive && !controller.signal.aborted) setRequest({ key: routeKey, analysis: data.analysis, chronology:data.chronology||[], chronologyNextAfter:data.chronologyNextAfter??null, error: null, loading: false }); })
      .catch(reason => { if (alive && !controller.signal.aborted && reason.name !== 'AbortError') setRequest({ key: routeKey, analysis: null, error: reason, loading: false }); });
    return () => { alive = false; controller.abort(); };
  }, [slug, routeKey]);
  useEffect(()=>{
    if(!userId||!analysis){setSaved(false);return;}
    const controller=new AbortController();
    apiRequest(`/api/v1/me/saved/${analysis.claimId}`,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setSaved(data.saved===true);
    }).catch(()=>{if(!controller.signal.aborted)setSaveError('Saved status is unavailable.');});
    return ()=>controller.abort();
  },[userId,analysis]);
  async function toggleSaved(){
    if(!analysis||saving)return;setSaving(true);setSaveError('');
    try {await apiRequest(saved?`/api/v1/me/saved/${analysis.claimId}`:'/api/v1/me/saved',{
      method:saved?'DELETE':'POST',...(saved?{}:{body:{claimId:analysis.claimId}})});setSaved(!saved);}
    catch {setSaveError('Could not update saved research. Try again.');}
    finally {setSaving(false);}
  }

  return <div className="public-reader"><div className="reader-main reader-page reader-page--analysis">
    <Breadcrumbs items={[{ label: 'Library', to: '/' }, { label: analysis ? `Claim ${analysis.claimId}` : 'Claim', to: analysis ? `/claims/${analysis.claimId}` : undefined }, { label: 'Analysis' }]} />
    <RequestState loading={loading} error={error} onRetry={() => setRevision(value => value + 1)} />
    {analysis && <article>
      <header className="reader-page__header"><p className="eyebrow">Public analysis · version {analysis.analysisVersionId}</p><h1>{analysis.title}</h1>{analysis.attribution && <p className="reader-attribution">Attribution: {analysis.attribution}</p>}<p className="reader-deck">This analysis is published as unresolved. Its publication does not establish a finding.</p></header>
      <StatusSummary summary={analysis.summary} status={analysis.status} findingEstablished={analysis.findingEstablished} />
      {userId?<p><button className="reader-button" type="button" onClick={toggleSaved} disabled={saving}>{saved?'Remove from saved research':'Save this analysis'}</button>{saveError&&<span role="alert"> {saveError}</span>}</p>:<p><a href="/login">Sign in to save this analysis</a></p>}
      <EvidencePanel sections={analysis.sections} citations={analysis.citations} />
      <LimitationsPanel limitations={analysis.limitations} />
      <PublicationChronology events={current.chronology} claimId={analysis.claimId} nextAfter={current.chronologyNextAfter}/>
    </article>}
  </div></div>;
}

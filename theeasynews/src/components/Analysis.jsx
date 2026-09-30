import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../api';
import EvidencePanel from './EvidencePanel';
import { Breadcrumbs, LimitationsPanel, RequestState, StatusSummary } from './PublicReader';

export default function Analysis() {
  const { slug } = useParams();
  const [request, setRequest] = useState({ key: null, analysis: null, error: null, loading: true });
  const [revision, setRevision] = useState(0);
  const routeKey = JSON.stringify([slug, revision]);
  const current = request.key === routeKey ? request : { analysis: null, error: null, loading: true };
  const { error, loading } = current;
  const analysis = !loading && !error ? current.analysis : null;
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setRequest({ key: routeKey, analysis: null, error: null, loading: true });
    apiRequest(`/api/v1/analyses/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then(data => { if (alive && !controller.signal.aborted) setRequest({ key: routeKey, analysis: data.analysis, error: null, loading: false }); })
      .catch(reason => { if (alive && !controller.signal.aborted && reason.name !== 'AbortError') setRequest({ key: routeKey, analysis: null, error: reason, loading: false }); });
    return () => { alive = false; controller.abort(); };
  }, [slug, routeKey]);

  return <div className="public-reader"><div className="reader-main reader-page reader-page--analysis">
    <Breadcrumbs items={[{ label: 'Library', to: '/' }, { label: analysis ? `Claim ${analysis.claimId}` : 'Claim', to: analysis ? `/claims/${analysis.claimId}` : undefined }, { label: 'Analysis' }]} />
    <RequestState loading={loading} error={error} onRetry={() => setRevision(value => value + 1)} />
    {analysis && <article>
      <header className="reader-page__header"><p className="eyebrow">Public analysis · version {analysis.analysisVersionId}</p><h1>{analysis.title}</h1>{analysis.attribution && <p className="reader-attribution">Attribution: {analysis.attribution}</p>}<p className="reader-deck">This analysis is published as unresolved. Its publication does not establish a finding.</p></header>
      <StatusSummary summary={analysis.summary} status={analysis.status} findingEstablished={analysis.findingEstablished} />
      <EvidencePanel sections={analysis.sections} citations={analysis.citations} />
      <LimitationsPanel limitations={analysis.limitations} />
    </article>}
  </div></div>;
}

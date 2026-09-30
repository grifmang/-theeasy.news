import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api';
import { Breadcrumbs, LimitationsPanel, PublicationChronology, RequestState, StatusSummary } from './PublicReader';

export default function Claim() {
  const { id } = useParams();
  const [request, setRequest] = useState({ key: null, data: null, error: null, loading: true });
  const [revision, setRevision] = useState(0);
  const routeKey = JSON.stringify([id, revision]);
  const current = request.key === routeKey ? request : { data: null, error: null, loading: true };
  const { data, error, loading } = current;
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setRequest({ key: routeKey, data: null, error: null, loading: true });
    apiRequest(`/api/v1/claims/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(result => { if (alive && !controller.signal.aborted) setRequest({ key: routeKey, data: result, error: null, loading: false }); })
      .catch(reason => { if (alive && !controller.signal.aborted && reason.name !== 'AbortError') setRequest({ key: routeKey, data: null, error: reason, loading: false }); });
    return () => { alive = false; controller.abort(); };
  }, [id, routeKey]);

  const claim = !loading && !error ? data?.claim : null;
  return <div className="public-reader"><div className="reader-main reader-page">
    <Breadcrumbs items={[{ label: 'Library', to: '/' }, { label: claim ? `Claim ${claim.claimId}` : 'Claim' }]} />
    <RequestState loading={loading} error={error} onRetry={() => setRevision(value => value + 1)} />
    {claim && <article>
      <header className="reader-page__header"><p className="eyebrow">Claim {String(claim.claimId).padStart(3, '0')}</p><h1>{claim.title}</h1>{claim.attribution && <p className="reader-attribution">Attribution: {claim.attribution}</p>}<p className="reader-deck">This public analysis is a structured account of available evidence. It does not establish that the claim is true.</p></header>
      <StatusSummary summary={claim.summary} status={claim.status} findingEstablished={claim.findingEstablished} />
      <LimitationsPanel limitations={claim.limitations} />
      <PublicationChronology events={data.chronology} claimId={claim.claimId} nextAfter={data.chronologyNextAfter}/>
      <section className="reader-next" aria-labelledby="analysis-link-title"><div><p className="eyebrow">Continue reading</p><h2 id="analysis-link-title">Evidence, interpretation, and sources</h2><p>Review how the published analysis separates cited material from inference and identifies limitations.</p></div><Link className="reader-button reader-button--link" to={`/analyses/${data.analysisSlug}`}>Read full analysis <span aria-hidden="true">→</span></Link></section>
    </article>}
  </div></div>;
}

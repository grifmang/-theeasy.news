import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../api';
import { Breadcrumbs, RequestState, StatusSummary, LimitationsPanel } from './PublicReader';

export default function Topic() {
  const { slug } = useParams();
  const [request, setRequest] = useState({ key: null, data: null, error: null, loading: true });
  const [revision, setRevision] = useState(0);
  const routeKey = JSON.stringify([slug, revision]);
  const current = request.key === routeKey ? request : { data: null, error: null, loading: true };
  const { data, error, loading } = current;
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setRequest({ key: routeKey, data: null, error: null, loading: true });
    apiRequest(`/api/v1/topics/${encodeURIComponent(slug)}?page=1&pageSize=50`, { signal: controller.signal })
      .then(result => { if (alive && !controller.signal.aborted) setRequest({ key: routeKey, data: result, error: null, loading: false }); })
      .catch(reason => { if (alive && !controller.signal.aborted && reason.name !== 'AbortError') setRequest({ key: routeKey, data: null, error: reason, loading: false }); });
    return () => { alive = false; controller.abort(); };
  }, [slug, routeKey]);

  return <div className="public-reader"><div className="reader-main reader-page">
    <Breadcrumbs items={[{ label: 'Library', to: '/' }, { label: data ? `Research topic ${data.topic.id}` : 'Research topic' }]} />
    <RequestState loading={loading} error={error} onRetry={() => setRevision(value => value + 1)} />
    {!loading && !error && data && <>
      <header className="reader-page__header"><p className="eyebrow">Public research collection</p><h1>Research topic {data.topic.id}</h1><p className="reader-deck">The collection lists claims with available public analysis. Topic names remain private in this version of the library.</p></header>
      <section className="reader-collections" aria-labelledby="claims-heading"><div className="section-heading"><div><p className="eyebrow">{data.items.length} visible {data.items.length === 1 ? 'claim' : 'claims'}</p><h2 id="claims-heading">Claims in this collection</h2></div></div>
        {data.items.length ? <ul className="reader-list">{data.items.map(item => <li key={item.claimId} className="reader-card"><span className="reader-card__index">Claim {String(item.claimId).padStart(3, '0')}</span><h3><Link to={`/claims/${item.claimId}`}>{item.title}</Link></h3>{item.attribution && <p className="reader-card__meta">Attributed to {item.attribution}</p>}<StatusSummary summary={item.summary} status={item.status} /><LimitationsPanel limitations={item.limitations} /><Link className="reader-card__more" to={`/claims/${item.claimId}`}>Examine this claim <span aria-hidden="true">→</span></Link></li>)}</ul> : <div className="reader-empty"><h3>No claims are available on this page</h3><p>This collection may have no currently published research.</p></div>}
      </section>
    </>}
  </div></div>;
}

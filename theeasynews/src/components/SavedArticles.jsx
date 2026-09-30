import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api';
import { RequestState } from './PublicReader';

export default function SavedArticles() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revision, setRevision] = useState(0);
  const load = useCallback(signal => {
    setLoading(true); setError(null);
    apiRequest('/api/v1/me/saved', { signal })
      .then(data => setItems(data.items || []))
      .catch(requestError => { if (requestError.name !== 'AbortError') setError(requestError); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
  }, []);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, revision]);

  return <div className="public-reader"><div className="reader-main reader-page">
    <header className="reader-page__header"><p className="eyebrow">Your library</p><h1>Saved research</h1><p className="reader-deck">Public analyses you save will be collected here.</p></header>
    <RequestState loading={loading} error={error} onRetry={() => setRevision(value => value + 1)} />
    {!loading && !error && (items.length ? <ul className="reader-list">{items.map(item => <li className="reader-card" key={item.analysisSlug}><h2><Link to={`/analyses/${item.analysisSlug}`}>{item.title}</Link></h2></li>)}</ul> : <section className="reader-empty"><h2>No saved public research</h2><p>There are no saved public analyses in this account yet.</p><Link className="reader-link" to="/">Browse the research library</Link></section>)}
  </div></div>;
}

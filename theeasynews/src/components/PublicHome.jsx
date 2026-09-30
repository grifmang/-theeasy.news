import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api';
import { RequestState } from './PublicReader';

export default function PublicHome() {
  const [topics, setTopics] = useState([]);
  const [results, setResults] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [input, setInput] = useState(query);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => { setInput(query); }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    const path = query ? `/api/v1/search?q=${encodeURIComponent(query)}&page=1&pageSize=20` : '/api/v1/topics?page=1&pageSize=50';
    apiRequest(path, { signal: controller.signal }).then(data => {
      if (query) setResults(data.items || []); else setTopics(data.items || []);
    }).catch(requestError => {
      if (requestError.name !== 'AbortError') setError(requestError);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision]);

  const submit = event => {
    event.preventDefault();
    const value = input.trim();
    if (value.length > 100) return;
    setSearchParams(value ? { q: value } : {});
  };

  return <div className="public-reader">
    <section className="reader-hero" aria-labelledby="home-title">
      <div className="reader-hero__inner">
        <p className="eyebrow">An evidence-first research library</p>
        <h1 id="home-title">Understand what the evidence can—and can’t—say.</h1>
        <p className="reader-deck">We organize public research by topic and claim. Each analysis separates sourced evidence from interpretation, names what remains unknown, and keeps limitations in view.</p>
        <form className="reader-search" onSubmit={submit} role="search">
          <label htmlFor="public-search">Search public research</label>
          <div className="reader-search__row"><input id="public-search" type="search" value={input} maxLength={100} onChange={event => setInput(event.target.value)} placeholder="Search a topic, claim, or question" />
            <button className="reader-button" type="submit">Search</button></div>
          <span className="reader-search__hint">Search is limited to approved public research text.</span>
        </form>
      </div>
      <div className="reader-hero__note"><span className="note-mark" aria-hidden="true">i</span><p><strong>Current status:</strong> published analyses are presented as unresolved; publication does not establish a finding.</p></div>
    </section>
    <div className="reader-main">
      <section aria-labelledby="collection-title" className="reader-collections">
        <div className="section-heading"><div><p className="eyebrow">Explore the library</p><h2 id="collection-title">{query ? `Search results for “${query}”` : 'Research collections'}</h2></div>{query && <button type="button" className="reader-text-button" onClick={() => {setInput(''); setSearchParams({});}}>Clear search</button>}</div>
        <RequestState loading={loading} error={error} onRetry={() => setRevision(value => value + 1)} />
        {!loading && !error && (query ? (results.length ? <ul className="reader-list">{results.map(item => <li key={item.claimId} className="reader-card"><span className="reader-card__index">Claim {String(item.claimId).padStart(3, '0')}</span><h3><Link to={`/claims/${item.claimId}`}>{item.title}</Link></h3><p className="reader-card__meta">Status: unresolved · No finding established</p><Link className="reader-card__more" to={`/analyses/${item.analysisSlug}`}>Read the analysis <span aria-hidden="true">→</span></Link></li>)}</ul> : <div className="reader-empty"><h3>{query ? 'No matching public research' : 'No public collections yet'}</h3><p>{query ? 'Try a different term. Search only covers approved public research.' : 'Public collections will appear here when reviewed research is available.'}</p></div>) : topics.length ? <ul className="reader-list reader-list--topics">{topics.map(topic => <li key={topic.id} className="reader-card reader-card--topic"><span className="reader-card__index">Collection {String(topic.id).padStart(3, '0')}</span><h3><Link to={`/topics/${topic.slug}`}>Research topic {topic.id}</Link></h3><p>Claims with public, reviewed analysis</p><Link className="reader-card__more" to={`/topics/${topic.slug}`}>Explore collection <span aria-hidden="true">→</span></Link></li>)}</ul> : <div className="reader-empty"><h3>No public collections yet</h3><p>Reviewed research collections will appear here when available.</p></div>)}
      </section>
      {!query && <section className="method-note" aria-labelledby="method-title"><p className="eyebrow">How to read this library</p><h2 id="method-title">A claim is a question to examine, not a conclusion.</h2><div className="method-note__grid"><p><strong>Evidence</strong><br />What cited sources directly say, with excerpts and locators.</p><p><strong>Inference</strong><br />How the research connects evidence to the question.</p><p><strong>Limitation</strong><br />What could not be checked, searched, or established.</p></div></section>}
    </div>
  </div>;
}

import React, { useId } from 'react';
import { Link } from 'react-router-dom';

export function RequestState({ loading, error, onRetry, notFound = false }) {
  if (loading) return <div className="reader-state" role="status" aria-live="polite">Loading public research…</div>;
  if (!error) return null;
  if (notFound || error.status === 404) {
    return <section className="reader-state" role="status"><h1>Research page unavailable</h1><p>This item is not currently available in the public library.</p><Link to="/">Return to the library</Link></section>;
  }
  return <section className="reader-state reader-state--error" role="alert"><h1>We couldn’t load this research</h1><p>Please check your connection and try again.</p><button className="reader-button" type="button" onClick={onRetry}>Try again</button></section>;
}

export function Breadcrumbs({ items }) {
  return <nav className="reader-breadcrumbs" aria-label="Breadcrumb"><ol>
    {items.map((item, index) => <li key={`${item.label}-${index}`}>
      {item.to && index < items.length - 1 ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
    </li>)}
  </ol></nav>;
}

export function StatusSummary({ summary, status = 'unresolved', findingEstablished = false }) {
  const titleId = useId();
  if (!summary) return null;
  return <section className="status-summary" aria-labelledby={titleId}>
    <div className="status-summary__heading"><span className="status-pill">Status: {status}</span><p id={titleId}>Finding established: {findingEstablished ? 'Yes' : 'No'}</p></div>
    <dl className="status-summary__grid">
      <div><dt>Supporting material</dt><dd>{summary.support}</dd></div>
      <div><dt>Contradicting material</dt><dd>{summary.contradiction}</dd></div>
      <div><dt>Unknowns</dt><dd>{summary.unknown}</dd></div>
    </dl>
  </section>;
}

export function LimitationsPanel({ limitations }) {
  const titleId = useId();
  if (!limitations) return null;
  return <aside className="limitations-panel" aria-labelledby={titleId}>
    <h2 id={titleId}>Coverage and limitations</h2>
    <p>{limitations.coverageComplete ? 'Coverage is marked complete for the defined research scope.' : 'Coverage is incomplete. This summary may omit relevant material.'}</p>
    <p>Search date verification: {limitations.searchDateVerified ? 'verified' : 'not verified'}.</p>
    {limitations.gaps?.length > 0 && <><h3>Known gaps</h3><ul>{limitations.gaps.map((gap, index) => <li key={`${gap}-${index}`}>{gap}</li>)}</ul></>}
  </aside>;
}

export function PublicationChronology({events=[]}){
  return <section className="limitations-panel" aria-label="Publication and correction chronology">
    <h2>Publication and correction history</h2>
    {events.length?<ol>{events.map((event,index)=><li key={`${event.type}-${event.occurredAtMs}-${index}`}>
      {event.type==='correction'?'Correction':'Publication'} · <time dateTime={new Date(event.occurredAtMs).toISOString()}>{new Date(event.occurredAtMs).toLocaleDateString()}</time>
    </li>)}</ol>:<p>Publication date unavailable.</p>}
  </section>;
}

export function LegacyArticleUnavailable() {
  return <div className="public-reader"><div className="reader-narrow reader-state">
    <p className="eyebrow">The Easy News public library</p><h1>Legacy article unavailable</h1>
    <p>This address points to an older article collection that is no longer served. The public research library contains reviewed analyses with visible evidence and limitations.</p>
    <Link className="reader-link" to="/">Browse public research</Link>
  </div></div>;
}

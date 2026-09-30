import React,{useRef} from 'react';

const labels = { evidence: 'Evidence', inference: 'Inference', limitation: 'Limitation' };

export default function EvidencePanel({ sections = [], citations = [] }) {
  const returnFocus=useRef(null);
  function visit(event,passageId){
    const target=document.getElementById(`source-${passageId}`);
    if(!target)return;
    event.preventDefault();returnFocus.current=event.currentTarget;
    target.scrollIntoView?.();target.focus();
  }
  const citationById = new Map(citations.map(citation => [citation.passageId, citation]));
  return <section className="evidence-panel" aria-labelledby="evidence-heading">
    <div className="section-heading"><div><p className="eyebrow">Reading the analysis</p><h2 id="evidence-heading">What the analysis says</h2></div></div>
    <ol className="analysis-sections">{sections.map((section, index) => <li className={`analysis-section analysis-section--${section.kind}`} key={`${section.kind}-${index}`}>
      <p className="analysis-section__label">{labels[section.kind] || 'Research note'}</p><p className="analysis-section__text">{section.text}</p>
      {section.citationPassageIds?.length > 0 && <ul className="analysis-section__citations">{section.citationPassageIds.map(passageId => {
        const citation = citationById.get(passageId);
        if (!citation) return null;
        return <li key={passageId}><a href={`#source-${passageId}`} onClick={event=>visit(event,passageId)}>Source {passageId}: {citation.locator}</a></li>;
      })}</ul>}
    </li>)}</ol>
    <section className="source-list" aria-labelledby="sources-heading"><p className="eyebrow">Traceable material</p><h2 id="sources-heading">Sources and excerpts</h2>
      <ol>{citations.map(citation => <li id={`source-${citation.passageId}`} tabIndex="-1" className="source-card" key={citation.passageId}>
        <div className="source-card__heading"><span className="source-card__number">Source {citation.passageId}</span><span className="source-card__locator">{citation.locator}</span></div>
        <ul className="source-card__excerpts">{citation.excerpts.map((excerpt, index) => <li key={`${citation.passageId}-${index}`}><blockquote>{excerpt}</blockquote></li>)}</ul>
        {citation.url ? <a href={citation.url} target="_blank" rel="noopener noreferrer" className="source-card__link">Open original source <span aria-hidden="true">↗</span></a> : <p className="source-card__unavailable">Original source unavailable; the cited excerpt and locator are shown here.</p>}
        <button className="reader-link" type="button" onClick={()=>returnFocus.current?.focus()}>Return to citation</button>
      </li>)}</ol>
    </section>
  </section>;
}

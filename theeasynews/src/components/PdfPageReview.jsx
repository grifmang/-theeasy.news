import React,{useId,useState} from 'react';

function RenderedPage({url,page}) {
  const [failed,setFailed]=useState(false);
  return <div>
    <h5>Preserved page image</h5>
    {failed?<p role="alert">The private page image could not load. Check your session and reload before reviewing.</p>:
      <img src={url} crossOrigin="use-credentials" referrerPolicy="no-referrer"
        alt={`Preserved PDF page ${page}; compare with the extracted text alongside it.`}
        onError={()=>setFailed(true)}/>}
    <a href={url} target="_blank" rel="noreferrer">Open page image at full size</a>
  </div>;
}

export default function PdfPageReview({extractionId,manifest,sourceText}) {
  const prefix=useId(),[selected,setSelected]=useState(0);
  const pages=manifest.pages,renders=manifest.renders;
  if(!Array.isArray(pages)||!pages.length||pages.length>200||!Array.isArray(renders)||
    renders.length!==pages.length||typeof sourceText!=='string'||sourceText.length!==manifest.textLength||
    pages.some((p,i)=>p.page!==i+1||!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||
      p.start<0||p.end<p.start||p.end>sourceText.length||renders[i]?.page!==p.page))
    return <p role="alert">Page provenance and source text do not match. Reload before reviewing.</p>;
  const index=Math.min(selected,pages.length-1),page=pages[index];
  const url=`${process.env.REACT_APP_API_URL||''}/api/v1/editor/extractions/${extractionId}/renders/${page.page}`;
  const usedOcr=manifest.quality?.ocrPages?.includes(page.page);
  const unresolved=manifest.quality?.ocrUnresolvedPages?.includes(page.page);
  return <section className="pdf-page-review" aria-label="PDF page comparison">
    <h4>Compare the preserved PDF</h4>
    <p>Check the original download as well as this rendering. Font substitution, reading order, redactions, and missing text can change meaning.</p>
    <div className="research-field"><label htmlFor={`${prefix}-page`}>Page to review</label>
      <select id={`${prefix}-page`} value={index} onChange={event=>setSelected(Number(event.target.value))}>
        {pages.map((item,i)=><option key={item.page} value={i}>Page {item.page} of {pages.length}</option>)}
      </select></div>
    {usedOcr&&<p role="alert">{unresolved?
      'OCR found no readable text on this page. Do not treat missing text as evidence that a claim is absent.':
      `This page uses English OCR${Number.isSafeInteger(page.lowConfidenceWords)?`; ${page.lowConfidenceWords} words were below the confidence review threshold`:''}. Compare every cited passage with the preserved image.`}</p>}
    <div className="pdf-page-columns">
      <RenderedPage key={`${extractionId}-${page.page}`} url={url} page={page.page}/>
      <div><h5>Extracted text, page {page.page}</h5>
        <textarea className="pdf-page-text" readOnly rows={20} aria-label={`Extracted text for page ${page.page}`}
          value={sourceText.slice(page.start,page.end)||'No readable text was extracted from this page.'}/>
      </div>
    </div>
  </section>;
}

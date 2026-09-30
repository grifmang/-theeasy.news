const {normalizeArchiveOriginal,parseCaptureTimestamp}=require('./wayback');
const ARCHIVE_HOSTS=new Set(['web.archive.org','archive.is','archive.today']);
function rejected() {return Object.assign(new Error('Archive snapshot requires verified replay metadata'),{code:'archive_replay_unverified'});}
function snapshot(raw) {
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.hostname!=='web.archive.org'||url.port||url.username||url.password||url.hash) throw rejected();
  // Only fixed full timestamps and page/raw replay are supported. Calendar,
  // nearest-date, wildcard and asset-specific modifiers need separate review.
  const match=url.pathname.match(/^\/web\/(\d{14})(?:id_)?\/(https?:\/\/.+)$/);
  if(!match) throw rejected();
  const originalUrl=normalizeArchiveOriginal(match[2]+url.search);
  if(ARCHIVE_HOSTS.has(new URL(originalUrl).hostname)) throw rejected();
  return {originalUrl,capturedAt:parseCaptureTimestamp(match[1])};
}
// Provider metadata agreement is provenance, not independent authentication or
// proof that the captured claim is true. No requests or Save Page Now submissions.
function describeArchiveReplay({url,finalUrl,redirects=[],headers={},retrievedAt}) {
  try {
    const involved=[url,...redirects.map(hop=>hop.url),finalUrl];
    if(!involved.some(value=>ARCHIVE_HOSTS.has(new URL(value).hostname))) return null;
    const selected=snapshot(url);
    for(const value of involved) {
      const replay=snapshot(value);
      if(replay.originalUrl!==selected.originalUrl||replay.capturedAt!==selected.capturedAt) throw rejected();
    }
    const memento=headers['memento-datetime'];
    if(typeof memento!=='string'||new Date(selected.capturedAt).toUTCString()!==memento||
      !Number.isFinite(Date.parse(retrievedAt))||Date.parse(selected.capturedAt)>Date.parse(retrievedAt)) throw rejected();
    return {provider:'wayback',originalUrl:selected.originalUrl,archiveUrl:finalUrl,capturedAt:selected.capturedAt,
      retrievedAt,captureTimeSource:'replay_url_and_memento_header',requiresReview:true,completenessVerified:false};
  } catch {throw rejected();}
}
module.exports={describeArchiveReplay};

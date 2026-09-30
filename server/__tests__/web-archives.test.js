const {lookupCaptures}=require('../discovery/wayback');
const header=['timestamp','original','statuscode','mimetype','digest'];
const input={originalUrl:'https://example.com/',before:'2020-01-01T00:00:00.000Z',limit:10};
const row=(timestamp,extra=[])=>[timestamp,'https://example.com/','200','text/html','A'.repeat(32),...extra];
const adapter=rows=>({readCdx:async()=>({status:200,body:Buffer.from(JSON.stringify([header,...rows]))})});

test('capture cutoff is inclusive and enforced locally even when the provider returns a later result',async()=>{
  const captures=await lookupCaptures(input,adapter([row('20200101231047'),row('20200101000000'),row('20191231000000')]));
  expect(captures.map(c=>c.capturedAt)).toEqual(['2020-01-01T00:00:00.000Z','2019-12-31T00:00:00.000Z']);
  expect(captures[0]).toMatchObject({provider:'wayback',originalUrl:'https://example.com/',
    archiveUrl:'https://web.archive.org/web/20200101000000/https://example.com/',
    requestedBefore:input.before,requiresReview:true,contentVerified:false});
  expect(captures[0]).not.toHaveProperty('sha256');
});
test('bounded exact-match query encodes source URL and does not use nearest-date lookup',async()=>{
  let query;
  await lookupCaptures({...input,originalUrl:'https://example.com/a?x=1&y=2',limit:3},{readCdx:async request=>{
    query=request;return {status:200,body:Buffer.from('[]')};
  }});
  const url=new URL(query.url);
  expect(url.origin+url.pathname).toBe('https://web.archive.org/cdx/search/cdx');
  expect(url.searchParams.get('url')).toBe('https://example.com/a?x=1&y=2');
  expect(url.searchParams.get('to')).toBe('20200101000000');
  expect(url.searchParams.get('limit')).toBe('-3');
  expect(url.searchParams.get('matchType')).toBe('exact');
  expect(query.maxBytes).toBe(1048576);
});
test('duplicate captures share an origin chain while changed content remains distinct',async()=>{
  const old=row('20190101000000'),changed=row('20191201000000');changed[4]='B'.repeat(32);
  const captures=await lookupCaptures(input,adapter([old,old,changed]));
  expect(captures).toHaveLength(2);
  expect(new Set(captures.map(c=>c.originChain)).size).toBe(1);
  expect(captures.map(c=>c.archiveDigest)).toEqual(['B'.repeat(32),'A'.repeat(32)]);
});
test('aliases and live URLs are not silently treated as the requested source',async()=>{
  const alias=row('20190101000000');alias[1]='https://www.example.com/';
  const wrong=row('20190101000000');wrong[1]='https://other.example/';
  expect(await lookupCaptures(input,adapter([alias,wrong]))).toEqual([]);
});
test.each(['20190230000000','20200101006000','2020','yesterday'])('invalid capture timestamp %s is quarantined',async timestamp=>{
  await expect(lookupCaptures(input,adapter([row(timestamp)]))).rejects.toMatchObject({code:'archive_invalid_response'});
});
test.each([
  {status:429,body:Buffer.from('rate limited')},
  {status:503,body:Buffer.from('unavailable')},
  {status:200,body:Buffer.from('<html>Challenge</html>')},
  {status:200,body:Buffer.alloc(1048577)}
])('provider failure or challenge never becomes evidence',async response=>{
  await expect(lookupCaptures(input,{readCdx:async()=>response})).rejects.toHaveProperty('code');
});
test('missing captures return an empty discovery result, not a censorship claim',async()=>{
  expect(await lookupCaptures(input,adapter([]))).toEqual([]);
});
test('conflicting records for one exact snapshot are rejected',async()=>{
  const first=row('20190101000000'),second=[...first];second[4]='B'.repeat(32);
  await expect(lookupCaptures(input,adapter([first,second]))).rejects.toMatchObject({code:'archive_invalid_response'});
});
test('cancellation aborts the transport and does not accept late output',async()=>{
  const controller=new AbortController();let transportSignal;
  const pending=lookupCaptures({...input,signal:controller.signal},{readCdx:async({signal})=>{
    transportSignal=signal;return new Promise(()=>{});
  }});
  await Promise.resolve();controller.abort();
  await expect(pending).rejects.toMatchObject({code:'archive_cancelled'});
  expect(transportSignal.aborted).toBe(true);
});
test('discovery has a deadline even if the adapter does not settle',async()=>{
  jest.useFakeTimers();
  try {
    const pending=lookupCaptures(input,{readCdx:async()=>new Promise(()=>{})});
    const rejected=expect(pending).rejects.toMatchObject({code:'archive_timeout'});
    await jest.advanceTimersByTimeAsync(10000);await rejected;
  } finally {jest.useRealTimers();}
});
test.each([{limit:0},{limit:101},{before:'2020-02-30T00:00:00.000Z'},{originalUrl:'https://user:secret@example.com/'},{originalUrl:'https://example.com/*'}])('invalid discovery input never calls the provider',async change=>{
  let calls=0;
  await expect(lookupCaptures({...input,...change},{readCdx:async()=>{calls++;}})).rejects.toThrow();
  expect(calls).toBe(0);
});

const {Readable}=require('stream');
const {fetchDocument}=require('../discovery/fetch-document');
const {createSourceRegistry}=require('../discovery/registry');
const {openStore,migrate}=require('../storage');
const registry=createSourceRegistry([{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/plain'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
const input={registry,sourceId:'fixture',url:'https://records.example.org/start'};
let db,now;
beforeEach(()=>{db=openStore(':memory:');migrate(db);input.db=db;now=1000;});
afterEach(()=>db.close());
const clock=()=>{const value=now;now+=10000;return value;};
const resolver=async()=>[{address:'8.8.8.8',family:4}];
function response(statusCode,headers={},text='fixture') {const r=Readable.from([Buffer.from(text)]);r.statusCode=statusCode;r.headers={'content-type':'text/plain',...headers};return r;}
test('follows approved relative redirect and returns only safe metadata',async()=>{
  const visited=[];const responses=[response(302,{location:'/final'}),response(200,{etag:'version-1','set-cookie':'private'})];
  const result=await fetchDocument(input,{clock,resolver,request:async({url,target})=>{visited.push({url,address:target.address});return responses.shift();}});
  expect(visited).toEqual([{url:input.url,address:'8.8.8.8'},{url:'https://records.example.org/final',address:'8.8.8.8'}]);
  expect(result.bytes.toString()).toBe('fixture');expect(result.finalUrl).toBe('https://records.example.org/final');
  expect(result.headers).toEqual({'content-type':'text/plain',etag:'version-1'});
});
test.each(['https://127.0.0.1/','http://records.example.org/','https://attacker.example/','https://user:pass@records.example.org/'])('rejects redirect %s before a second request',async location=>{
  let requests=0;
  await expect(fetchDocument(input,{resolver,request:async()=>{requests++;return response(302,{location});}})).rejects.toThrow();
  expect(requests).toBe(1);
});
test('revalidates DNS on same-host redirect and stops rebinding',async()=>{
  let lookups=0,requests=0;
  await expect(fetchDocument(input,{clock,resolver:async()=>[{address:++lookups===1?'8.8.8.8':'127.0.0.1',family:4}],request:async()=>{requests++;return response(302,{location:'/next'});}})).rejects.toMatchObject({code:'blocked_target'});
  expect(requests).toBe(1);expect(lookups).toBe(2);
});
test('limits redirects to three and destroys redirect bodies',async()=>{
  const responses=[];
  await expect(fetchDocument(input,{clock,resolver,request:async()=>{const r=response(302,{location:'/step'+responses.length});responses.push(r);return r;}})).rejects.toMatchObject({code:'redirect_limit'});
  expect(responses).toHaveLength(4);expect(responses.every(r=>r.destroyed)).toBe(true);
});
test.each([401,403,404,500])('does not import HTTP %s bodies',async status=>{
  const r=response(status);
  await expect(fetchDocument(input,{resolver,request:async()=>r})).rejects.toMatchObject({code:'http_status'});
  expect(r.destroyed).toBe(true);
});
test.each([429,503])('persists Retry-After for HTTP %s and does not retain its body',async status=>{
  const r=response(status,{'retry-after':'120'});
  await expect(fetchDocument(input,{clock:()=>1000,resolver,request:async()=>r})).rejects.toMatchObject({code:'upstream_backoff',retryAt:121000,continuation:{url:input.url,redirects:[]}});
  expect(r.destroyed).toBe(true);
  expect(db.prepare('SELECT next_allowed_ms FROM source_fetch_limits').get().next_allowed_ms).toBe(121000);
  let called=false;
  await expect(fetchDocument(input,{clock:()=>11000,resolver,request:async()=>{called=true;return response(200);}})).rejects.toMatchObject({code:'rate_limited',retryAt:121000});
  expect(called).toBe(false);
});
test.each([['invalid',61000],['-1',61000],['999999999999',86401000],['Thu, 01 Jan 1970 00:02:00 GMT',120000]])('bounds Retry-After %s',async(header,retryAt)=>{
  await expect(fetchDocument(input,{clock:()=>1000,resolver,request:async()=>response(429,{'retry-after':header})})).rejects.toMatchObject({code:'upstream_backoff',retryAt});
});
test('overall deadline also bounds a stalled transport',async()=>{
  jest.useFakeTimers();
  try {
    const pending=fetchDocument(input,{resolver,request:()=>new Promise(()=>{})});
    const assertion=expect(pending).rejects.toMatchObject({code:'timeout'});
    await jest.advanceTimersByTimeAsync(15000);await assertion;
    expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
});
test('rate denial occurs before DNS or request and exposes a retry time',async()=>{
  db.prepare('INSERT INTO source_fetch_limits VALUES(?,?)').run('records.example.org',11000);
  let calls=0;
  await expect(fetchDocument(input,{clock:()=>1000,resolver:async()=>{calls++;return [];},request:async()=>{calls++;}})).rejects.toMatchObject({code:'rate_limited',retryAt:11000,continuation:{url:input.url,redirects:[]}});
  expect(calls).toBe(0);
});
test('redirect pacing preserves continuation without issuing second request',async()=>{
  let requests=0;
  await expect(fetchDocument(input,{clock:()=>1000,resolver,request:async()=>{requests++;return response(302,{location:'/next'});}})).rejects.toMatchObject({code:'rate_limited',retryAt:11000,continuation:{url:'https://records.example.org/next',redirects:[{url:input.url,status:302}]}});
  expect(requests).toBe(1);
});
test('resumes paced redirects without refetching the origin',async()=>{
  let continuation;
  try {await fetchDocument(input,{clock:()=>1000,resolver,request:async()=>response(302,{location:'/next'})});}
  catch(error){expect(error.code).toBe('rate_limited');continuation=error.continuation;}
  const visited=[];
  const result=await fetchDocument({...input,continuation},{clock:()=>11000,resolver,request:async({url})=>{visited.push(url);return response(200);}});
  expect(visited).toEqual(['https://records.example.org/next']);
  expect(result.redirects).toEqual([{url:input.url,status:302}]);
});
test('resuming does not reset the cumulative redirect limit',async()=>{
  const continuation={url:'https://records.example.org/final',redirects:[
    {url:input.url,status:302},{url:'https://records.example.org/second',status:301},{url:'https://records.example.org/third',status:307}
  ]};
  let requests=0;
  await expect(fetchDocument({...input,continuation},{clock,resolver,request:async()=>{requests++;return response(302,{location:'/fourth'});}})).rejects.toMatchObject({code:'redirect_limit'});
  expect(requests).toBe(1);
});
test.each([
  {url:'https://127.0.0.1/',redirects:[]},
  {url:'https://records.example.org/next',redirects:[{url:'https://records.example.org/not-original',status:302}]},
  {url:'https://records.example.org/next',redirects:[{url:input.url,status:200}]},
  {url:input.url,redirects:[{url:input.url,status:302}]}
])('rejects invalid continuation before network activity',async continuation=>{
  let requests=0;
  await expect(fetchDocument({...input,continuation},{clock,resolver,request:async()=>{requests++;return response(200);}})).rejects.toThrow();
  expect(requests).toBe(0);
});

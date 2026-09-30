const {EventEmitter}=require('events');
const {Readable}=require('stream');
const {requestPinned}=require('../discovery/pinned-request');
const target={hostname:'records.example.org',servername:'records.example.org',address:'8.8.8.8',family:4,lookup:()=>{}};
function fixture() {
  const state={};
  state.request=(options,callback)=>{
    state.options=options;
    state.req=new EventEmitter();
    state.req.end=()=>{state.ended=true;};
    state.req.destroy=error=>{state.destroyed=true;if(error)state.req.emit('error',error);};
    state.respond=()=>{state.response=Readable.from([Buffer.from('fixture')]);callback(state.response);};
    return state.req;
  };
  return state;
}
test('HTTPS uses pinned lookup, original TLS name, and no credentials or pooled sockets',async()=>{
  const f=fixture();
  const pending=requestPinned({url:'https://records.example.org/document?q=1#section',target},f.request);
  expect(f.options).toMatchObject({protocol:'https:',hostname:target.hostname,servername:target.hostname,
    port:443,path:'/document?q=1',method:'GET',lookup:target.lookup,agent:false,rejectUnauthorized:true});
  expect(Object.keys(f.options.headers).sort()).toEqual(['accept','accept-encoding','user-agent']);
  expect(f.ended).toBe(true);f.respond();expect(await pending).toBe(f.response);f.response.destroy();
});
test.each(['https://other.example/','http://records.example.org/','https://user:pass@records.example.org/','https://records.example.org:8443/'])('rejects inconsistent request %s before opening socket',async url=>{
  let called=false;
  await expect(requestPinned({url,target},()=>{called=true;})).rejects.toMatchObject({code:'blocked_target'});
  expect(called).toBe(false);
});
test('pre-aborted signal prevents request creation',async()=>{
  const controller=new AbortController();controller.abort();let called=false;
  await expect(requestPinned({url:'https://records.example.org/',target,signal:controller.signal},()=>{called=true;})).rejects.toMatchObject({code:'aborted'});
  expect(called).toBe(false);
});
test('cancellation destroys an in-flight request',async()=>{
  const f=fixture(),controller=new AbortController();
  const pending=requestPinned({url:'https://records.example.org/',target,signal:controller.signal},f.request);
  const assertion=expect(pending).rejects.toMatchObject({code:'aborted'});
  controller.abort();await assertion;expect(f.destroyed).toBe(true);
});
test('socket failures are sanitized without leaking URL query strings',async()=>{
  const f=fixture();const pending=requestPinned({url:'https://records.example.org/?token=private',target},f.request);
  f.req.emit('error',new Error('private socket diagnostics'));
  await expect(pending).rejects.toMatchObject({code:'fetch_failed',message:'Document request failed'});
});
test('connection deadline destroys stalled requests',async()=>{
  jest.useFakeTimers();
  try {
    const f=fixture();const pending=requestPinned({url:'https://records.example.org/',target},f.request);
    const assertion=expect(pending).rejects.toMatchObject({code:'timeout'});
    await jest.advanceTimersByTimeAsync(15000);
    await assertion;expect(f.destroyed).toBe(true);expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
});

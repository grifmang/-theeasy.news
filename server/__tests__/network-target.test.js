const {isPublicAddress,resolveTarget}=require('../discovery/network-target');
const {createSourceRegistry}=require('../discovery/registry');
const registry=createSourceRegistry([{id:'fixture',hosts:['records.example.org'],mimeTypes:['text/html'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6}]);
test.each(['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.0.1','192.0.2.1','224.1.1.1','240.0.0.1','::','::1','::ffff:8.8.8.8','fe80::1','fc00::1','2001:db8::1','2002:808:808::1','64:ff9b::808:808','3fff::1','fe80::1%eth0','2130706433','127.1'])('blocks nonpublic or ambiguous address %s',address=>{
  expect(isPublicAddress(address)).toBe(false);
});
test.each(['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])('allows global address %s',address=>{
  expect(isPublicAddress(address)).toBe(true);
});
test('rejects a mixed public/private DNS answer',async()=>{
  await expect(resolveTarget({registry,sourceId:'fixture',url:'https://records.example.org/'},async()=>[
    {address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}
  ])).rejects.toMatchObject({code:'blocked_target'});
});
test('pinned lookup never resolves the hostname again',async()=>{
  let resolutions=0;
  const answer={address:'8.8.8.8',family:4};
  const target=await resolveTarget({registry,sourceId:'fixture',url:'https://records.example.org/'},async()=>{resolutions++;return [answer];});
  answer.address='127.0.0.1';
  const lookup=options=>new Promise((resolve,reject)=>target.lookup('records.example.org',options,(error,address,family)=>error?reject(error):resolve({address,family})));
  expect(await lookup({})).toEqual({address:'8.8.8.8',family:4});
  expect(await lookup({all:true})).toEqual({address:[{address:'8.8.8.8',family:4}],family:undefined});
  expect(resolutions).toBe(1);
  expect(target.servername).toBe('records.example.org');
});
test('policy rejection occurs before DNS',async()=>{
  let called=false;
  await expect(resolveTarget({registry,sourceId:'fixture',url:'https://unapproved.example/'},async()=>{called=true;return [];})).rejects.toThrow();
  expect(called).toBe(false);
});
test.each([{answer:[]},{answer:[{address:'8.8.8.8',family:6}]},{answer:[{address:'bad',family:4}]}])('rejects invalid DNS answers',async ({answer})=>{
  await expect(resolveTarget({registry,sourceId:'fixture',url:'https://records.example.org/'},async()=>answer)).rejects.toMatchObject({code:'blocked_target'});
});
test('pre-cancelled requests never start DNS resolution',async()=>{
  const controller=new AbortController();controller.abort();
  let called=false;
  await expect(resolveTarget({registry,sourceId:'fixture',url:'https://records.example.org/',signal:controller.signal},async()=>{
    called=true;return [{address:'8.8.8.8',family:4}];
  })).rejects.toMatchObject({code:'aborted'});
  expect(called).toBe(false);
});
test('cancellation settles a pending lookup and discards late answers',async()=>{
  const controller=new AbortController();let finish;
  const promise=resolveTarget({registry,sourceId:'fixture',url:'https://records.example.org/',signal:controller.signal},()=>new Promise(resolve=>{finish=resolve;}));
  const assertion=expect(promise).rejects.toMatchObject({code:'aborted'});
  await Promise.resolve();controller.abort();
  finish([{address:'8.8.8.8',family:4}]);
  await assertion;
});
test('stalled DNS resolution has a fifteen-second deadline',async()=>{
  jest.useFakeTimers();
  try {
    const promise=resolveTarget({registry,sourceId:'fixture',url:'https://records.example.org/'},()=>new Promise(()=>{}));
    const assertion=expect(promise).rejects.toMatchObject({code:'timeout'});
    await jest.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
});

const {startWorkerLoop}=require('../worker-loop');
afterEach(()=>jest.useRealTimers());
test('worker runs never overlap and shutdown drains active work',async()=>{
  jest.useFakeTimers();let calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const loop=startWorkerLoop({intervalMs:100,runNext:async()=>{calls++;await gate;}});
  await jest.advanceTimersByTimeAsync(1000);expect(calls).toBe(1);
  let stopped=false;const stopping=loop.stop().then(()=>{stopped=true;});
  await Promise.resolve();expect(stopped).toBe(false);
  release();await stopping;
  await jest.advanceTimersByTimeAsync(1000);expect(calls).toBe(1);
});
test('stop aborts active work and can be called repeatedly',async()=>{
  let observed;
  const loop=startWorkerLoop({runNext:({signal})=>{observed=signal;return new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}});
  await Promise.resolve();await loop.stop();await loop.stop();expect(observed.aborted).toBe(true);
});
test('errors emit only a sanitized event and wait before retrying',async()=>{
  jest.useFakeTimers();let calls=0;const errors=[];
  const loop=startWorkerLoop({intervalMs:100,runNext:async()=>{calls++;throw new Error('private evidence');},onError:event=>errors.push(event)});
  await jest.advanceTimersByTimeAsync(0);expect(errors).toEqual([{code:'worker_failure'}]);
  await jest.advanceTimersByTimeAsync(99);expect(calls).toBe(1);
  await jest.advanceTimersByTimeAsync(1);expect(calls).toBe(2);
  await loop.stop();
});

function startWorkerLoop({runNext,intervalMs=1000,onError=()=>{}}) {
  if(typeof runNext!=='function' || typeof onError!=='function' || !Number.isInteger(intervalMs) || intervalMs<100 || intervalMs>60000) throw new Error('Invalid worker loop configuration');
  const controller=new AbortController();
  let stopped=false,timer,active;
  function tick() {
    active=Promise.resolve().then(()=>stopped?undefined:runNext({signal:controller.signal}))
      .catch(()=>{try {onError({code:'worker_failure'});} catch {}})
      .finally(()=>{if(!stopped) {timer=setTimeout(tick,intervalMs);timer.unref?.();}});
  }
  tick();
  function stop() {
    stopped=true;clearTimeout(timer);controller.abort();return active;
  }
  return {stop};
}
module.exports={startWorkerLoop};

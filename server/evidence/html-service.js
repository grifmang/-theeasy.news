const {loadHtmlRuntime}=require('./html-runtime');
const {extractFetchHtml}=require('./extract-fetch');

// One parser per service process; no unbounded request queue. Deployment must
// remain single-process/single-replica until a cross-process admission limit exists.
async function createHtmlExtractionService({db,archive,runtime}) {
  const installed=await loadHtmlRuntime(runtime);
  let active=null,stopped=false;
  const failure=code=>Object.assign(new Error('HTML extraction unavailable'),{code});
  return {
    async extract(request,{signal}={}) {
      if(stopped) throw failure('html_stopped');
      if(signal?.aborted) throw failure('html_cancelled');
      if(active) throw failure('html_busy');
      const controller=new AbortController(),abort=()=>controller.abort();
      signal?.addEventListener('abort',abort,{once:true});
      const operation={controller};
      active=operation;
      operation.promise=Promise.resolve().then(()=>extractFetchHtml(db,request,archive,{...installed,signal:controller.signal}))
        .finally(()=>{signal?.removeEventListener('abort',abort);if(active===operation) active=null;});
      return operation.promise;
    },
    async stop() {
      stopped=true;
      const operation=active;
      if(operation) {operation.controller.abort();try {await operation.promise;} catch {/* Caller owns failure reporting. */}}
    }
  };
}
module.exports={createHtmlExtractionService};

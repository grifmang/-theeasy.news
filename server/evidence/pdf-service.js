const {loadPdfRuntime}=require('./pdf-runtime');
const {extractPdf}=require('./extract-pdf');
const {extractFetchPdf}=require('./extract-fetch');

// Internal byte-extraction service. Receipt authorization/persistence belongs to
// the intake layer. Single service instance/process and single replica required.
async function createPdfExtractionService({runtime,db,archive}) {
  const installed=await loadPdfRuntime(runtime);
  let active=null,stopped=false;
  const failure=code=>Object.assign(new Error('PDF extraction unavailable'),{code});
  async function admit(prepare,signal) {
      if(stopped)throw failure('pdf_stopped');
      if(signal?.aborted)throw failure('pdf_cancelled');
      if(active)throw failure('pdf_busy');
      const work=prepare();
      const controller=new AbortController(),abort=()=>controller.abort();
      signal?.addEventListener('abort',abort,{once:true});
      const operation={controller};active=operation;
      operation.promise=Promise.resolve().then(()=>work(controller.signal))
        .finally(()=>{signal?.removeEventListener('abort',abort);if(active===operation)active=null;});
      return operation.promise;
  }
  return {
    async extract(bytes,{signal}={}) {
      return admit(()=>{
        if(!Buffer.isBuffer(bytes)||bytes.length<5||bytes.length>26214400)throw failure('pdf_input');
        const input=Buffer.from(bytes);
        return activeSignal=>extractPdf(input,{runtime:installed,signal:activeSignal});
      },signal);
    },
    async extractReceipt(request,{signal}={}) {
      return admit(()=>{
        if(!db||!archive)throw failure('pdf_intake_unavailable');
        const input={receiptId:request?.receiptId,actorId:request?.actorId};
        return activeSignal=>extractFetchPdf(db,input,archive,{
          extract:bytes=>extractPdf(bytes,{runtime:installed,signal:activeSignal})
        },{signal:activeSignal});
      },signal);
    },
    async stop() {
      stopped=true;
      const operation=active;
      if(operation) {
        operation.controller.abort();
        try {await operation.promise;} catch {/* Original caller receives the error. */}
      }
    }
  };
}
module.exports={createPdfExtractionService};

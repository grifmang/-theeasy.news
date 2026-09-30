// Import-inert release check. Run as the actual non-root application account.
const {loadPdfRuntime}=require('../evidence/pdf-runtime');
if(require.main===module) {
  (async()=>{
    if(process.argv.length!==5) throw new Error('Usage: check-pdf-runtime <bundle-directory> <digest-file> <scratch-directory>');
    const runtime=await loadPdfRuntime({bundleDirectory:process.argv[2],digestFile:process.argv[3],scratchParent:process.argv[4]});
    console.log(JSON.stringify({ready:true,kind:runtime.kind,extractorVersion:'poppler-22.12.0-deb12u3-tesseract-5.3.0-eng-v1'}));
  })().catch(error=>{console.error('PDF runtime rejected:',error.message);process.exitCode=1;});
}

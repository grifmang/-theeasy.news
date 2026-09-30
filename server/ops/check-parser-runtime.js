// Import-inert release check. Run as the actual non-root application account.
const {loadHtmlRuntime}=require('../evidence/html-runtime');
if(require.main===module) {
  (async()=>{
    if(process.argv.length!==5) throw new Error('Usage: check-parser-runtime <bundle-directory> <digest-file> <scratch-directory>');
    await loadHtmlRuntime({bundleDirectory:process.argv[2],digestFile:process.argv[3],scratchParent:process.argv[4]});
    console.log(JSON.stringify({ready:true,extractorVersion:'parse5-8.0.1-text-v1'}));
  })().catch(error=>{console.error('Parser runtime rejected:',error.message);process.exitCode=1;});
}

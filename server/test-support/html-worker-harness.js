// Fidelity/lifecycle fixtures only. NOT a production extraction entry point.
const path=require('path');
const {runHtmlProcess}=require('../evidence/html-process');
function extractHtml(bytes,{signal}={}) {
  return runHtmlProcess(bytes,{signal,executable:process.execPath,
    args:['--max-old-space-size=128',path.join(__dirname,'../evidence/html-parser-worker.mjs')]});
}
module.exports={extractHtml};

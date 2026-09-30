const http=require('http');
// Explicit operator mode for a controlled release. No DB, authentication,
// ingestion, parser or model initialization; never a fallback after startup fails.
async function startMaintenance({port,host}) {
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const health=req.method==='GET'&&['/health/live','/health/ready'].includes(req.url);
    res.statusCode=health?200:503;
    if(!health) res.setHeader('Retry-After','60');
    res.end(JSON.stringify(health?{status:'maintenance',writesEnabled:false}:{error:'Scheduled maintenance; please retry shortly'}));
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});
  });
  let stopping;
  return {server,db:null,app:null,stop() {
    if(!stopping) stopping=new Promise((resolve,reject)=>{
      server.close(error=>error?reject(error):resolve());server.closeAllConnections();
    });
    return stopping;
  }};
}
module.exports={startMaintenance};

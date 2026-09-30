const fs=require('fs'),os=require('os'),path=require('path');
const https=require('https');
const {spawnSync}=require('child_process');
const {requestPinned}=require('../discovery/pinned-request');
const {readDocumentBody}=require('../discovery/document-body');
let directory,server,certificate,port;
beforeAll(async()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-tls-'));
  const executable=process.env.OPENSSL_PATH||
    (process.platform==='win32'&&fs.existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
  const key=path.join(directory,'key.pem'),cert=path.join(directory,'cert.pem');
  const generated=spawnSync(executable,['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',key,'-out',cert,'-days','1','-subj','/CN=records.example.org',
    '-addext','subjectAltName=DNS:records.example.org'],{encoding:'utf8',timeout:15000});
  if(generated.error||generated.status!==0) throw new Error('TLS tests require OpenSSL (set OPENSSL_PATH)');
  certificate=fs.readFileSync(cert);
  server=https.createServer({key:fs.readFileSync(key),cert:certificate},(req,res)=>{
    res.writeHead(200,{'content-type':'text/plain'});
    res.end(req.socket.servername+' '+req.url);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  port=server.address().port;
});
afterAll(async()=>{
  if(server) await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
  if(directory) fs.rmSync(directory,{recursive:true,force:true});
});
function target(hostname='records.example.org') {
  return {hostname,servername:hostname,family:4,lookup:(host,options,callback)=>{
    if(host!==hostname) return callback(new Error('Unexpected DNS target'));
    callback(null,...(options.all?[[{address:'127.0.0.1',family:4}]]:['127.0.0.1',4]));
  }};
}
// Test-only adapter changes port and trust root, not TLS verification or SNI.
const transport=(trusted=true)=>(options,callback)=>https.request({...options,port,...(trusted?{ca:certificate}:{})},callback);
test('real TLS uses pinned address while validating original hostname',async()=>{
  const response=await requestPinned({url:'https://records.example.org/document?q=1',target:target()},transport());
  const body=await readDocumentBody(response,{mimeTypes:['text/plain']});
  expect(body.bytes.toString()).toBe('records.example.org /document?q=1');
});
test('real TLS rejects a trusted certificate for a different hostname',async()=>{
  await expect(requestPinned({url:'https://other.example.org/',target:target('other.example.org')},transport()))
    .rejects.toMatchObject({code:'fetch_failed'});
});
test('real TLS rejects untrusted certificates',async()=>{
  await expect(requestPinned({url:'https://records.example.org/',target:target()},transport(false)))
    .rejects.toMatchObject({code:'fetch_failed'});
});

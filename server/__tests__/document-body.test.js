const {Readable}=require('stream');
const zlib=require('zlib');
const {readDocumentBody}=require('../discovery/document-body');
function response(bytes,headers={}) {
  const stream=Readable.from([bytes]);stream.headers={'content-type':'text/plain',...headers};return stream;
}
test.each(['identity','gzip','deflate','br'])('decodes %s within byte bounds',async encoding=>{
  const original=Buffer.from('Evidence fixture');
  const bytes=({gzip:zlib.gzipSync,deflate:zlib.deflateSync,br:zlib.brotliCompressSync}[encoding]||((b)=>b))(original);
  const result=await readDocumentBody(response(bytes,{'content-encoding':encoding}),{mimeTypes:['text/plain'],maxBytes:100});
  expect(result.bytes).toEqual(original);expect(result.mime).toBe('text/plain');
});
test('blocks decompression bombs',async()=>{
  await expect(readDocumentBody(response(zlib.gzipSync(Buffer.alloc(10000,65)),{'content-encoding':'gzip'}),{mimeTypes:['text/plain'],maxBytes:100})).rejects.toMatchObject({code:'body_too_large'});
});
test('enforces actual bytes even without content length',async()=>{
  await expect(readDocumentBody(response(Buffer.alloc(101)),{mimeTypes:['text/plain'],maxBytes:100})).rejects.toMatchObject({code:'body_too_large'});
});
test('rejects oversized declared body before reading it',async()=>{
  const stream=response(Buffer.from('x'),{'content-length':'101'});
  await expect(readDocumentBody(stream,{mimeTypes:['text/plain'],maxBytes:100})).rejects.toMatchObject({code:'body_too_large'});
  expect(stream.destroyed).toBe(true);
});
test.each([{'content-encoding':'gzip, br'},{'content-type':'application/javascript'},{'content-type':''},{'content-length':'not-a-number'}])('rejects unsupported headers %j',async headers=>{
  await expect(readDocumentBody(response(Buffer.from('fixture'),headers),{mimeTypes:['text/plain']})).rejects.toMatchObject({code:'invalid_response'});
});
test('rejects corrupt compression without exposing parser details',async()=>{
  await expect(readDocumentBody(response(Buffer.from('private corrupt bytes'),{'content-encoding':'gzip'}),{mimeTypes:['text/plain']})).rejects.toMatchObject({code:'invalid_body',message:'Document body could not be decoded'});
});
test('cancellation destroys body stream',async()=>{
  const controller=new AbortController();controller.abort();const stream=response(Buffer.from('fixture'));
  await expect(readDocumentBody(stream,{mimeTypes:['text/plain'],signal:controller.signal})).rejects.toMatchObject({code:'aborted'});
  expect(stream.destroyed).toBe(true);
});

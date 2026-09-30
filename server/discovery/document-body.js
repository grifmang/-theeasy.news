const {Transform,PassThrough,Writable}=require('stream');
const {pipeline}=require('stream/promises');
const zlib=require('zlib');
const MAX_BYTES=25*1024*1024;
const error=(code,message)=>Object.assign(new Error(message),{code});

async function readDocumentBody(response,{mimeTypes,maxBytes=MAX_BYTES,signal}={}) {
  const rejectHeaders=(code='invalid_response')=>{
    response.destroy();throw error(code,'Document response rejected');
  };
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES||!Array.isArray(mimeTypes)) return rejectHeaders();
  if(signal?.aborted) return rejectHeaders('aborted');
  const headers=response.headers||{};
  if(typeof headers['content-type']!=='string') return rejectHeaders();
  const mime=headers['content-type'].split(';')[0].trim().toLowerCase();
  if(!mimeTypes.includes(mime)) return rejectHeaders();
  const encoding=headers['content-encoding']===undefined?'identity':headers['content-encoding'];
  if(typeof encoding!=='string'||!['identity','gzip','deflate','br'].includes(encoding)) return rejectHeaders();
  const length=headers['content-length'];
  if(length!==undefined && (typeof length!=='string'||!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length)))) return rejectHeaders();
  if(length!==undefined && Number(length)>maxBytes) return rejectHeaders('body_too_large');
  let wireBytes=0,decodedBytes=0;
  const wireLimit=new Transform({transform(chunk,enc,callback){
    wireBytes+=chunk.length;
    callback(wireBytes>maxBytes?error('body_too_large','Document exceeds byte limit'):null,chunk);
  }});
  const decoder=encoding==='gzip'?zlib.createGunzip():encoding==='deflate'?zlib.createInflate():
    encoding==='br'?zlib.createBrotliDecompress():new PassThrough();
  const chunks=[];
  const sink=new Writable({write(chunk,enc,callback){
    decodedBytes+=chunk.length;
    if(decodedBytes>maxBytes) return callback(error('body_too_large','Document exceeds byte limit'));
    chunks.push(Buffer.from(chunk));callback();
  }});
  try {
    await pipeline(response,wireLimit,decoder,sink,{signal});
    if(length!==undefined && wireBytes!==Number(length)) throw error('invalid_body','Document body could not be decoded');
    return {bytes:Buffer.concat(chunks,decodedBytes),mime,encoding,wireBytes};
  } catch(cause) {
    if(signal?.aborted || cause.code==='ABORT_ERR') throw error('aborted','Document body read cancelled');
    if(cause.code==='body_too_large') throw error('body_too_large','Document exceeds byte limit');
    throw error('invalid_body','Document body could not be decoded');
  }
}
module.exports={readDocumentBody,MAX_BYTES};

const fs=require('fs');
const path=require('path');
const {createHash,randomUUID}=require('crypto');
const MAX_BYTES=25*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function createLocalArchive(root) {
  if(typeof root!=='string' || !path.isAbsolute(root) || !fs.statSync(root).isDirectory()) throw new Error('Existing absolute private archive directory required');
  const directory=fs.realpathSync(root);
  function target(key) {
    if(typeof key!=='string' || !/^[a-f0-9]{64}\.bin$/.test(key)) throw new Error('Invalid archive key');
    return path.join(directory,key);
  }
  function readChecked(record) {
    if(!record || record.key!==`${record.sha256}.bin` || !Number.isSafeInteger(record.size) || record.size<1 || record.size>MAX_BYTES) throw new Error('Invalid archive record');
    const filename=target(record.key);
    const stat=fs.lstatSync(filename);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size!==record.size) throw new Error('Original integrity failure');
    const bytes=fs.readFileSync(filename);
    if(bytes.length!==record.size || hash(bytes)!==record.sha256) throw new Error('Original integrity failure');
    return bytes;
  }
  async function archiveOriginal({bytes,mime,accessPolicy}) {
    if(accessPolicy!=='private') throw new Error('Original storage must remain private');
    if(!Buffer.isBuffer(bytes) || bytes.length<1 || bytes.length>MAX_BYTES) throw new Error('Invalid original size');
    if(typeof mime!=='string' || mime.length>200 || !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) throw new Error('Invalid MIME');
    const sha256=hash(bytes);
    const record={sha256,key:`${sha256}.bin`,size:bytes.length,mime};
    const filename=target(record.key);
    if(fs.existsSync(filename)) {readChecked(record);return record;}
    // Link a complete fsynced temporary file into place without overwriting.
    const temporary=path.join(directory,`${randomUUID()}.pending`);
    const handle=fs.openSync(temporary,'wx',0o600);
    try {
      fs.writeFileSync(handle,bytes);fs.fsyncSync(handle);
    } finally {fs.closeSync(handle);}
    try {
      try {fs.linkSync(temporary,filename);} catch(error) {if(error.code!=='EEXIST') throw error;}
      readChecked(record);
    } finally {fs.unlinkSync(temporary);}
    return record;
  }
  return {archiveOriginal,readOriginal:async record=>readChecked(record)};
}
module.exports={createLocalArchive};

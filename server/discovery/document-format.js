const {TextDecoder}=require('util');
function mismatch() {return Object.assign(new Error('Document format requires manual review'),{code:'format_mismatch'});}

// Conservative preliminary screening only. Passing does not establish valid
// PDF syntax, safe HTML, extraction quality, source authenticity, or truth.
// Non-UTF-8 text is routed for a reviewed transcoding path, never silently lost.
function screenDocumentFormat(bytes,mime) {
  if(!Buffer.isBuffer(bytes)||!bytes.length) throw mismatch();
  const prefix=bytes.subarray(0,1024).toString('latin1');
  const pdf=/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(prefix);
  if(mime==='application/pdf') {
    if(!pdf) throw mismatch();
  } else {
    if(!['text/plain','text/html'].includes(mime)||prefix.startsWith('%PDF-')||
      prefix.startsWith('PK\x03\x04')||prefix.startsWith('\x7fELF')||
      bytes.includes(0)) throw mismatch();
    let text;
    try {text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {throw mismatch();}
    if(!text.trim()||/[\u0001-\u0008\u000b\u000e-\u001f]/.test(text)) throw mismatch();
    const html=/<(?:!doctype\s+html\b|html\b|head\b|body\b)/i.test(text.slice(0,8192));
    if((mime==='text/html'&&!html)||(mime==='text/plain'&&html)) throw mismatch();
  }
  return {mime,requiresExtraction:true};
}
module.exports={screenDocumentFormat};

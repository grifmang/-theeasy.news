import {mapPdfPage} from './pdf-page.mjs';

// Operator-launched sandbox worker: bounded Poppler output on stdin, JSON stdout.
// Page ordinal is supplied by the supervisor, never inferred from document text.
try {
  if(process.argv.length!==3||!/^\d{1,3}$/.test(process.argv[2]))throw new Error();
  const page=Number(process.argv[2]);
  if(page<1||page>200)throw new Error();
  const chunks=[];let size=0;
  for await(const chunk of process.stdin) {
    size+=chunk.length;
    if(size>8388608)throw new Error();
    chunks.push(chunk);
  }
  const result=mapPdfPage(Buffer.concat(chunks,size),page);
  const encoded=Buffer.from(JSON.stringify(result));
  if(encoded.length>8388608)throw new Error();
  process.stdout.write(encoded);
} catch {
  // Never emit source content, parser diagnostics, stack traces or partial JSON.
  process.exitCode=1;
}

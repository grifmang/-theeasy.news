import {mapOcrPage} from './ocr-page.mjs';
try {
  if(process.argv.length!==5)throw new Error();
  const [page,width,height]=process.argv.slice(2).map(Number);
  const chunks=[];let size=0;
  for await(const chunk of process.stdin) {
    size+=chunk.length;if(size>8388608)throw new Error();chunks.push(chunk);
  }
  const result=mapOcrPage(Buffer.concat(chunks,size),{page,width,height});
  const output=Buffer.from(JSON.stringify(result));if(output.length>8388608)throw new Error();
  process.stdout.write(output);
} catch {process.exitCode=1;}

// Bounded Tesseract TSV mapping. Intended only for the isolated worker.
export function mapOcrPage(bytes,{page,width,height}) {
  const fail=()=>{throw new Error('Invalid OCR page');};
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8388608||
    !Number.isSafeInteger(page)||page<1||page>200||
    ![width,height].every(n=>Number.isFinite(n)&&n>0&&n<=14400))fail();
  const lines=new TextDecoder('utf-8',{fatal:true}).decode(bytes).split(/\r?\n/);
  if(lines.shift()!=='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'||lines.length>100000)fail();
  let text='',imageWidth=0,imageHeight=0,previousLine=null,lowConfidenceWords=0;
  const words=[];
  for(const line of lines) {
    if(line==='')continue;
    const fields=line.split('\t');if(fields.length!==12)fail();
    const integers=fields.slice(0,10).map(value=>/^\d+$/.test(value)?Number(value):NaN);
    if(!integers.every(Number.isSafeInteger))fail();
    const [level,pageNum,block,paragraph,row,word,left,top,w,h]=integers;
    if(level<1||level>5||pageNum!==1||!/^\-?\d+(?:\.\d+)?$/.test(fields[10]))fail();
    const confidence=Number(fields[10]);
    if(!Number.isFinite(confidence)||confidence< -1||confidence>100)fail();
    if(level===1) {
      if(imageWidth||left||top||w<1||h<1||w>4096||h>4096)fail();
      imageWidth=w;imageHeight=h;
    }
    if(!imageWidth||left+w>imageWidth||top+h>imageHeight)fail();
    if(level!==5){if(fields[11])fail();continue;}
    const value=fields[11];
    if(!value.trim())continue;
    if(word<1||w<1||h<1||confidence<0||value.length>10000||/[\u0000-\u001f\u007f]/.test(value)||words.length>=50000)fail();
    const lineKey=`${block}:${paragraph}:${row}`;
    if(text)text+=lineKey===previousLine?' ':'\n';
    previousLine=lineKey;
    const start=text.length;text+=value;if(text.length>1000000)fail();
    if(confidence<80)lowConfidenceWords++;
    words.push({page,start,end:text.length,xMin:left/imageWidth*width,yMin:top/imageHeight*height,
      xMax:(left+w)/imageWidth*width,yMax:(top+h)/imageHeight*height,confidence,method:'ocr'});
  }
  if(!imageWidth)fail();
  if(text)text+='\n';
  if(text.length>1000000)fail();
  return {text,page:{page,start:0,end:text.length,width,height},words,offsetUnit:'utf16',
    coordinateUnit:'pdf-point',coordinateOrigin:'top-left',
    quality:{requiresReview:true,requiresOcr:false,ocrDerived:true,language:'eng',lowConfidenceWords,
      warnings:['ocr_text_requires_original_comparison',...(words.length?[]:['ocr_found_no_text'])]}};
}

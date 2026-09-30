import {parse} from 'parse5';

// Internal normalization of one bounded Poppler bbox page. No network/resource
// resolution. Must run inside the eventual verified PDF worker, not on HTTP input.
export function mapPdfPage(bytes,pageNumber) {
  const fail=()=>{throw new Error('Invalid PDF page map');};
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8388608||
    !Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>200)fail();
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  let errors=0;
  // Poppler emits the XHTML1 Transitional doctype, obsolete under HTML5.
  // parse5 never fetches its DTD. Other syntax errors still fail closed.
  const document=parse(source,{onParseError:error=>{if(error.code!=='non-conforming-doctype')errors++;}});
  if(errors)fail();
  const stack=[{node:document,depth:0}];let page=null,nodes=0;
  while(stack.length) {
    const {node,depth}=stack.pop();
    if(++nodes>100000||depth>64)fail();
    if(node.tagName==='page'){if(page)fail();page=node;}
    for(const child of node.childNodes||[])stack.push({node:child,depth:depth+1});
  }
  if(!page)fail();
  const number=(node,key)=>{
    const value=node.attrs?.find(a=>a.name===key)?.value;
    if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value))fail();
    const result=Number(value);if(!Number.isFinite(result))fail();return result;
  };
  const width=number(page,'width'),height=number(page,'height');
  if(width<=0||height<=0||width>14400||height>14400)fail();
  let text='';const words=[];
  const children=node=>(node.childNodes||[]).filter(child=>{
    if(child.nodeName==='#text'){if(child.value.trim())fail();return false;}
    return true;
  });
  for(const flow of children(page)) {
    if(flow.tagName!=='flow')fail();
    for(const block of children(flow)) {
      if(block.tagName!=='block')fail();
      for(const line of children(block)) {
        if(line.tagName!=='line')fail();
        let lineWords=0;
        for(const word of children(line)) {
          if(word.tagName!=='word'||word.childNodes?.some(n=>n.nodeName!=='#text'))fail();
          const value=(word.childNodes||[]).map(n=>n.value).join('');
          if(!value.trim()||/[\u0000-\u001f\u007f]/.test(value)||value.length>10000)fail();
          const xMin=number(word,'xmin'),yMin=number(word,'ymin');
          const xMax=number(word,'xmax'),yMax=number(word,'ymax');
          if(xMin>xMax||yMin>yMax||xMax>width||yMax>height||words.length>=50000)fail();
          if(lineWords++)text+=' ';
          const start=text.length;text+=value;
          if(text.length>1000000)fail();
          words.push({start,end:text.length,page:pageNumber,xMin,yMin,xMax,yMax});
        }
        if(lineWords)text+='\n';
        if(text.length>1000000)fail();
      }
    }
  }
  return {text,page:{page:pageNumber,start:0,end:text.length,width,height},words,
    offsetUnit:'utf16',coordinateUnit:'pdf-point',coordinateOrigin:'top-left',
    quality:{requiresReview:true,requiresOcr:words.length===0,
      warnings:words.length?['reading_order_and_rendered_original_require_review']:['no_native_text_requires_ocr']}};
}

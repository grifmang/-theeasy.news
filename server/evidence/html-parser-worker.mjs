import {parse} from 'parse5';
// Parser only: never executes scripts, follows URLs, or loads page resources.
const chunks=[];let size=0;
try {
  for await(const chunk of process.stdin) {
    size+=chunk.length;if(size>26214400) throw new Error();chunks.push(chunk);
  }
  const source=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  let parseErrors=0;
  const document=parse(source,{sourceCodeLocationInfo:true,onParseError:()=>{parseErrors++;}});
  const ignored=new Set(['head','script','style','template','noscript','iframe','object','embed']);
  const blocks=new Set(['p','div','section','article','aside','header','footer','nav','li','ul','ol','h1','h2','h3','h4','h5','h6','blockquote','pre','table','tr','dl','dt','dd']);
  let text='',nodes=0;const spans=[],stack=[{node:document,exit:false}];
  const append=value=>{if(text.length+value.length>1000000) throw new Error();text+=value;};
  const line=()=>{if(text&&!text.endsWith('\n')) append('\n');};
  while(stack.length) {
    const {node,exit,preformatted=false}=stack.pop(),tag=node.tagName;
    if(exit) {if(tag==='td'||tag==='th') append('\t');else if(blocks.has(tag)) line();continue;}
    if(++nodes>100000) throw new Error();
    if(ignored.has(tag)||node.attrs?.some(a=>a.name==='hidden'||(a.name==='aria-hidden'&&a.value==='true'))) continue;
    if(node.nodeName==='#text') {
      let value=preformatted?node.value:node.value.replace(/[\t\r\n\f ]+/g,' ');
      if(!preformatted&&(!text||/[ \t\n]$/.test(text))) value=value.replace(/^ /,'');
      if(!value) continue;
      const location=node.sourceCodeLocation;if(!location) throw new Error();
      if(spans.length>=50000) throw new Error();
      const start=text.length;append(value);
      spans.push({start,end:text.length,sourceStart:location.startOffset,sourceEnd:location.endOffset});
      continue;
    }
    if(tag==='br'||blocks.has(tag)) line();
    stack.push({node,exit:true});
    const children=node.childNodes||[];
    for(let i=children.length-1;i>=0;i--) stack.push({node:children[i],exit:false,preformatted:preformatted||tag==='pre'});
  }
  if(!text.trim()) throw new Error();
  process.stdout.write(JSON.stringify({text,spans,pages:[],extractorVersion:'parse5-8.0.1-text-v1',
    quality:{requiresReview:true,parseErrors,warnings:['not_rendered','layout_and_css_unverified','source_offsets_are_utf16']}}));
} catch {process.exitCode=1;}

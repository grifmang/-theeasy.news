const {createJevTransport}=require('../models/jev-transport');
const request={model:'jev-1.13.0',state:'fixture',questions:{}};
test('transport uses fixed endpoint, disables redirects and returns parsed response',async()=>{
  let sent;
  const client=createJevTransport({apiKey:'fixture-secret',fetchImpl:async(url,options)=>{
    sent={url,options};return new Response(JSON.stringify({model:'jev-1.13.0',answers:{},usage:{input_tokens:10,output_tokens:0}}),{headers:{'Content-Type':'application/json','x-request-id':'fixture-id'}});
  }});
  const result=await client.evaluate(request);
  expect(sent.url).toBe('https://api.typesafe.ai/v1/systemone');
  expect(sent.options).toMatchObject({method:'POST',redirect:'error',headers:{Authorization:'Bearer fixture-secret'}});
  expect(JSON.parse(sent.options.body)).toEqual(request);
  expect(result).toMatchObject({requestId:'fixture-id',body:{model:'jev-1.13.0'}});
});
test.each([401,429,529])('HTTP %s is sanitized without automatic retry',async status=>{
  let attempts=0;
  const client=createJevTransport({apiKey:'fixture',fetchImpl:async()=>{attempts++;return new Response('secret body',{status});}});
  await expect(client.evaluate(request)).rejects.toMatchObject({code:'provider_http_error',status,message:'Jev transport failed'});
  expect(attempts).toBe(1);
});
test.each([
  ()=>new Response('not json',{headers:{'Content-Type':'application/json'}}),
  ()=>new Response('{}',{headers:{'Content-Type':'text/html'}}),
  ()=>new Response('x'.repeat(70000),{headers:{'Content-Type':'application/json'}})
])('malformed or oversized response is rejected %#',async response=>{
  const client=createJevTransport({apiKey:'fixture',fetchImpl:async()=>response()});
  await expect(client.evaluate(request)).rejects.toMatchObject({code:'invalid_provider_response'});
});
test('missing key and aborted requests cause no network attempts',async()=>{
  expect(()=>createJevTransport({apiKey:''})).toThrow(/API key/);
  const controller=new AbortController();controller.abort();
  let attempts=0;
  const client=createJevTransport({apiKey:'fixture',fetchImpl:async()=>{attempts++;throw new Error('should not call');}});
  await expect(client.evaluate(request,{signal:controller.signal})).rejects.toMatchObject({code:'aborted'});
  expect(attempts).toBe(0);
});
test('network exceptions never expose request credentials',async()=>{
  const client=createJevTransport({apiKey:'fixture-secret',fetchImpl:async()=>{throw new Error('fixture-secret');}});
  await expect(client.evaluate(request)).rejects.toMatchObject({code:'provider_network_error',message:'Jev transport failed'});
});

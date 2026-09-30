jest.mock('../evidence/html-runtime',()=>({loadHtmlRuntime:jest.fn()}));
jest.mock('../evidence/extract-fetch',()=>({extractFetchHtml:jest.fn()}));
const {loadHtmlRuntime}=require('../evidence/html-runtime');
const {extractFetchHtml}=require('../evidence/extract-fetch');
const {createHtmlExtractionService}=require('../evidence/html-service');
beforeEach(()=>{jest.resetAllMocks();loadHtmlRuntime.mockResolvedValue(Object.freeze({bundleDirectory:'/sealed',manifestSha256:'a'.repeat(64),scratchParent:'/scratch'}));});

test('failed runtime verification prevents service creation',async()=>{
  loadHtmlRuntime.mockRejectedValue(new Error('Unsafe runtime'));
  await expect(createHtmlExtractionService({db:{},archive:{},runtime:{}})).rejects.toThrow(/Unsafe/);
  expect(extractFetchHtml).not.toHaveBeenCalled();
});
test('one active parse rejects concurrent work without queueing, then releases its slot',async()=>{
  let finish;
  extractFetchHtml.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const service=await createHtmlExtractionService({db:{},archive:{},runtime:{}});
  const first=service.extract({receiptId:1,actorId:1});await Promise.resolve();
  await expect(service.extract({receiptId:2,actorId:1})).rejects.toMatchObject({code:'html_busy'});
  finish({id:10});await expect(first).resolves.toEqual({id:10});
  extractFetchHtml.mockResolvedValue({id:11});
  await expect(service.extract({receiptId:2,actorId:1})).resolves.toEqual({id:11});
  await service.stop();
});
test('shutdown cancels active parsing and drains it before resolving',async()=>{
  let finish,signal;
  extractFetchHtml.mockImplementation((db,request,archive,runtime)=>{signal=runtime.signal;return new Promise(resolve=>{finish=resolve;});});
  const service=await createHtmlExtractionService({db:{},archive:{},runtime:{}});
  const active=service.extract({receiptId:1,actorId:1});await Promise.resolve();
  let stopped=false;const stopping=service.stop().then(()=>{stopped=true;});
  await Promise.resolve();expect(signal.aborted).toBe(true);expect(stopped).toBe(false);
  await expect(service.extract({receiptId:2,actorId:1})).rejects.toMatchObject({code:'html_stopped'});
  finish({id:1});await active;await stopping;expect(stopped).toBe(true);
  await service.stop();
});
test('request abort reaches the parser and failed parsing releases the slot',async()=>{
  extractFetchHtml.mockImplementation((db,request,archive,runtime)=>new Promise((resolve,reject)=>runtime.signal.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true})));
  const service=await createHtmlExtractionService({db:{},archive:{},runtime:{}}),controller=new AbortController();
  const active=service.extract({receiptId:1,actorId:1},{signal:controller.signal});await Promise.resolve();
  controller.abort();await expect(active).rejects.toThrow(/Cancelled/);
  extractFetchHtml.mockResolvedValue({id:2});await expect(service.extract({receiptId:2,actorId:1})).resolves.toEqual({id:2});
  await expect(service.extract({receiptId:3,actorId:1},{signal:controller.signal})).rejects.toMatchObject({code:'html_cancelled'});
  await service.stop();
});

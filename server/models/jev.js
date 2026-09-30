const {QUESTION_VERSION,passageQuestions}=require('./questions');
const {createHash}=require('crypto');
function failure(code,details={}) {return Object.assign(new Error('Jev evaluation failed'),{code,...details});}
function keys(value,expected) {
  return value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).length===expected.length && expected.every(key=>Object.hasOwn(value,key));
}
const probability=value=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=1;
function buildPassageRequest(input) {
  if(!input || input.model!=='jev-1.13.0' || input.questionVersion!==QUESTION_VERSION ||
    !['claim','passage','context'].every(key=>typeof input[key]==='string' && input[key].length<=16000) ||
    !input.claim.trim() || !input.passage.trim()) throw failure('invalid_request');
  const questions=passageQuestions();
  const request={model:input.model,state:{claim:input.claim,passage:input.passage,context:input.context},questions};
  // Resource cap, not a claim of exact provider tokenization.
  const stateBytes=Buffer.byteLength(JSON.stringify(request.state),'utf8');
  const longestQuestionBytes=Math.max(...Object.values(questions).map(q=>Buffer.byteLength(JSON.stringify(q),'utf8')));
  if(stateBytes+longestQuestionBytes>32768 || Buffer.byteLength(JSON.stringify(request),'utf8')>24000)
    throw failure('invalid_request');
  return request;
}
async function evaluatePassage(input,client,{signal,timeoutMs=10000,maxOutputTokens=4096,deadlineAt,clock=Date.now,
  cleanupGraceMs=0,onLateTransport}={}) {
  if(typeof client?.evaluate!=='function' || !Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30000 ||
    !Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<0||maxOutputTokens>4096 ||
    !Number.isSafeInteger(cleanupGraceMs)||cleanupGraceMs<0||cleanupGraceMs>3000) throw failure('invalid_request');
  const request=buildPassageRequest(input),questions=request.questions;
  if(signal?.aborted) throw failure('aborted');
  if(deadlineAt!==undefined) {
    if(!Number.isSafeInteger(deadlineAt)||typeof clock!=='function')throw failure('invalid_request');
    const remaining=deadlineAt-clock();
    if(remaining<=0)throw failure('deadline_expired');
    timeoutMs=Math.min(timeoutMs,remaining);
  }
  const controller=new AbortController();
  let timer,onAbort;
  const cancelled=new Promise((resolve,reject)=>{
    onAbort=()=>{controller.abort();reject(failure('aborted'));};
    signal?.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(failure('timeout'));},timeoutMs);
  });
  let result,transport,transportSettled=false;
  try {
    // Exactly one adapter attempt; durable worker owns any retries and budget.
    transport=Promise.resolve().then(()=>{
      if(deadlineAt!==undefined&&clock()>=deadlineAt)throw failure('deadline_expired');
      if(controller.signal.aborted)throw failure(signal?.aborted?'aborted':'timeout');
      return client.evaluate(request,{signal:controller.signal});
    });
    transport.then(()=>{transportSettled=true;},()=>{transportSettled=true;});
    result=await Promise.race([transport,cancelled]);
  } catch(error) {
    if(controller.signal.aborted) {
      if(typeof onLateTransport==='function'&&transport)transport.then(
        value=>{try{onLateTransport('succeeded',value);}catch{}},
        ()=>{try{onLateTransport('failed',null);}catch{}});
      if(cleanupGraceMs&&transport&&!transportSettled) {
        let timerId;
        try {await Promise.race([transport.then(()=>{},()=>{}),new Promise(resolve=>{timerId=setTimeout(resolve,cleanupGraceMs);})]);}
        finally {clearTimeout(timerId);}
      }
      const cancelled=failure(signal?.aborted?'aborted':'timeout');
      cancelled.transportSettled=transportSettled;
      throw cancelled;
    }
    if(['deadline_expired','work_paused','budget_guard_tripped','permission_required','lease_lost',
      'provider_paused'].includes(error?.code))throw error;
    const status=Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?error.status:null;
    const retryAfterMs=Number.isSafeInteger(error?.retryAfterMs)&&error.retryAfterMs>=0&&error.retryAfterMs<=300000?
      error.retryAfterMs:null;
    const requestId=typeof error?.requestId==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(error.requestId)?error.requestId:null;
    const code=error?.code==='provider_http_error'?
      [401,403].includes(status)?'provider_auth':
      status===429?'provider_rate_limited':
      status===529?'provider_overloaded':
      status>=400&&status<500&&![408,425].includes(status)?'provider_configuration':'provider_error':
      error?.code==='invalid_request'?'provider_configuration':'provider_error';
    throw failure(code,{status,retryAfterMs,requestId});
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
  const body=result?.body;
  if(!keys(body,['model','answers','usage']) || body.model!==input.model ||
    !keys(body.answers,Object.keys(questions)) || !keys(body.usage,['input_tokens','output_tokens']) ||
    !Object.values(body.usage).every(n=>Number.isSafeInteger(n) && n>=0) ||
    body.usage.input_tokens>64000 || body.usage.output_tokens>maxOutputTokens) throw failure('invalid_response');
  for(const [name,question] of Object.entries(questions)) {
    const answer=body.answers[name],options=Object.keys(question.criteria);
    if(!keys(answer,['type','choice','probabilities','confidence']) || answer.type!=='choice' || !options.includes(answer.choice) ||
      !probability(answer.confidence) || !keys(answer.probabilities,options) || !Object.values(answer.probabilities).every(probability)) throw failure('invalid_response');
    const distribution=Object.values(answer.probabilities);
    if(Math.abs(distribution.reduce((a,b)=>a+b,0)-1)>0.00001 || answer.probabilities[answer.choice]<Math.max(...distribution)) throw failure('invalid_response');
  }
  const requestId=typeof result.requestId==='string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(result.requestId)?result.requestId:null;
  return {model:body.model,answers:JSON.parse(JSON.stringify(body.answers)),usage:{...body.usage},requestId,questionVersion:QUESTION_VERSION};
}
function hashPassageInput(input) {
  return createHash('sha256').update(JSON.stringify([input.questionVersion,buildPassageRequest(input)])).digest('hex');
}
module.exports={evaluatePassage,buildPassageRequest,hashPassageInput};

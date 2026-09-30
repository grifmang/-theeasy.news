const catalog=require('./prices.json');
const {reserveCost}=require('./budget');
const {alert}=require('./budget-ops');

function estimateCost({model,inputTokens,outputTokens,reasoningMicros=0,toolMicros=0,now}) {
  if(typeof model!=='string' || !Object.hasOwn(catalog,model)) throw new Error('Unknown model price');
  const price=catalog[model];
  if(typeof now!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now) || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString()!==now) throw new Error('Invalid price timestamp');
  if(now<price.verifiedAt || now>=price.expiresAt) throw new Error('Price verification expired or not yet valid');
  for(const value of [inputTokens,outputTokens,reasoningMicros,toolMicros,price.inputMicrosPerMillion,price.outputMicrosPerMillion]) {
    if(!Number.isSafeInteger(value) || value<0) throw new Error('Invalid token or price bound');
  }
  if(inputTokens>price.maxInputTokens || outputTokens>price.maxOutputTokens ||
    reasoningMicros!==0 || toolMicros!==0 || price.billing!=='input_output_only') throw new Error('Invalid or unsupported billing bound');
  const numerator=BigInt(inputTokens)*BigInt(price.inputMicrosPerMillion)+BigInt(outputTokens)*BigInt(price.outputMicrosPerMillion);
  const micros=(numerator+999999n)/1000000n;
  if(micros>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid cost overflow');
  const inputCost=(BigInt(inputTokens)*BigInt(price.inputMicrosPerMillion)+999999n)/1000000n;
  const outputCost=(BigInt(outputTokens)*BigInt(price.outputMicrosPerMillion)+999999n)/1000000n;
  return {model,maxMicros:Number(micros),priceVersion:`${model}:${price.version}`,source:price.source,
    components:{inputMicros:Number(inputCost),outputMicros:Number(outputCost),reasoningMicros:0,toolMicros:0}};
}
function priceReportedUsage({model,priceVersion,inputTokens,outputTokens}) {
  const price=catalog[model];
  if(!price||priceVersion!==`${model}:${price.version}`||price.billing!=='input_output_only')
    throw new Error('Unknown pinned price');
  for(const value of [inputTokens,outputTokens,price.inputMicrosPerMillion,price.outputMicrosPerMillion])
    if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid reported usage');
  const micros=(BigInt(inputTokens)*BigInt(price.inputMicrosPerMillion)+
    BigInt(outputTokens)*BigInt(price.outputMicrosPerMillion)+999999n)/1000000n;
  if(micros>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Invalid cost overflow');
  return Number(micros);
}

// Adapters must supply enforced token bounds, not typical/average usage.
// Jev can reserve its full request context cap when no exact tokenizer is available.
function reserveModelCost(db,input,limits) {
  let price;
  try {price=estimateCost(input);}
  catch(error) {if(input.now&&typeof input.now==='string') {
    try {alert(db,{kind:'unknown_price',category:input.category,period:input.now.slice(0,10),now:input.now});} catch {}
  }throw error;}
  return reserveCost(db,{requestKey:input.requestKey,category:input.category,
    maxMicros:price.maxMicros,priceVersion:price.priceVersion,now:input.now,model:input.model,
    estimatedInputTokens:input.inputTokens,estimatedOutputTokens:input.outputTokens,components:price.components,
    guard:input.guard},limits);
}
module.exports={estimateCost,priceReportedUsage,reserveModelCost};

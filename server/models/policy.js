function routeDecision(answer,{mode,highRisk=false}) {
  if(mode!=='shadow' || typeof highRisk!=='boolean') throw new Error('Only shadow policy is available');
  const allowed=['supports','contradicts','mentions_only','insufficient'];
  let route='abstain';
  if(answer && allowed.includes(answer.choice) && Number.isFinite(answer.confidence) && answer.confidence>=0 && answer.confidence<=1) {
    if(answer.choice==='insufficient' || answer.choice==='mentions_only') route='abstain';
    else route=highRisk || answer.confidence<0.9?'review':'recommend';
  }
  return {route,mode:'shadow',publicationAllowed:false,policyVersion:'passage-shadow-v1'};
}
module.exports={routeDecision};

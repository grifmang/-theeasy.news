const {routeDecision}=require('../models/policy');
test.each([
  [{choice:'supports',confidence:0.99},false,'recommend'],
  [{choice:'supports',confidence:0.99},true,'review'],
  [{choice:'contradicts',confidence:0.5},false,'review'],
  [{choice:'insufficient',confidence:1},false,'abstain'],
  [{choice:'supports',confidence:NaN},false,'abstain'],
  [{choice:'publish',confidence:1},false,'abstain']
])('shadow policy keeps publication forbidden %#',(answer,highRisk,route)=>{
  expect(routeDecision(answer,{mode:'shadow',highRisk})).toMatchObject({route,mode:'shadow',publicationAllowed:false});
});
test('live publication policy is unavailable',()=>{
  expect(()=>routeDecision({choice:'supports',confidence:1},{mode:'live'})).toThrow();
});

const {openStore,migrate}=require('../storage');
const {runJevCall}=require('../models/jev-call');
const fs=require('fs'),os=require('os'),path=require('path');
const {createBudgetGuard}=require('../models/budget-guard');
let db,guard,directory;
const input={claim:'Fixture claim',passage:'Fixture evidence',context:'Fixture context',model:'jev-1.13.0',questionVersion:'passage-v1'};
const options=(extra={})=>({requestKey:'fixture-call',input,guard,limits:{dailyMicros:3000,monthlyMicros:3000},now:'2026-09-20T12:00:00.000Z',...extra});
function response() {return {body:{model:'jev-1.13.0',answers:{
  relevance:{type:'choice',choice:'direct',probabilities:{direct:1,background:0,unrelated:0,uncertain:0},confidence:1},
  relation:{type:'choice',choice:'supports',probabilities:{supports:1,contradicts:0,mentions_only:0,insufficient:0},confidence:1},
  evidence_type:{type:'choice',choice:'testimony',probabilities:{mention:0,allegation:0,testimony:1,finding:0,other:0,uncertain:0},confidence:1}
},usage:{input_tokens:1000,output_tokens:20}},requestId:'fixture-id'};}
beforeEach(()=>{db=openStore(':memory:');migrate(db);directory=fs.mkdtempSync(path.join(os.tmpdir(),'en-guard-'));guard=createBudgetGuard(directory);});
afterEach(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
test('reserves before provider call, saves result and settles reported usage atomically',async()=>{
  const client={evaluate:async()=>{
    expect(db.inTransaction).toBe(true);
    expect(db.prepare('SELECT max_micros FROM model_reservations').get().max_micros).toBe(2688);
    return response();
  }};
  const result=await runJevCall(db,options(),client);
  expect(result.status).toBe('succeeded');
  expect(db.prepare('SELECT status,actual_micros FROM model_settlements').get()).toEqual({status:'billed',actual_micros:42});
  expect(JSON.parse(db.prepare('SELECT result_json FROM model_call_results').get().result_json).requestId).toBe('fixture-id');
  expect(()=>db.exec('DELETE FROM model_call_results')).toThrow(/immutable/);
});
test('duplicate successful keys reuse saved result and changed inputs are rejected',async()=>{
  let calls=0;const client={evaluate:async()=>{calls++;return response();}};
  await runJevCall(db,options(),client);
  expect((await runJevCall(db,options(),client)).status).toBe('cached');
  await expect(runJevCall(db,options({input:{...input,claim:'Changed'}}),client)).rejects.toThrow(/changed/);
  expect(calls).toBe(1);
});
test('budget denial and invalid input do not reach provider',async()=>{
  let calls=0;const client={evaluate:async()=>{calls++;return response();}};
  expect((await runJevCall(db,options({limits:{dailyMicros:0,monthlyMicros:0}}),client)).status).toBe('budget_exhausted');
  await expect(runJevCall(db,options({input:{...input,model:'unknown'}}),client)).rejects.toMatchObject({code:'invalid_request'});
  expect(calls).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM model_reservations').get().n).toBe(0);
});
test('failed provider leaves unknown charges reserved and same key cannot retry',async()=>{
  let calls=0;const client={evaluate:async()=>{calls++;throw new Error('provider secret');}};
  expect(await runJevCall(db,options(),client)).toMatchObject({status:'failed',errorCode:'provider_error'});
  expect(db.prepare('SELECT status,actual_micros FROM model_settlements').get()).toEqual({status:'unknown',actual_micros:null});
  expect((await runJevCall(db,options(),client)).status).toBe('failed');
  expect(calls).toBe(1);
  expect(db.prepare('SELECT result_json FROM model_call_results').get().result_json).toBeNull();
});
test('overlapping duplicate attempts return pending rather than calling twice',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  let entered;const ready=new Promise(resolve=>{entered=resolve;});
  const first=runJevCall(db,options(),{evaluate:async()=>{entered();await gate;return response();}});
  await Promise.race([ready,first.then(()=>{throw new Error('Call ended before transport');})]);
  try {expect((await runJevCall(db,options(),{evaluate:async()=>{throw new Error('duplicate');}})).status).toBe('pending_reconciliation');}
  finally {release();await first;}
});

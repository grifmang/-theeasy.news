const {estimateCost,reserveModelCost}=require('../models/prices');
const {openStore,migrate}=require('../storage');
const now='2026-09-20T12:00:00.000Z';
function input(extra={}) {return {model:'jev-1.13.0',inputTokens:64000,outputTokens:1000,now,...extra};}
test('Jev cost uses integer microdollars, rounds upward and includes no output charge',()=>{
  expect(estimateCost(input()).maxMicros).toBe(2688);
  expect(estimateCost(input({inputTokens:1})).maxMicros).toBe(1);
  expect(estimateCost(input({inputTokens:1000})).maxMicros).toBe(42);
});
test.each(['jev-latest','jev-preview','unknown-writer'])('unknown or mutable model %s cannot be priced',model=>{
  expect(()=>estimateCost(input({model}))).toThrow(/Unknown/);
});
test.each([{inputTokens:64001},{inputTokens:-1},{inputTokens:1.5},{outputTokens:Infinity},{now:'bad'},{now:'2026-10-21T00:00:00.000Z'},{now:'2026-09-19T00:00:00.000Z'}])('invalid bounds or stale pricing rejects %j',extra=>{
  expect(()=>estimateCost(input(extra))).toThrow();
});
test('priced admission records pinned rate version and denies unknown rates before ledger writes',()=>{
  const db=openStore(':memory:');migrate(db);
  try {
    const limits={dailyMicros:3000,monthlyMicros:3000};
    const result=reserveModelCost(db,{...input(),requestKey:'fixture',category:'classification'},limits);
    expect(result).toMatchObject({status:'reserved',reservation:{max_micros:2688,price_version:'jev-1.13.0:2026-09-20'}});
    expect(()=>reserveModelCost(db,{...input({model:'unpriced'}),requestKey:'bad',category:'writer'},limits)).toThrow(/Unknown/);
    expect(db.prepare('SELECT COUNT(*) n FROM model_reservations').get().n).toBe(1);
  } finally {db.close();}
});

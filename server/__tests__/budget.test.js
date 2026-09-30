const {openStore,migrate}=require('../storage');
const {reserveCost,settleCost}=require('../models/budget');
let db;
const limits={dailyMicros:100,monthlyMicros:150,categoryDailyMicros:{classification:80}};
const now='2026-09-20T12:00:00.000Z';
const input=(extra={})=>({requestKey:'one',category:'classification',maxMicros:60,priceVersion:'fixture-v1',now,...extra});
beforeEach(()=>{db=openStore(':memory:');migrate(db);});
afterEach(()=>db.close());
test('reservations consume global and category budgets before any call',()=>{
  expect(reserveCost(db,input(),limits).status).toBe('reserved');
  expect(reserveCost(db,input({requestKey:'two',maxMicros:30}),limits).status).toBe('budget_exhausted');
  expect(reserveCost(db,input({requestKey:'writer',category:'writer',maxMicros:50}),limits).status).toBe('budget_exhausted');
  expect(db.prepare('SELECT COUNT(*) n FROM model_reservations').get().n).toBe(1);
});
test('duplicate keys do not issue another call permit and changed parameters fail',()=>{
  const first=reserveCost(db,input(),limits);
  expect(reserveCost(db,input(),limits)).toMatchObject({status:'already_reserved',reservation:{id:first.reservation.id}});
  expect(()=>reserveCost(db,input({maxMicros:50}),limits)).toThrow(/changed/);
});
test('billed settlement releases unused reserve and is immutable/idempotent',()=>{
  const first=reserveCost(db,input(),limits);
  const settled=settleCost(db,{reservationId:first.reservation.id,status:'billed',actualMicros:10});
  expect(settleCost(db,{reservationId:first.reservation.id,status:'billed',actualMicros:10}).id).toBe(settled.id);
  expect(()=>settleCost(db,{reservationId:first.reservation.id,status:'billed',actualMicros:0})).toThrow(/settled/);
  expect(reserveCost(db,input({requestKey:'two'}),limits).status).toBe('reserved');
});
test('unknown charges keep maximum reserved across month rollover until reconciled',()=>{
  const first=reserveCost(db,input(),limits);
  settleCost(db,{reservationId:first.reservation.id,status:'unknown',actualMicros:null});
  expect(reserveCost(db,input({requestKey:'next-month',now:'2026-10-01T00:00:00.000Z'}),limits).status).toBe('budget_exhausted');
  settleCost(db,{reservationId:first.reservation.id,status:'not_billed',actualMicros:0});
  expect(reserveCost(db,input({requestKey:'next-month',now:'2026-10-01T00:00:00.000Z'}),limits).status).toBe('reserved');
});
test('daily rollover does not reset settled monthly usage',()=>{
  const policy={dailyMicros:100,monthlyMicros:100};
  const first=reserveCost(db,input({maxMicros:80}),policy);
  settleCost(db,{reservationId:first.reservation.id,status:'billed',actualMicros:80});
  expect(reserveCost(db,input({requestKey:'tomorrow',maxMicros:30,now:'2026-09-21T00:00:00.000Z'}),policy).status).toBe('budget_exhausted');
  expect(reserveCost(db,input({requestKey:'next-month',now:'2026-10-01T00:00:00.000Z'}),policy).status).toBe('reserved');
});
test('reported overruns are recorded and prevent more admission',()=>{
  const first=reserveCost(db,input(),limits);
  expect(settleCost(db,{reservationId:first.reservation.id,status:'billed',actualMicros:120}).actual_micros).toBe(120);
  expect(reserveCost(db,input({requestKey:'two',maxMicros:1}),limits).status).toBe('budget_exhausted');
});
test.each([-1,1.2,NaN,Infinity])('rejects invalid money %s',maxMicros=>{
  expect(()=>reserveCost(db,input({maxMicros}),limits)).toThrow(/Invalid/);
});
test('zero budget and absent price version deny admission',()=>{
  expect(reserveCost(db,input(),{dailyMicros:0,monthlyMicros:0}).status).toBe('budget_exhausted');
  expect(()=>reserveCost(db,input({priceVersion:undefined}),limits)).toThrow(/Invalid/);
});

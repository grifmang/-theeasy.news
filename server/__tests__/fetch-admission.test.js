const fs=require('fs'),os=require('os'),path=require('path');
const {openStore,migrate}=require('../storage');
const {reserveFetchSlot}=require('../discovery/fetch-admission');
let directory,db;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-fetch-rate-'));db=openStore(path.join(directory,'rate.db'));migrate(db);});
afterEach(()=>{if(db?.open)db.close();fs.rmSync(directory,{recursive:true,force:true});});
test('host pacing persists across connections and rejects early reservations',()=>{
  expect(reserveFetchSlot(db,{host:'records.example.org',requestsPerMinute:6,now:1000})).toEqual({allowed:true,retryAt:11000});
  db.close();db=openStore(path.join(directory,'rate.db'));
  expect(reserveFetchSlot(db,{host:'records.example.org',requestsPerMinute:6,now:1001})).toEqual({allowed:false,retryAt:11000});
  expect(reserveFetchSlot(db,{host:'records.example.org',requestsPerMinute:6,now:11000})).toEqual({allowed:true,retryAt:21000});
});
test('different hosts are independently paced and clock rollback cannot bypass reservation',()=>{
  reserveFetchSlot(db,{host:'one.example.org',requestsPerMinute:1,now:1000});
  expect(reserveFetchSlot(db,{host:'two.example.org',requestsPerMinute:1,now:1000}).allowed).toBe(true);
  expect(reserveFetchSlot(db,{host:'one.example.org',requestsPerMinute:60,now:500})).toEqual({allowed:false,retryAt:61000});
});
test.each([{host:''},{requestsPerMinute:0},{requestsPerMinute:61},{requestsPerMinute:1.5},{now:-1},{now:Infinity}])('invalid admission %j makes no reservation',override=>{
  expect(()=>reserveFetchSlot(db,{host:'records.example.org',requestsPerMinute:6,now:1000,...override})).toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM source_fetch_limits').get().n).toBe(0);
});

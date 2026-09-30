const {Worker}=require('worker_threads');
const fs=require('fs'),os=require('os'),path=require('path');
const {openStore,migrate}=require('../storage');

test.each([
  [['one','two'],['budget_exhausted','reserved']],
  [['same','same'],['already_reserved','reserved']]
])('independent connections serialize reservations for keys %j',async(keys,statuses)=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-budget-race-'));
  const filename=path.join(directory,'race.db');
  const db=openStore(filename);migrate(db);db.pragma('journal_mode=WAL');db.close();
  const workers=[];let timer;
  try {
    const results=await new Promise((resolve,reject)=>{
      let ready=0;const outcomes=[];
      timer=setTimeout(()=>reject(new Error('Budget workers did not finish')),5000);
      for(const key of keys) {
        const worker=new Worker(path.resolve(__dirname,'../test-support/budget-worker.js'),{workerData:{filename,key}});
        workers.push(worker);
        worker.on('error',reject);
        worker.on('message',message=>{
          if(message.ready && ++ready===2) workers.forEach(w=>w.postMessage('start'));
          if(message.result) {outcomes.push(message.result);if(outcomes.length===2) resolve(outcomes);}
        });
      }
    });
    expect(results.map(r=>r.status).sort()).toEqual(statuses);
    const check=openStore(filename);
    try {expect(check.prepare('SELECT COUNT(*) n,SUM(max_micros) total FROM model_reservations').get()).toEqual({n:1,total:60});}
    finally {check.close();}
  } finally {
    clearTimeout(timer);await Promise.all(workers.map(w=>w.terminate()));
    fs.rmSync(directory,{recursive:true,force:true});
  }
},10000);

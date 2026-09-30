const {Worker}=require('worker_threads');
const fs=require('fs'),os=require('os'),path=require('path');
const {openStore,migrate}=require('../storage');
test('simultaneous independent workers grant only one host reservation',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-fetch-race-'));
  const filename=path.join(directory,'race.db');
  const db=openStore(filename);migrate(db);db.pragma('journal_mode=WAL');db.close();
  const workers=[];let timer;
  try {
    const outcomes=await new Promise((resolve,reject)=>{
      let ready=0;const results=[];
      timer=setTimeout(()=>reject(new Error('Fetch reservation workers timed out')),5000);
      for(let i=0;i<2;i++) {
        const worker=new Worker(path.resolve(__dirname,'../test-support/fetch-admission-worker.js'),{workerData:{filename}});
        workers.push(worker);worker.on('error',reject);
        worker.on('message',message=>{
          if(message.ready && ++ready===2) workers.forEach(w=>w.postMessage('start'));
          if(message.result) {results.push(message.result);if(results.length===2)resolve(results);}
        });
      }
    });
    expect(outcomes.filter(r=>r.allowed)).toHaveLength(1);
    expect(outcomes.map(r=>r.retryAt)).toEqual([11000,11000]);
  } finally {
    clearTimeout(timer);await Promise.all(workers.map(w=>w.terminate()));
    fs.rmSync(directory,{recursive:true,force:true});
  }
},10000);

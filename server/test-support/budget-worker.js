const {parentPort,workerData}=require('worker_threads');
const {openStore}=require('../storage');
const {reserveCost}=require('../models/budget');
const db=openStore(workerData.filename);
parentPort.once('message',()=>{
  try {
    const result=reserveCost(db,{requestKey:workerData.key,category:'classification',maxMicros:60,
      priceVersion:'fixture',now:'2026-09-20T12:00:00.000Z'},{dailyMicros:100,monthlyMicros:100});
    db.close();parentPort.postMessage({result});
  } catch(error) {db.close();throw error;}
});
parentPort.postMessage({ready:true});

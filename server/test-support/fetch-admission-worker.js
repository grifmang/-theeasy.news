const {parentPort,workerData}=require('worker_threads');
const {openStore}=require('../storage');
const {reserveFetchSlot}=require('../discovery/fetch-admission');
const db=openStore(workerData.filename);
parentPort.once('message',()=>{
  try {parentPort.postMessage({result:reserveFetchSlot(db,{host:'records.example.org',requestsPerMinute:6,now:1000})});}
  finally {db.close();parentPort.close();}
});
parentPort.postMessage({ready:true});

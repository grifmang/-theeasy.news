const fs=require('fs');
const path=require('path');
const {randomUUID}=require('crypto');

const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE=new RegExp(`^([1-9]\\d{0,15})-(${UUID})(?:-(${UUID}))?(-fault)?$`);
const TOKEN=new RegExp(`^${UUID}$`);
const MAX_FILES=1000,MAX_BYTES=64;
function syncDirectory(directory) {
  // NTFS journals rename metadata; opening directories for fsync is unsupported on Windows.
  if(process.platform==='win32')return;
  const fd=fs.openSync(directory,'r');
  try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
function privateStat(stat,directory=false) {
  if(stat.isSymbolicLink()||!(directory?stat.isDirectory():stat.isFile())||
    (!directory&&(stat.nlink!==1||stat.size>MAX_BYTES))||
    (process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid())))
    throw new Error('Invalid private budget guard entry');
}
function privateDirectory(directory) {
  privateStat(fs.lstatSync(directory),true);
  const canonical=fs.realpathSync(directory),resolved=path.resolve(directory);
  if((process.platform==='win32'?canonical.toLowerCase()!==resolved.toLowerCase():canonical!==resolved))
    throw new Error('Invalid budget guard directory path');
}
function createBudgetGuard(directory) {
  if(typeof directory!=='string'||!path.isAbsolute(directory)||directory.includes('\0'))
    throw new Error('BUDGET_FAIL_CLOSED_PATH must be absolute');
  privateDirectory(directory);
  const armed=path.join(directory,'armed'),tripped=path.join(directory,'tripped');
  for(const child of [armed,tripped]) {
    try {fs.mkdirSync(child,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    privateDirectory(child);
  }
  syncDirectory(directory);
  let latched=false,fatal=false,database=null,time=Date.now;
  const ownTrips=new Set();
  function bind(db,clock) {
    if(db) {if(database&&database!==db)throw new Error('Guard database changed');database=db;}
    if(clock!==undefined){if(typeof clock!=='function')throw new Error('Invalid guard clock');time=clock;}
  }
  function identity(name) {
    const match=typeof name==='string'&&FILE.exec(name),reservationId=match&&Number(match[1]);
    if(!match||!Number.isSafeInteger(reservationId))throw new Error('Invalid guard identity');
    return {name,reservationId,slotToken:match[2],faultName:Boolean(match[4])};
  }
  function readEntry(folder,name) {
    const item=identity(name),target=path.join(folder,name);
    let fd;
    try {
      const before=fs.lstatSync(target);privateStat(before);
      fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
      const stat=fs.fstatSync(fd);privateStat(stat);
      if(stat.dev!==before.dev||stat.ino!==before.ino)throw new Error('Guard entry changed');
      const bytes=Buffer.alloc(MAX_BYTES+1),length=fs.readSync(fd,bytes,0,bytes.length,0);
      const metadata=bytes.subarray(0,length).toString('utf8');
      // Empty files are published atomically with reservation/slot identity in the name.
      // Older numeric files have no trustworthy slot identity and require restoration.
      if(length>MAX_BYTES||!['','fault',String(item.reservationId)].includes(metadata))
        throw new Error('Invalid guard metadata');
      return {...item,folder,stat,metadata,fault:item.faultName||metadata!==''};
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
    finally {if(fd!==undefined)fs.closeSync(fd);}
  }
  function snapshot() {
    privateDirectory(directory);privateDirectory(armed);privateDirectory(tripped);
    const entries=[];let count=0;
    for(const folder of [tripped,armed]) {
      // Incremental reads bound memory even for an invalid overflowing directory.
      const dir=fs.opendirSync(folder);
      try {let item;while((item=dir.readSync())) {
        if(++count>MAX_FILES)throw new Error('Budget guard entry limit');
        const entry=readEntry(folder,item.name);if(entry)entries.push(entry);
      }} finally {dir.closeSync();}
    }
    return entries;
  }
  function sameEntry(item) {
    const current=readEntry(item.folder,item.name);
    if(current&&(current.stat.ino!==item.stat.ino||current.stat.dev!==item.stat.dev||current.metadata!==item.metadata))
      throw new Error('Guard entry changed');
    return current;
  }
  function now() {
    const ms=time();if(!Number.isSafeInteger(ms)||ms<0)throw new Error('Invalid guard clock');
    const observed=new Date(ms).toISOString();
    const watermark=database.prepare('SELECT last_at FROM model_budget_clock WHERE id=1').get().last_at;
    return observed>watermark?observed:watermark;
  }
  function classification(item) {
    if(item.fault||!database?.open)return 'unresolved';
    const row=database.prepare(`SELECT s.slot_token,s.lease_until,
      (SELECT slot_token FROM model_call_slot_events WHERE reservation_id=r.id AND action='finish') AS finish_token,
      (SELECT status FROM model_settlements WHERE reservation_id=r.id ORDER BY id DESC LIMIT 1) AS settlement,
      (SELECT error_code FROM model_call_results WHERE reservation_id=r.id) AS error_code,
      EXISTS(SELECT 1 FROM model_call_results WHERE reservation_id=r.id) AS result,
      EXISTS(SELECT 1 FROM model_call_usage_events WHERE reservation_id=r.id) AS usage,
      EXISTS(SELECT 1 FROM model_call_recovery_events WHERE reservation_id=r.id) AS recovered,
      (SELECT slot_token FROM model_call_late_events WHERE reservation_id=r.id) AS late_token
      FROM model_reservations r JOIN model_call_attempts a ON a.reservation_id=r.id
      JOIN model_call_slot_events s ON s.reservation_id=r.id AND s.action='start' WHERE r.id=?`).get(item.reservationId);
    if(!row||row.slot_token!==item.slotToken||
      (row.finish_token&&row.finish_token!==item.slotToken)||(row.late_token&&row.late_token!==item.slotToken))return 'unresolved';
    const late=row.late_token===item.slotToken;
    const normal=row.result&&row.usage&&row.finish_token&&!row.recovered&&
      !['aborted','timeout'].includes(row.error_code);
    if(row.settlement&&(normal||(late&&((row.result&&row.usage)||row.recovered))))return 'safe';
    // A final settlement does not resolve a still outstanding callback.
    if(!row.finish_token&&!row.recovered&&!['billed','not_billed'].includes(row.settlement)&&row.lease_until>now())return 'live';
    return 'unresolved';
  }
  function wasRearmed(name) {
    if(!database?.open)return false;
    const {reservationId}=identity(name);
    return Boolean(database.prepare(`SELECT 1 FROM model_budget_guard_rearms g,json_each(g.trip_names_json) j
      JOIN model_budget_guard_restorations r ON r.reservation_id=? AND r.trip_name=json_extract(j.value,'$.name')
      WHERE json_extract(j.value,'$.name')=? AND json_extract(j.value,'$.reservationId')=? LIMIT 1`)
      .get(reservationId,name,reservationId));
  }
  function promote(item) {
    latched=true;ownTrips.add(item.name);
    if(!sameEntry(item))return;
    try {
      fs.renameSync(path.join(armed,item.name),path.join(tripped,item.name));
      syncDirectory(armed);syncDirectory(tripped);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  function remove(item) {
    if(!sameEntry(item))return;
    try {fs.unlinkSync(path.join(item.folder,item.name));syncDirectory(item.folder);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  function reconcile(db,clock) {
    bind(db,clock);
    try {
      const outerTransaction=Boolean(database?.inTransaction);
      const run=()=>{
        const entries=snapshot();
        for(const item of entries) {
          if(item.folder===tripped)continue;
          const state=classification(item);
          if(state==='unresolved')promote(item);
          // Never remove evidence based on a caller's not-yet-committed transaction.
          else if(state==='safe'&&!outerTransaction&&classification(item)==='safe')remove(item);
        }
        for(const name of ownTrips)if(wasRearmed(name)&&
          !readEntry(armed,name)&&!readEntry(tripped,name))ownTrips.delete(name);
        latched=ownTrips.size>0;
        return snapshot().some(item=>item.folder===tripped||classification(item)==='unresolved');
      };
      const blocked=database?.open&&!outerTransaction?database.transaction(run).immediate():run();
      return {tripped:blocked||latched||fatal,fatal,reason:blocked||latched||fatal?'late_audit_persistence':null,
        requiredAction:fatal?'operator_intervention':blocked||latched?'restore_exposure_then_rearm':null};
    }catch {latched=true;fatal=true;return {tripped:true,fatal:true,reason:'guard_unavailable',requiredAction:'operator_intervention'};}
  }
  function check(db,clock) {return !reconcile(db,clock).tripped;}
  // Status pages must not reconcile or mutate guard evidence.
  function peek(db,clock) {
    const priorTime=time;
    try {
      bind(db,clock);
      const blocked=snapshot().some(item=>item.folder===tripped||classification(item)==='unresolved');
      return {tripped:blocked||latched||fatal};
    } catch {return {tripped:true};}
    finally {time=priorTime;}
  }
  function arm(reservationId,slotToken) {
    if(!Number.isSafeInteger(reservationId)||reservationId<1||!TOKEN.test(slotToken))throw new Error('Invalid guard reservation');
    if(!check())throw new Error('Budget guard tripped');
    const name=`${reservationId}-${slotToken}-${randomUUID()}`;
    // Atomic publication: no other process can observe partially written metadata.
    const fd=fs.openSync(path.join(armed,name),'wx',0o600);
    try {fs.fsyncSync(fd);}finally {fs.closeSync(fd);}
    syncDirectory(armed);
    // A failed check keeps the arm as evidence even though this caller cannot send.
    if(!check())throw new Error('Budget guard tripped');
    return name;
  }
  function disarm(name) {
    if(name===null||name===undefined)return false;
    try {
      privateDirectory(directory);privateDirectory(armed);privateDirectory(tripped);
      if(!database?.open||database.inTransaction)return false;
      return database.transaction(()=>{
        const item=readEntry(armed,name);
        if(!item||classification(item)!=='safe')return false;
        remove(item);return true;
      }).immediate();
    }catch {latched=true;fatal=true;return false;}
  }
  function trip(name) {
    latched=true;
    try {
      privateDirectory(directory);privateDirectory(armed);privateDirectory(tripped);
      const {reservationId,slotToken}=identity(name);
      const original=readEntry(armed,name);
      // Every new fault gets a new identity, including a callback racing an operator
      // rearm. The operator's earlier snapshot can never consume this new fault.
      let target=`${reservationId}-${slotToken}-${randomUUID()}-fault`,fd;
      try {fd=fs.openSync(path.join(armed,target),'wx',0o600);}
      catch(error) {
        // If allocation fails, retain and mark the already-durable pre-send arm.
        if(!original)throw error;
        target=name;fd=fs.openSync(path.join(armed,target),fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW||0));
      }
      ownTrips.add(target);
      try {
        const stat=fs.fstatSync(fd);privateStat(stat);
        if(target===name&&(stat.ino!==original.stat.ino||stat.dev!==original.stat.dev))throw new Error('Guard entry changed');
        if(target===name){fs.writeSync(fd,'fault',0,'utf8');fs.ftruncateSync(fd,5);}
        fs.fsyncSync(fd);
      }finally {fs.closeSync(fd);}
      syncDirectory(armed);
      // The new fault sentinel is durable before the original arm can be retired.
      if(original&&target!==name)remove(original);
      promote(readEntry(armed,target));
    }catch {fatal=true;throw new Error('Budget guard trip failed');}
  }
  function trips(db,clock) {
    reconcile(db,clock);
    return snapshot().filter(item=>item.folder===tripped||classification(item)==='unresolved')
      .map(({name,reservationId})=>({name,reservationId}));
  }
  function rearm(items,db,clock) {
    bind(db,clock);
    privateDirectory(directory);privateDirectory(armed);privateDirectory(tripped);
    if(!database?.open||database.inTransaction||!Array.isArray(items)||items.length>MAX_FILES)
      throw new Error('Invalid guard snapshot');
    database.transaction(()=>{
      for(const item of items) {
        if(!item||identity(item.name).reservationId!==item.reservationId||!wasRearmed(item.name))
          throw new Error('Guard exposure and rearm must be audited');
        for(const folder of [tripped,armed]) {const entry=readEntry(folder,item.name);if(entry)remove(entry);}
        ownTrips.delete(item.name);
      }
    }).immediate();
    latched=ownTrips.size>0;
    if(fatal)throw new Error('Budget guard requires process restart');
    return reconcile();
  }
  return {check,status:reconcile,peek,arm,disarm,trip,trips,rearm,get fatal(){return fatal;}};
}
module.exports={createBudgetGuard};

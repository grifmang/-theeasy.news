const {BlockList,isIP}=require('net');
const {lookup}=require('dns').promises;

// Conservative source-fetch policy, not a general Internet routing classifier.
// IANA special-purpose registries reviewed 2026-09-22. Even globally reachable
// special-purpose ranges are excluded. Re-review allocations before expanding.
const excludedV4=new BlockList();
for(const cidr of ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8',
  '169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24',
  '192.31.196.0/24','192.52.193.0/24','192.88.99.0/24','192.168.0.0/16',
  '192.175.48.0/24','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24',
  '224.0.0.0/4','240.0.0.0/4']) {
  const [address,bits]=cidr.split('/');excludedV4.addSubnet(address,Number(bits),'ipv4');
}
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
const excludedV6=new BlockList();
for(const cidr of ['2001::/23','2001:db8::/32','2002::/16','2620:4f:8000::/48','3fff::/20']) {
  const [address,bits]=cidr.split('/');excludedV6.addSubnet(address,Number(bits),'ipv6');
}
function isPublicAddress(address) {
  if(typeof address!=='string' || address.includes('%')) return false;
  const family=isIP(address);
  if(family===4) return !excludedV4.check(address,'ipv4');
  return family===6 && globalV6.check(address,'ipv6') && !excludedV6.check(address,'ipv6');
}
function blocked() {return Object.assign(new Error('Blocked network target'),{code:'blocked_target'});}

async function resolveTarget({registry,sourceId,url,signal},resolver=lookup) {
  const cancelled=()=>Object.assign(new Error('Target resolution cancelled'),{code:'aborted'});
  if(signal?.aborted) throw cancelled();
  registry.resolve(sourceId,url);
  const hostname=new URL(url).hostname;
  // OS lookup may not be cancellable. Discard late completion; never permit it
  // to produce a connection target after the caller's deadline or cancellation.
  const answers=await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value)=>{
      if(settled) return;
      settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
      if(error) reject(error);else resolve(value);
    };
    const onAbort=()=>finish(cancelled());
    const timer=setTimeout(()=>finish(Object.assign(new Error('Target resolution timed out'),{code:'timeout'})),15000);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted) return onAbort();
    Promise.resolve().then(()=>{
      if(settled) return;
      return resolver(hostname,{all:true,verbatim:true});
    }).then(value=>finish(null,value),()=>finish(blocked()));
  });
  if(signal?.aborted) throw cancelled();
  if(!Array.isArray(answers) || !answers.length || answers.length>64 ||
    answers.some(answer=>!answer || !isPublicAddress(answer.address) || isIP(answer.address)!==answer.family)) throw blocked();
  const {address,family}=answers[0];
  return Object.freeze({hostname,servername:hostname,address,family,
    lookup(requestedHost,options,callback) {
      if(typeof options==='function') {callback=options;options={};}
      if(requestedHost!==hostname || (options?.family && options.family!==family)) return callback(blocked());
      if(options?.all) return callback(null,[{address,family}]);
      callback(null,address,family);
    }
  });
}
module.exports={isPublicAddress,resolveTarget};

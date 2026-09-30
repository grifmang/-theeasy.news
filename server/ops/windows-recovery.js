// Explicit operator tooling; import-inert. age provides the encryption format;
// Windows DPAPI protects its private identity at rest. Never print identities,
// plaintext backups, provider credentials or database rows.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawnSync}=require('child_process');

function protectIdentity(bytes,powershell,unprotect=false) {
  if(process.platform!=='win32') throw new Error('Windows recovery requires Windows');
  const operation=unprotect?'Unprotect':'Protect';
  const command=`$ErrorActionPreference='Stop';$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$r=[System.Security.Cryptography.ProtectedData]::${operation}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($r))`;
  const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',command],{
    input:bytes.toString('base64'),encoding:'utf8',timeout:15000,maxBuffer:65536,windowsHide:true});
  if(result.status!==0||!result.stdout.trim()) throw new Error('Windows identity protection failed');
  return Buffer.from(result.stdout.trim(),'base64');
}
function identity({directory,ageKeygen,powershell}) {
  const privatePath=path.join(directory,'identity.dpapi'),publicPath=path.join(directory,'recipient.txt');
  if(fs.existsSync(privatePath)||fs.existsSync(publicPath)) {
    if(!fs.existsSync(privatePath)||!fs.existsSync(publicPath)) throw new Error('Incomplete recovery identity; do not replace it');
    return {privatePath,recipient:fs.readFileSync(publicPath,'utf8').trim()};
  }
  const generated=spawnSync(ageKeygen,[],{encoding:'utf8',timeout:15000,maxBuffer:65536,windowsHide:true});
  if(generated.status!==0) throw new Error('Recovery identity generation failed');
  const recipient=generated.stdout.match(/^# public key: (age1[a-z0-9]+)$/m)?.[1];
  if(!recipient||!generated.stdout.includes('AGE-SECRET-KEY-1')) throw new Error('Invalid generated recovery identity');
  const plaintext=Buffer.from(generated.stdout);
  try {
    fs.writeFileSync(privatePath,protectIdentity(plaintext,powershell),{flag:'wx',mode:0o600});
    fs.writeFileSync(publicPath,recipient+'\n',{flag:'wx',mode:0o600});
  } finally {plaintext.fill(0);}
  return {privatePath,recipient};
}
function encryptBackup(bytes,{directory,age,ageKeygen,powershell}) {
  if(!Buffer.isBuffer(bytes)||bytes.length>33554432||!bytes.subarray(0,16).equals(Buffer.from('SQLite format 3\0')))
    throw new Error('Expected a bounded SQLite snapshot');
  if(!path.isAbsolute(directory)||!fs.lstatSync(directory).isDirectory()) throw new Error('Private recovery directory must exist');
  const key=identity({directory,ageKeygen,powershell});
  if(!/^age1[a-z0-9]{50,100}$/.test(key.recipient)) throw new Error('Invalid recovery recipient');
  const encrypted=spawnSync(age,['--encrypt','-r',key.recipient],{input:bytes,timeout:30000,maxBuffer:40000000,windowsHide:true});
  const header=Buffer.from('age-encryption.org/v1\n');
  if(encrypted.status!==0||!encrypted.stdout.subarray(0,header.length).equals(header))
    throw new Error('Backup encryption failed');
  const destination=path.join(directory,`easy-news-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}.db.age`);
  fs.writeFileSync(destination,encrypted.stdout,{flag:'wx',mode:0o600});
  return destination;
}
function verifyBackup(filename,{directory,age,powershell}) {
  const protectedKey=fs.readFileSync(path.join(directory,'identity.dpapi'));
  const key=protectIdentity(protectedKey,powershell,true);
  let plaintext;
  try {
    const decrypted=spawnSync(age,['--decrypt','-i','-',filename],{input:key,timeout:30000,maxBuffer:33554432,windowsHide:true});
    if(decrypted.status!==0) throw new Error('Backup decryption failed');
    plaintext=decrypted.stdout;
    const Database=require('better-sqlite3'),db=new Database(plaintext);
    try {
      if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length) throw new Error('Backup integrity failed');
      const schemaBefore=db.prepare('SELECT MAX(version) v FROM rebuild_migrations').get().v;
      const accountsBefore=db.prepare('SELECT COUNT(*) n FROM users').get().n;
      const rolesBefore=db.prepare('SELECT COUNT(*) n FROM user_roles').get().n;
      require('../storage').migrate(db);require('../legacy-schema').migrateLegacy(db);
      if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length||
        accountsBefore!==db.prepare('SELECT COUNT(*) n FROM users').get().n||rolesBefore!==db.prepare('SELECT COUNT(*) n FROM user_roles').get().n)
        throw new Error('In-memory recovery rehearsal failed');
      return {schemaBefore,schemaAfter:db.prepare('SELECT MAX(version) v FROM rebuild_migrations').get().v,accountsPreserved:true};
    } finally {db.close();}
  } finally {key.fill(0);plaintext?.fill(0);}
}
module.exports={protectIdentity,encryptBackup,verifyBackup};

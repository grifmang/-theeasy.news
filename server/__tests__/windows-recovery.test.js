const fs=require('fs'),os=require('os'),path=require('path');
const {initializeDatabase}=require('../init-db');
const {SCHEMA_VERSION}=require('../storage');
const {protectIdentity,encryptBackup,verifyBackup}=require('../ops/windows-recovery');
const tools={age:'C:/Users/grifm/AppData/Local/EasyNews/tools/age-1.3.2/age.exe',ageKeygen:'C:/Users/grifm/AppData/Local/EasyNews/tools/age-1.3.2/age-keygen.exe',powershell:'C:/Users/grifm/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'};
const local=process.platform==='win32'&&Object.values(tools).every(p=>fs.existsSync(p));
const verify=local?test:test.skip;
verify('age backup and DPAPI identity round-trip without plaintext identity on disk',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-recovery-test-'));
  try {
    const source=path.join(directory,'fixture.db');initializeDatabase(source);
    const settings={...tools,directory};
    const saved=encryptBackup(fs.readFileSync(source),settings);
    expect(verifyBackup(saved,settings)).toEqual({schemaBefore:SCHEMA_VERSION,schemaAfter:SCHEMA_VERSION,accountsPreserved:true});
    expect(fs.readFileSync(path.join(directory,'identity.dpapi')).includes(Buffer.from('AGE-SECRET-KEY'))).toBe(false);
    const again=encryptBackup(fs.readFileSync(source),settings);expect(again).not.toBe(saved);
    const damaged=fs.readFileSync(saved);damaged[damaged.length-1]^=1;fs.writeFileSync(saved,damaged);
    expect(()=>verifyBackup(saved,settings)).toThrow(/decryption/);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
},30000);
verify('DPAPI rejects a modified protected identity',()=>{
  const sealed=protectIdentity(Buffer.from('synthetic identity'),tools.powershell);sealed[sealed.length-1]^=1;
  expect(()=>protectIdentity(sealed,tools.powershell,true)).toThrow(/protection/);
},15000);

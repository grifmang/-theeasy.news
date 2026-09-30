const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {spawnSync}=require('child_process');
const script=path.resolve(__dirname,'../ops/stage-release.js');
let root,source,destination;
const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
function put(relative,text='fixture') {
  const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);
}
beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'easy-release-test-'));source=path.join(root,'source');destination=path.join(root,'release');fs.mkdirSync(source);
  for(const file of ['index.js','bootstrap.js','config.js','package.json','package-lock.json','.dockerignore',
    'models/prices.json','evidence/html-parser-worker.mjs','evidence/native/parser-sandbox.c','ops/Dockerfile.railway',
    'analysis/worker.js','publication/local-export.js','publication/outbox.js','ops/work-admission.js',
    'ops/build-release-image.js']) put(file);
  for(const dir of ['discovery','migrations','retrieval','routes']) put(dir+'/fixture.js');
  put('ops/rehearse-encrypted-restore.js','host-only recovery tool');
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
test('stages required JSON/MJS/native inputs, excludes local data, and pins exact inventory',()=>{
  put('.env','private');put('data.db','private');put('node_modules/fake/index.js','dependency');put('__tests__/fixture.js','test');
  const staged=run('stage',source,destination);expect(staged.status).toBe(0);
  const result=JSON.parse(staged.stdout),manifest=JSON.parse(fs.readFileSync(path.join(destination,'release-manifest.json')));
  expect(fs.readFileSync(path.join(destination,'server/release-manifest.json')))
    .toEqual(fs.readFileSync(path.join(destination,'release-manifest.json')));
  expect(manifest.files.map(f=>f.path)).toEqual(expect.arrayContaining(['server/models/prices.json','server/evidence/html-parser-worker.mjs','server/evidence/native/parser-sandbox.c',
    'server/analysis/worker.js','server/publication/local-export.js','server/publication/outbox.js','server/ops/work-admission.js',
    'server/ops/build-release-image.js']));
  expect(fs.existsSync(path.join(destination,'server/.env'))).toBe(false);
  expect(fs.existsSync(path.join(destination,'server/data.db'))).toBe(false);
  expect(fs.existsSync(path.join(destination,'server/node_modules'))).toBe(false);
  expect(fs.existsSync(path.join(destination,'server/__tests__'))).toBe(false);
  expect(fs.existsSync(path.join(destination,'server/ops/rehearse-encrypted-restore.js'))).toBe(false);
  expect(manifest.files.some(f=>f.path==='server/ops/rehearse-encrypted-restore.js')).toBe(false);
  const price=manifest.files.find(f=>f.path==='server/models/prices.json');
  expect(price.sha256).toBe(crypto.createHash('sha256').update('fixture').digest('hex'));
  expect(run('verify',destination,result.manifestSha256).status).toBe(0);
  const another=run('stage',source,path.join(root,'second'));
  expect(JSON.parse(another.stdout).manifestSha256).toBe(result.manifestSha256);
});
test('rejects absent required JSON before creating a publishable bundle',()=>{
  fs.unlinkSync(path.join(source,'models/prices.json'));
  const result=run('stage',source,destination);expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/required/i);expect(fs.existsSync(destination)).toBe(false);
});
(process.platform==='win32'?test.skip:test)('staged code stays readable after Docker COPY changes owner to root',()=>{
  const result=run('stage',source,destination);expect(result.status).toBe(0);
  expect(fs.statSync(path.join(destination,'server/index.js')).mode&0o777).toBe(0o644);
  expect(fs.statSync(path.join(destination,'server')).mode&0o777).toBe(0o755);
  expect(fs.statSync(destination).mode&0o777).toBe(0o700);
});
test('rejects private data inside a runtime subtree instead of silently copying it',()=>{
  put('models/private.db','private');const result=run('stage',source,destination);
  expect(result.status).toBe(1);expect(result.stderr).toMatch(/disallowed/i);expect(fs.existsSync(destination)).toBe(false);
  fs.unlinkSync(path.join(source,'models/private.db'));
  put('models/rehearse-encrypted-restore.js','misplaced host tool');
  const misplaced=run('stage',source,destination);
  expect(misplaced.status).toBe(1);expect(misplaced.stderr).toMatch(/placement/i);
  expect(fs.existsSync(destination)).toBe(false);
});
test('refuses replacing an existing output',()=>{
  fs.mkdirSync(destination);fs.writeFileSync(path.join(destination,'keep'),'keep');
  const result=run('stage',source,destination);expect(result.status).toBe(1);expect(result.stderr).toMatch(/already exists/i);
  expect(fs.readFileSync(path.join(destination,'keep'),'utf8')).toBe('keep');
});
test('rejects a hard-linked runtime file',()=>{
  fs.linkSync(path.join(source,'models/prices.json'),path.join(source,'models/another.json'));
  const result=run('stage',source,destination);expect(result.status).toBe(1);expect(result.stderr).toMatch(/single-link/);
});
test('is import-inert and rejects relative CLI input',()=>{
  const imported=spawnSync(process.execPath,['-e',`require(${JSON.stringify(script)})`],{encoding:'utf8',cwd:root});
  expect(imported.status).toBe(0);expect(imported.stdout).toBe('');expect(fs.readdirSync(root)).toEqual(['source']);
  const relative=run('stage','source',destination);expect(relative.status).toBe(1);expect(relative.stderr).toMatch(/absolute/i);
});
test('refuses a destination inside its source',()=>{
  const result=run('stage',source,path.join(source,'nested'));expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/overlap/i);expect(fs.existsSync(path.join(source,'nested'))).toBe(false);
});
test('rejects linked runtime directories without copying their contents',()=>{
  const external=path.join(root,'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'outside.js'),'outside');
  fs.symlinkSync(external,path.join(source,'models/linked'),process.platform==='win32'?'junction':'dir');
  const result=run('stage',source,destination);expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/link/i);expect(fs.existsSync(destination)).toBe(false);
});
test.each(['modified','removed','extra','manifest','context-manifest'])('rejects %s content after verification',kind=>{
  const staged=run('stage',source,destination);expect(staged.status).toBe(0);const {manifestSha256}=JSON.parse(staged.stdout);
  const target=path.join(destination,'server/models/prices.json');
  if(kind==='modified')fs.writeFileSync(target,'changed');
  if(kind==='removed')fs.unlinkSync(target);
  if(kind==='extra')fs.writeFileSync(path.join(destination,'unexpected.txt'),'unexpected');
  if(kind==='manifest')fs.appendFileSync(path.join(destination,'release-manifest.json'),' ');
  if(kind==='context-manifest')fs.appendFileSync(path.join(destination,'server/release-manifest.json'),' ');
  expect(run('verify',destination,manifestSha256).status).toBe(1);
});

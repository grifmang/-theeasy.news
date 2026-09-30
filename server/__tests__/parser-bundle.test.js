const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const {createParserBundle,verifyParserBundle}=require('../evidence/native/parser-bundle');
let directory,node,launcher,destination;
beforeEach(()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-bundle-test-'));
  node=path.join(directory,'node');launcher=path.join(directory,'launcher');
  // Packaging fixtures only, deliberately not executable runtime validation.
  fs.writeFileSync(node,'fixture-node');fs.writeFileSync(launcher,'fixture-launcher');
  destination=path.join(directory,'bundle');
});
afterEach(()=>fs.rmSync(directory,{recursive:true,force:true}));

test('packages exact parser dependencies and records every file hash without application data',()=>{
  const manifest=createParserBundle({destination,nodeExecutable:node,launcherExecutable:launcher});
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.packages).toEqual({parse5:'8.0.1',entities:'8.1.0'});
  expect(manifest.files.map(file=>file.path)).toEqual(expect.arrayContaining([
    'launcher','runtime/node','runtime/html-parser-worker.mjs','runtime/openssl.cnf',
    'runtime/node_modules/parse5/package.json','runtime/node_modules/entities/package.json'
  ]));
  for(const file of manifest.files) {
    const bytes=fs.readFileSync(path.join(destination,file.path));
    expect(file.size).toBe(bytes.length);
    expect(file.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    expect(file.path).not.toMatch(/(^|\/)(data|\.env|test-support|__tests__)(\/|$)/);
  }
  expect(JSON.parse(fs.readFileSync(path.join(destination,'manifest.json'),'utf8'))).toEqual(manifest);
  expect(fs.readFileSync(path.join(destination,'runtime/openssl.cnf'),'utf8')).toBe('');
});

test('does not overwrite or clean up an existing destination',()=>{
  fs.mkdirSync(destination);fs.writeFileSync(path.join(destination,'keep'),'owned');
  expect(()=>createParserBundle({destination,nodeExecutable:node,launcherExecutable:launcher})).toThrow();
  expect(fs.readFileSync(path.join(destination,'keep'),'utf8')).toBe('owned');
});

test('rejects hardlinked binary input and cleans only its newly created output',()=>{
  fs.linkSync(node,path.join(directory,'node-hardlink'));
  expect(()=>createParserBundle({destination,nodeExecutable:node,launcherExecutable:launcher})).toThrow(/regular single-link/);
  expect(fs.existsSync(destination)).toBe(false);
  expect(fs.readFileSync(node,'utf8')).toBe('fixture-node');
});

test('requires an absolute destination',()=>{
  expect(()=>createParserBundle({destination:'relative-bundle',nodeExecutable:node,launcherExecutable:launcher})).toThrow(/absolute/);
});

function packaged() {
  createParserBundle({destination,nodeExecutable:node,launcherExecutable:launcher});
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(destination,'manifest.json'))).digest('hex');
}

test('verifies a complete bundle against an independently supplied manifest digest',()=>{
  const expectedManifestSha256=packaged();
  expect(verifyParserBundle({directory:destination,expectedManifestSha256})).toEqual({
    launcher:path.join(destination,'launcher'),runtime:path.join(destination,'runtime'),
    node:path.join(destination,'runtime/node'),worker:path.join(destination,'runtime/html-parser-worker.mjs')
  });
});

test('rejects changed file bytes even when size is unchanged',()=>{
  const expectedManifestSha256=packaged(),target=path.join(destination,'runtime/node');
  fs.chmodSync(target,0o600);fs.writeFileSync(target,'altered-node');
  expect(()=>verifyParserBundle({directory:destination,expectedManifestSha256})).toThrow(/integrity/);
});

test('rejects an unlisted file in the runtime',()=>{
  const expectedManifestSha256=packaged();
  fs.writeFileSync(path.join(destination,'runtime/unexpected.js'),'extra');
  expect(()=>verifyParserBundle({directory:destination,expectedManifestSha256})).toThrow(/inventory/);
});

test('rejects linked bundle files even when their bytes match',()=>{
  const expectedManifestSha256=packaged();
  fs.linkSync(path.join(destination,'runtime/node'),path.join(directory,'linked-node'));
  expect(()=>verifyParserBundle({directory:destination,expectedManifestSha256})).toThrow(/single-link/);
});

test('rejects a changed manifest rather than trusting its replacement hashes',()=>{
  const expectedManifestSha256=packaged(),target=path.join(destination,'manifest.json');
  fs.chmodSync(target,0o600);fs.appendFileSync(target,' ');
  expect(()=>verifyParserBundle({directory:destination,expectedManifestSha256})).toThrow(/manifest integrity/);
});

test('requires an external manifest digest and an absolute bundle path',()=>{
  packaged();
  expect(()=>verifyParserBundle({directory:destination})).toThrow(/digest/);
  expect(()=>verifyParserBundle({directory:'relative',expectedManifestSha256:'a'.repeat(64)})).toThrow(/absolute/);
});

test('rejects a missing listed runtime file',()=>{
  const expectedManifestSha256=packaged(),target=path.join(destination,'runtime/node');
  fs.chmodSync(target,0o600);fs.unlinkSync(target);
  expect(()=>verifyParserBundle({directory:destination,expectedManifestSha256})).toThrow(/inventory/);
});

test('rejects traversal entries even in a digest-matching manifest',()=>{
  packaged();
  const target=path.join(destination,'manifest.json');
  const manifest=JSON.parse(fs.readFileSync(target,'utf8'));
  manifest.files[0].path='../outside';
  fs.chmodSync(target,0o600);fs.writeFileSync(target,JSON.stringify(manifest));
  const expectedManifestSha256=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  expect(()=>verifyParserBundle({directory:destination,expectedManifestSha256})).toThrow(/manifest entry/);
});

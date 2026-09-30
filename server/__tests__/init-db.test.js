const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeDatabase } = require('../init-db');
const { openStore, SCHEMA_VERSION } = require('../storage');
const { spawnSync } = require('child_process');
let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(),'easy-news-init-')); });
afterEach(() => fs.rmSync(directory,{recursive:true,force:true}));
test('creates current schema at explicit absolute path with no fabricated content', () => {
  const filename = path.join(directory,'new.db');
  initializeDatabase(filename);
  const db = openStore(filename);
  try {
    expect(db.prepare('SELECT MAX(version) version FROM rebuild_migrations').get().version).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT COUNT(*) n FROM research_claims').get().n).toBe(0);
    expect(db.pragma('integrity_check',{simple:true})).toBe('ok');
  } finally { db.close(); }
});
test('never overwrites an existing file', () => {
  const filename = path.join(directory,'existing.db');
  fs.writeFileSync(filename,'preserve this fixture');
  expect(() => initializeDatabase(filename)).toThrow();
  expect(fs.readFileSync(filename,'utf8')).toBe('preserve this fixture');
});
test.each(['relative.db',':memory:','',undefined])('rejects unsafe path %s', filename => {
  expect(() => initializeDatabase(filename)).toThrow(/absolute/);
});
test('does not invent missing parent directories', () => {
  expect(() => initializeDatabase(path.join(directory,'missing','new.db'))).toThrow();
  expect(fs.existsSync(path.join(directory,'missing'))).toBe(false);
});
test('CLI initializes once and refuses a repeated invocation', () => {
  const filename = path.join(directory,'cli.db');
  const script = path.resolve(__dirname,'../init-db.js');
  const first = spawnSync(process.execPath,[script,filename],{encoding:'utf8'});
  expect(first.status).toBe(0);
  const original = fs.readFileSync(filename);
  const second = spawnSync(process.execPath,[script,filename],{encoding:'utf8'});
  expect(second.status).toBe(1);
  expect(fs.readFileSync(filename)).toEqual(original);
});
test('CLI validates arguments and importing it does not create files', () => {
  const script = path.resolve(__dirname,'../init-db.js');
  expect(spawnSync(process.execPath,[script],{encoding:'utf8',cwd:directory}).status).toBe(1);
  expect(spawnSync(process.execPath,['-e',`require(${JSON.stringify(script)})`],{encoding:'utf8',cwd:directory}).status).toBe(0);
  expect(fs.readdirSync(directory)).toEqual([]);
});

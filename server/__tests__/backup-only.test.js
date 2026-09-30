const fs=require('fs');
const os=require('os');
const path=require('path');
const Database=require('better-sqlite3');
const {spawnSync}=require('child_process');
const script=path.resolve(__dirname,'../ops/backup-only.js');
let directory;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-news-backup-test-'));});
afterEach(()=>fs.rmSync(directory,{recursive:true,force:true}));
const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
test('backs up committed WAL data without migrating the source',()=>{
  const source=path.join(directory,'source.db');
  const destination=path.join(directory,'snapshot.db');
  const db=new Database(source);
  try {
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE evidence(text); INSERT INTO evidence VALUES('original evidence')");
    const result=run(source,destination);
    expect(result.status).toBe(0);
    const restored=new Database(destination,{readonly:true});
    try {
      expect(restored.prepare('SELECT text FROM evidence').get().text).toBe('original evidence');
      expect(restored.pragma('integrity_check',{simple:true})).toBe('ok');
      expect(restored.pragma('journal_mode',{simple:true})).toBe('delete');
      expect(db.pragma('journal_mode',{simple:true})).toBe('wal');
      expect(db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all()).toEqual([{name:'evidence'}]);
    } finally {restored.close();}
  } finally {db.close();}
});
test('refuses overwrite and same-file destination',()=>{
  const source=path.join(directory,'source.db');
  const db=new Database(source);db.exec('CREATE TABLE evidence(text)');db.close();
  const before=fs.readFileSync(source);
  const sameFile=run(source,source);
  expect(sameFile.status).toBe(1);
  expect(sameFile.stderr).toMatch(/EEXIST/);
  expect(fs.readFileSync(source)).toEqual(before);
  const target=path.join(directory,'keep.db');fs.writeFileSync(target,'keep');
  const existing=run(source,target);
  expect(existing.status).toBe(1);
  expect(existing.stderr).toMatch(/EEXIST/);
  expect(fs.readFileSync(target,'utf8')).toBe('keep');
});
test('rejects missing source and relative paths without creating files',()=>{
  const missing=run(path.join(directory,'missing.db'),path.join(directory,'out.db'));
  expect(missing.status).toBe(1);
  expect(missing.stderr).toMatch(/unable to open database/);
  const relative=run('relative.db',path.join(directory,'out.db'));
  expect(relative.status).toBe(1);
  expect(relative.stderr).toMatch(/Absolute source and destination paths required/);
  expect(fs.readdirSync(directory)).toEqual([]);
});
test('does not report a relationally inconsistent snapshot as verified',()=>{
  const source=path.join(directory,'inconsistent.db');
  const destination=path.join(directory,'rejected-snapshot.db');
  const db=new Database(source);
  db.pragma('foreign_keys = OFF');
  db.exec('CREATE TABLE parents(id INTEGER PRIMARY KEY); CREATE TABLE children(parent_id REFERENCES parents(id)); INSERT INTO children VALUES(42)');
  db.close();
  const result=run(source,destination);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/foreign-key check failed/);
  expect(result.stdout).not.toContain('Snapshot created and integrity checked');
  // Failed artifacts remain available for operator inspection, never promoted.
  expect(fs.existsSync(destination)).toBe(true);
});

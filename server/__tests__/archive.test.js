const fs=require('fs');
const os=require('os');
const path=require('path');
const {createLocalArchive}=require('../evidence/archive');
let directory,archive;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-news-originals-'));archive=createLocalArchive(directory);});
afterEach(()=>fs.rmSync(directory,{recursive:true,force:true}));
test('stores identical bytes once and verifies exact round trip',async()=>{
  const input={bytes:Buffer.from('original fixture'),mime:'text/plain',accessPolicy:'private'};
  const a=await archive.archiveOriginal(input),b=await archive.archiveOriginal(input);
  expect(a.key).toBe(b.key);expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await archive.readOriginal(a)).toEqual(input.bytes);
  expect(fs.readdirSync(directory)).toHaveLength(1);
});
test('changed bytes create separate versions',async()=>{
  const a=await archive.archiveOriginal({bytes:Buffer.from('a'),mime:'text/plain',accessPolicy:'private'});
  const b=await archive.archiveOriginal({bytes:Buffer.from('b'),mime:'text/plain',accessPolicy:'private'});
  expect(a.key).not.toBe(b.key);
});
test('corrupted originals are detected and never silently overwritten',async()=>{
  const original=await archive.archiveOriginal({bytes:Buffer.from('source'),mime:'text/plain',accessPolicy:'private'});
  fs.writeFileSync(path.join(directory,original.key),'tampered');
  await expect(archive.readOriginal(original)).rejects.toThrow(/integrity/);
  await expect(archive.archiveOriginal({bytes:Buffer.from('source'),mime:'text/plain',accessPolicy:'private'})).rejects.toThrow(/integrity/);
});
test('rejects traversal, oversized data and public storage intent',async()=>{
  await expect(archive.readOriginal({key:'../outside',sha256:'a'.repeat(64),size:3})).rejects.toThrow();
  await expect(archive.archiveOriginal({bytes:Buffer.alloc(25*1024*1024+1),mime:'text/plain',accessPolicy:'private'})).rejects.toThrow(/size/);
  await expect(archive.archiveOriginal({bytes:Buffer.from('a'),mime:'text/plain',accessPolicy:'public_original'})).rejects.toThrow(/private/);
});

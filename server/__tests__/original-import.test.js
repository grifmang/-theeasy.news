const fs=require('fs'),os=require('os'),path=require('path');
const {openStore,migrate}=require('../storage');
const {createTopic}=require('../research');
const {createLocalArchive}=require('../evidence/archive');
const {importTextOriginal}=require('../evidence/import-original');
let db,directory,archive,topicId;
beforeEach(()=>{db=openStore(':memory:');migrate(db);topicId=createTopic(db,'fixture','Fixture').id;directory=fs.mkdtempSync(path.join(os.tmpdir(),'easy-news-import-'));archive=createLocalArchive(directory);});
afterEach(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
function input(extra={}) {return {topicId,source:'Fixture',url:'https://example.com/original',title:'Fixture original',bytes:Buffer.from('Exact original text'),kind:'report',originChain:'fixture-chain',retrievedAt:'2020-01-01T00:00:00.000Z',...extra};}
test('preserves bytes and binds document to original manifest and retrieval history',async()=>{
  const result=await importTextOriginal(db,input(),archive);
  const object=db.prepare('SELECT * FROM original_objects').get();
  expect(await archive.readOriginal(object)).toEqual(Buffer.from('Exact original text'));
  expect(db.prepare('SELECT sha256 FROM document_originals WHERE document_id=?').get(result.document.id).sha256).toBe(object.sha256);
  expect(db.prepare('SELECT sha256,method FROM source_retrievals').get()).toEqual({sha256:object.sha256,method:'manual_import'});
  expect(db.prepare('SELECT evidence FROM source_items').get().evidence).toBe('Exact original text');
});
test('identical import reuses original object/document while preserving retrieval attempts',async()=>{
  const first=await importTextOriginal(db,input(),archive);
  const second=await importTextOriginal(db,input(),archive);
  expect(second.document.id).toBe(first.document.id);
  expect(db.prepare('SELECT COUNT(*) n FROM original_objects').get().n).toBe(1);
  expect(db.prepare('SELECT COUNT(*) n FROM source_retrievals').get().n).toBe(2);
});
test('invalid UTF-8 is rejected before original storage',async()=>{
  await expect(importTextOriginal(db,input({bytes:Buffer.from([0xff,0xfe])}),archive)).rejects.toThrow();
  expect(fs.readdirSync(directory)).toEqual([]);
});
test('DB failure leaves no partial document or manifest and retains original for reconciliation',async()=>{
  await expect(importTextOriginal(db,input({topicId:999}),archive)).rejects.toBeDefined();
  expect(db.prepare('SELECT COUNT(*) n FROM source_items').get().n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM original_objects').get().n).toBe(0);
  expect(fs.readdirSync(directory)).toHaveLength(1);
});

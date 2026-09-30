const {openStore,migrate,saveSource} = require('../storage');
const {setSourceAccess,getSourceAccess,recordRetrieval,listRetrievals} = require('../source-provenance');
let db, sourceId, actorId;
beforeEach(() => {
  db=openStore(':memory:'); migrate(db);
  sourceId=saveSource(db,{source:'Fixture',title:'Fixture',url:'https://example.com/doc',evidence:'Supplied text'}).id;
  actorId=Number(db.prepare("INSERT INTO users(username,password) VALUES('fixture','disabled')").run().lastInsertRowid);
});
afterEach(()=>db.close());
test('unclassified evidence defaults to private and access changes are append-only',()=>{
  expect(getSourceAccess(db,sourceId)).toEqual({policy:'private',eventId:null});
  const event=setSourceAccess(db,{sourceId,actorId,policy:'excerpt_only',reason:'Reviewed permission',expectedEventId:null});
  expect(getSourceAccess(db,sourceId)).toEqual({policy:'excerpt_only',eventId:event.id});
  expect(()=>db.exec("UPDATE source_access_events SET policy='public_original'")).toThrow(/append-only/);
  expect(()=>setSourceAccess(db,{sourceId,actorId,policy:'public_original',reason:'Stale decision',expectedEventId:null})).toThrow(/changed/);
});
test('unknown actor or permission does not grant access',()=>{
  expect(()=>setSourceAccess(db,{sourceId,actorId:999,policy:'public_original',reason:'Fixture',expectedEventId:null})).toThrow(/actor/);
  expect(()=>setSourceAccess(db,{sourceId,actorId,policy:'anything',reason:'Fixture',expectedEventId:null})).toThrow(/policy/);
  expect(getSourceAccess(db,sourceId).policy).toBe('private');
});
function retrieval(extra={}) { return {sourceId,url:'https://example.com/doc',finalUrl:'https://example.com/doc',status:200,
  retrievedAt:'2020-01-01T00:00:00.000Z',sha256:'a'.repeat(64),mime:'text/html',method:'manual_import',...extra}; }
test('records original byte digest separately from extracted source hash',()=>{
  const row=recordRetrieval(db,retrieval());
  expect(row.sha256).toBe('a'.repeat(64));
  expect(listRetrievals(db,sourceId)).toHaveLength(1);
  expect(db.prepare('SELECT content_hash FROM source_items WHERE id=?').get(sourceId).content_hash).not.toBe(row.sha256);
  expect(()=>db.exec('DELETE FROM source_retrievals')).toThrow(/append-only/);
});
test('failed retrieval has no invented content digest',()=>{
  expect(recordRetrieval(db,retrieval({status:404,sha256:null})).sha256).toBeNull();
  expect(()=>recordRetrieval(db,retrieval({status:200,sha256:null}))).toThrow(/digest/);
});
test.each([
  {url:'https://user:secret@example.com'}, {finalUrl:'file:///private'},
  {retrievedAt:'yesterday'}, {retrievedAt:'2020-02-30T00:00:00.000Z'},
  {sha256:'incorrect'}, {status:999}, {method:'invented'}
])('rejects malformed provenance %j', extra=>{
  expect(()=>recordRetrieval(db,retrieval(extra))).toThrow();
  expect(listRetrievals(db,sourceId)).toEqual([]);
});

const {openStore,migrate}=require('../storage');
const {createTopic,importDocument,addPassage}=require('../research');
const {searchPassages}=require('../retrieval/search');
const {setSourceAccess}=require('../source-provenance');
const {setPublicationOwner}=require('../publication/owner-authority');
let db,topic;
beforeEach(()=>{db=openStore(':memory:');migrate(db);topic=createTopic(db,'fixture','Fixture');db.exec("INSERT INTO users(id,username,password) VALUES(1,'editor','')");});
afterEach(()=>db.close());
function passage(content,extra={}) {
  const document=importDocument(db,{topicId:topic.id,source:'Fixture',url:'https://example.com',title:'Docket ZX123',content,kind:'report',originChain:'fixture-chain',extractionMethod:'fixture',...extra});
  return {...addPassage(db,{documentId:document.id,start:0,end:content.length,locator:'paragraph 1'}),sourceId:document.source_id};
}
test('search includes both supporting and challenging passages with provenance',()=>{
  const first=passage('Fixture witness confirms the event.');
  const second=passage('Fixture witness denies the event.');
  const result=searchPassages(db,{topicId:topic.id,query:'witness event'});
  expect(result.items.map(row=>row.id).sort()).toEqual([first.id,second.id]);
  expect(result.items[0]).toMatchObject({origin_chain:'fixture-chain',url:'https://example.com/',locator:'paragraph 1',kind:'report'});
  expect(searchPassages(db,{topicId:topic.id,query:'ZX123'}).items).toHaveLength(2);
});
test('restricted sources disappear immediately and topic filters prevent unrelated results',()=>{
  const first=passage('Unique fixture evidence');
  const other=createTopic(db,'other','Other');
  passage('Unique fixture elsewhere',{topicId:other.id});
  expect(searchPassages(db,{topicId:topic.id,query:'Unique'}).items).toHaveLength(1);
  db.exec("INSERT INTO user_roles(user_id,role) VALUES(1,'editor'); INSERT INTO google_identities(subject,user_id) VALUES('fixture-retrieval-owner',1)");
  setPublicationOwner(db,{subject:'fixture-retrieval-owner',allowed:true,reason:'Fixture owner grant',operator:'test',expectedEventId:null,requestKey:'fixture-000000000'});
  setSourceAccess(db,{sourceId:first.sourceId,actorId:1,policy:'restricted',reason:'Restricted fixture',expectedEventId:null});
  expect(searchPassages(db,{topicId:topic.id,query:'Unique'}).items).toEqual([]);
});
test('query operators are treated literally and results are bounded',()=>{
  passage('Fixture witness confirms event');passage('Fixture witness denies event');
  expect(searchPassages(db,{topicId:topic.id,query:'witness',limit:1}).items).toHaveLength(1);
  expect(searchPassages(db,{topicId:topic.id,query:'" OR * NOT ('}).items).toEqual([]);
  expect(()=>searchPassages(db,{topicId:topic.id,query:' '})).toThrow(/Invalid/);
  expect(()=>searchPassages(db,{topicId:topic.id,query:'witness',limit:1000})).toThrow(/Invalid/);
});
test('migration backfills existing passages and remains idempotent',()=>{
  const item=passage('Historical evidence');
  db.exec('DROP TRIGGER passage_search_insert; DROP TABLE passage_search; DELETE FROM rebuild_migrations WHERE version=11');
  migrate(db);migrate(db);
  expect(searchPassages(db,{topicId:topic.id,query:'Historical'}).items.map(row=>row.id)).toEqual([item.id]);
});

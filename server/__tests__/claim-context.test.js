const { openStore, migrate } = require('../storage');
const { createTopic, addClaim } = require('../research');
const { appendClaimContext, getClaimContext } = require('../claim-context');
const { appendClaimEvent, getClaimState } = require('../research-lifecycle');
const {setPublicationOwner}=require('../publication/owner-authority');
let db, claimId, actorId;
beforeEach(() => {
  db = openStore(':memory:'); migrate(db);
  actorId = Number(db.prepare("INSERT INTO users(username,password) VALUES('fixture','disabled')").run().lastInsertRowid);
  const topic = createTopic(db,'fixture','Fixture');
  claimId = addClaim(db,{topicId:topic.id,wording:'Original assertion',attribution:'Fixture',originUrl:'https://example.com'}).id;
});
afterEach(() => db.close());
function input(extra = {}) {
  return {claimId,actorId,expectedVersionId:null,normalizedWording:'Qualified assertion',
    observedAt:'2020-01-01T00:00:00.000Z',entities:[{name:'Example',identifier:null}],
    timeframe:'During 2019',location:'Unspecified',reason:'Preserve original scope',...extra};
}
test('preserves original wording while creating immutable context versions', () => {
  expect(getClaimContext(db,claimId)).toBeNull();
  const first = appendClaimContext(db,input());
  const second = appendClaimContext(db,input({expectedVersionId:first.id,timeframe:'Late 2019'}));
  expect(getClaimContext(db,claimId)).toMatchObject({id:second.id,timeframe:'Late 2019',status:'unreviewed'});
  expect(db.prepare('SELECT wording FROM research_claims WHERE id=?').get(claimId).wording).toBe('Original assertion');
  expect(db.prepare('SELECT COUNT(*) n FROM claim_context_versions').get().n).toBe(2);
  expect(() => db.exec("UPDATE claim_context_versions SET timeframe='changed'")).toThrow(/append-only/);
});
test('requires explicit optimistic concurrency and a real actor', () => {
  appendClaimContext(db,input());
  expect(() => appendClaimContext(db,input())).toThrow(/changed/);
  expect(() => appendClaimContext(db,input({actorId:999}))).toThrow(/actor/);
});
test.each(['2020-01-01','2020-02-30T00:00:00.000Z','garbage'])('rejects ambiguous or invalid observation date %s', observedAt => {
  expect(() => appendClaimContext(db,input({observedAt}))).toThrow(/observedAt/);
});
test.each([null,'Example',[{name:''}],[{name:'Example',identifier:42}],[{name:'Example',identifier:null,verified:true}]])('rejects invalid entity qualifiers', entities => {
  expect(() => appendClaimContext(db,input({entities}))).toThrow(/entities/);
});
test('unknown observation date stays explicitly null and no identity is inferred', () => {
  const row = appendClaimContext(db,input({observedAt:null,entities:[{name:'Example',identifier:null}]}));
  expect(row.observedAt).toBeNull();
  expect(row.entities).toEqual([{name:'Example',identifier:null}]);
});
test('changed context invalidates review without lifting restrictions', () => {
  db.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'editor')").run(actorId);
  db.prepare('INSERT INTO google_identities(subject,user_id) VALUES(?,?)').run('fixture-context-owner',actorId);
  setPublicationOwner(db,{subject:'fixture-context-owner',allowed:true,reason:'Fixture owner grant',operator:'test',expectedEventId:null,requestKey:'fixture-context-owner-0001'});
  const restricted = appendClaimEvent(db,{claimId,actorId,type:'restricted',reason:'Fixture',expectedEventId:null});
  appendClaimEvent(db,{claimId,actorId,type:'reviewed',reason:'Fixture',expectedEventId:restricted.id});
  appendClaimContext(db,input());
  expect(getClaimState(db,claimId)).toMatchObject({status:'unreviewed',restricted:true});
});
test('v3 upgrade preserves claims and context migrations are repeatable', () => {
  db.exec('DROP TABLE claim_context_versions; DELETE FROM rebuild_migrations WHERE version=4');
  migrate(db); migrate(db);
  expect(getClaimContext(db,claimId)).toBeNull();
  expect(db.prepare('SELECT wording FROM research_claims WHERE id=?').get(claimId).wording).toBe('Original assertion');
});

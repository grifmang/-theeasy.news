const { SCHEMA_VERSION, openStore, migrate } = require('../storage');
const { createTopic, addClaim } = require('../research');
const { appendClaimEvent, getClaimState } = require('../research-lifecycle');
const {setPublicationOwner}=require('../publication/owner-authority');
let db, claim, actorId;
beforeEach(() => {
  db = openStore(':memory:'); migrate(db);
  actorId = Number(db.prepare("INSERT INTO users(username,password) VALUES('fixture','disabled')").run().lastInsertRowid);
  const topic = createTopic(db,'fixture','Fixture');
  claim = addClaim(db,{topicId:topic.id,wording:'Fixture claim',attribution:'Fixture',originUrl:'https://example.com'});
});
afterEach(() => db.close());
function event(type, extra = {}) {
  return appendClaimEvent(db,{claimId:claim.id,actorId,type,reason:'Fixture reason',expectedEventId:getClaimState(db,claim.id).eventId,...extra});
}
test('review events change derived state without changing original claim', () => {
  expect(getClaimState(db,claim.id)).toMatchObject({status:'unreviewed',restricted:false,eventId:null});
  event('reviewed');
  expect(getClaimState(db,claim.id).status).toBe('reviewed');
  expect(db.prepare('SELECT status,wording FROM research_claims WHERE id=?').get(claim.id)).toEqual({status:'unreviewed',wording:'Fixture claim'});
  expect(() => db.exec("UPDATE claim_events SET reason='changed'")).toThrow(/append-only/);
  expect(() => db.exec('DELETE FROM claim_events')).toThrow(/append-only/);
});
test('restriction survives review and removal requires an explicit restore event', () => {
  db.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'editor')").run(actorId);
  db.prepare('INSERT INTO google_identities(subject,user_id) VALUES(?,?)').run('fixture-restriction-owner',actorId);
  setPublicationOwner(db,{subject:'fixture-restriction-owner',allowed:true,reason:'Fixture owner grant',operator:'test',expectedEventId:null,requestKey:'fixture-restriction-owner-01'});
  event('restricted'); event('reviewed');
  expect(getClaimState(db,claim.id)).toMatchObject({status:'reviewed',restricted:true});
  event('restored');
  expect(getClaimState(db,claim.id).restricted).toBe(false);
});
test('stale review fails atomically', () => {
  event('reviewed');
  expect(() => event('unreviewed',{expectedEventId:null})).toThrow(/changed/);
  expect(db.prepare('SELECT COUNT(*) n FROM claim_events').get().n).toBe(1);
});
test('unknown actor, invalid event and empty rationale never append', () => {
  expect(() => event('reviewed',{actorId:999})).toThrow(/actor/);
  expect(() => event('published')).toThrow(/type/);
  expect(() => event('reviewed',{reason:' '})).toThrow(/reason/);
  expect(db.prepare('SELECT COUNT(*) n FROM claim_events').get().n).toBe(0);
});
test('supersession needs a different claim in the same topic and cannot cycle', () => {
  expect(() => event('superseded',{supersedesId:claim.id})).toThrow(/replacement/);
  const replacement = addClaim(db,{topicId:claim.topic_id,wording:'Revised fixture',attribution:'Fixture',originUrl:'https://example.com'});
  event('superseded',{supersedesId:replacement.id});
  expect(getClaimState(db,claim.id)).toMatchObject({status:'superseded',replacementId:replacement.id});
  expect(() => appendClaimEvent(db,{claimId:replacement.id,actorId,type:'superseded',reason:'Fixture',expectedEventId:null,supersedesId:claim.id})).toThrow(/replacement/);
  expect(() => event('reviewed')).toThrow(/superseded/);
});
test('repeated migrations preserve events and original claims', () => {
  event('reviewed'); migrate(db); migrate(db);
  expect(db.prepare('SELECT COUNT(*) n FROM claim_events').get().n).toBe(1);
  expect(db.prepare('SELECT MAX(version) n FROM rebuild_migrations').get().n).toBe(SCHEMA_VERSION);
});

test('upgrades v2 preserving source evidence and legacy identities', () => {
  // Remove only the new empty schema in this isolated fixture to represent v2.
  db.exec('DROP TABLE claim_events; DELETE FROM rebuild_migrations WHERE version=3');
  const before = db.prepare('SELECT * FROM research_claims').all();
  migrate(db);
  expect(db.prepare('SELECT * FROM research_claims').all()).toEqual(before);
  expect(db.prepare('SELECT username FROM users WHERE id=?').get(actorId).username).toBe('fixture');
  expect(getClaimState(db,claim.id).status).toBe('unreviewed');
});

test('migration conflict rolls back without marking v3 applied', () => {
  db.exec('DROP TABLE claim_events; DELETE FROM rebuild_migrations WHERE version=3; CREATE TABLE claim_events(conflict TEXT)');
  expect(() => migrate(db)).toThrow();
  expect(db.prepare('SELECT version FROM rebuild_migrations WHERE version=3').get()).toBeUndefined();
  expect(db.prepare('SELECT wording FROM research_claims WHERE id=?').get(claim.id).wording).toBe('Fixture claim');
});

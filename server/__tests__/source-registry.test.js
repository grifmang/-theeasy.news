const {createSourceRegistry}=require('../discovery/registry');
const approved={id:'court-fixture',hosts:['records.example.org'],mimeTypes:['text/html','application/pdf'],retention:'private',accessReviewed:true,robotsReviewed:true,requestsPerMinute:6};
test('requires explicit approval and returns a detached immutable policy',()=>{
  const input={...approved,hosts:[...approved.hosts]};
  const registry=createSourceRegistry([input]);
  input.hosts.push('attacker.example');
  const policy=registry.resolve('court-fixture','https://records.example.org/document?id=1');
  expect(policy.hosts).toEqual(['records.example.org']);
  expect(Object.isFrozen(policy)).toBe(true);
  expect(Object.isFrozen(policy.hosts)).toBe(true);
  expect(()=>registry.resolve('court-fixture','https://attacker.example/')).toThrow();
});
test.each([
  'http://records.example.org/', 'https://records.example.org.attacker.test/',
  'https://sub.records.example.org/', 'https://user:password@records.example.org/',
  'https://records.example.org:8443/', 'file:///etc/passwd', 'https://127.0.0.1/'
])('rejects unapproved URL %s',url=>{
  expect(()=>createSourceRegistry([approved]).resolve('court-fixture',url)).toThrow();
});
test('unknown and duplicate policies fail closed',()=>{
  expect(()=>createSourceRegistry([approved]).resolve('unknown','https://records.example.org/')).toThrow();
  expect(()=>createSourceRegistry([approved,approved])).toThrow();
});
test.each([
  {accessReviewed:false},{robotsReviewed:false},{requestsPerMinute:0},
  {requestsPerMinute:1.5},{retention:'public'},{hosts:['*.example.org']},
  {hosts:['localhost']},{hosts:['127.0.0.1']},{mimeTypes:['*/*']}
])('rejects unsafe policy %j',override=>{
  expect(()=>createSourceRegistry([{...approved,...override}])).toThrow();
});

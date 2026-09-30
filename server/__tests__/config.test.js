const path = require('path');
const { loadConfig } = require('../config');

const base = { NODE_ENV: 'test', DB_PATH: ':memory:' };
test('maintenance requires an explicit unambiguous switch',()=>{
  expect(loadConfig(base).maintenanceMode).toBe(false);
  expect(loadConfig({...base,MAINTENANCE_MODE:'true'}).maintenanceMode).toBe(true);
  expect(()=>loadConfig({...base,MAINTENANCE_MODE:'1'})).toThrow(/MAINTENANCE_MODE/);
});
test('HTML parsing requires explicit unambiguous opt-in',()=>{
  expect(loadConfig(base).htmlExtractionEnabled).toBe(false);
  expect(loadConfig({...base,HTML_EXTRACTION_ENABLED:'true'}).htmlExtractionEnabled).toBe(true);
  expect(()=>loadConfig({...base,HTML_EXTRACTION_ENABLED:'yes'})).toThrow(/HTML_EXTRACTION_ENABLED/);
});
test('ingestion requires explicit unambiguous opt-in without paid model keys',()=>{
  expect(loadConfig(base).ingestionEnabled).toBe(false);
  expect(loadConfig({...base,INGESTION_ENABLED:'true'}).ingestionEnabled).toBe(true);
  expect(()=>loadConfig({...base,INGESTION_ENABLED:'yes'})).toThrow(/INGESTION_ENABLED/);
});
test('classification independently requires opt-in, Jev key and budget but no writer key',()=>{
  expect(loadConfig(base).classificationEnabled).toBe(false);
  const enabled={...base,CLASSIFICATION_ENABLED:'true',DAILY_BUDGET_MICROS:'10000',MONTHLY_BUDGET_MICROS:'10000'};
  expect(()=>loadConfig(enabled)).toThrow(/TYPESAFE_API_KEY/);
  expect(loadConfig({...enabled,TYPESAFE_API_KEY:'fixture'}).classificationEnabled).toBe(true);
  expect(()=>loadConfig({...enabled,TYPESAFE_API_KEY:'fixture',DAILY_BUDGET_MICROS:'0'})).toThrow(/budget/);
});
test('paid processing and publication are disabled without explicit opt-in', () => {
  expect(loadConfig(base)).toMatchObject({ mode:'test', generationEnabled:false,
    autoPublishEnabled:false, dailyBudgetMicros:0, monthlyBudgetMicros:0 });
});
test.each(['data.db', ':memory:', '', undefined])('production rejects unsafe DB path %s', DB_PATH => {
  expect(() => loadConfig({ NODE_ENV:'production', DB_PATH })).toThrow(/DB_PATH/);
});
test('production accepts explicit persistent path without disabled-feature secrets', () => {
  expect(loadConfig({ NODE_ENV:'production', DB_PATH:path.resolve('data.db') }).dbPath).toBe(path.resolve('data.db'));
});
test.each(['yes','1','TRUE','',true])('rejects ambiguous feature boolean %s', value => {
  expect(() => loadConfig({ ...base, GENERATION_ENABLED:value })).toThrow(/GENERATION_ENABLED/);
});
test('automatic publication cannot be enabled in this release', () => {
  expect(() => loadConfig({ ...base, AUTO_PUBLISH_ENABLED:'true' })).toThrow(/publication/);
});
test.each(['-1','1.5','1e6','9007199254740992','',null])('rejects invalid microdollar budget %s', value => {
  expect(() => loadConfig({ ...base, DAILY_BUDGET_MICROS:value })).toThrow(/DAILY_BUDGET_MICROS/);
});
test('enabled generation requires both provider keys and positive bounded budgets', () => {
  const enabled = { ...base, GENERATION_ENABLED:'true', DAILY_BUDGET_MICROS:'1000000', MONTHLY_BUDGET_MICROS:'10000000' };
  expect(() => loadConfig(enabled)).toThrow(/TYPESAFE_API_KEY/);
  expect(() => loadConfig({ ...enabled, TYPESAFE_API_KEY:'fixture' })).toThrow(/OPENAI_API_KEY/);
  expect(loadConfig({ ...enabled, TYPESAFE_API_KEY:'fixture', OPENAI_API_KEY:'fixture' }).generationEnabled).toBe(true);
  expect(() => loadConfig({ ...enabled, TYPESAFE_API_KEY:'fixture', OPENAI_API_KEY:'fixture', DAILY_BUDGET_MICROS:'0' })).toThrow(/budget/);
});
test('rejects unknown runtime modes and daily limits above monthly limit', () => {
  expect(() => loadConfig({ ...base, NODE_ENV:'prod' })).toThrow(/NODE_ENV/);
  expect(() => loadConfig({ ...base, DAILY_BUDGET_MICROS:'2', MONTHLY_BUDGET_MICROS:'1' })).toThrow(/budget/);
});
test('configuration does not expose provider secrets in serialized output', () => {
  expect(JSON.stringify(loadConfig({ ...base, OPENAI_API_KEY:'private-fixture' }))).not.toContain('private-fixture');
});

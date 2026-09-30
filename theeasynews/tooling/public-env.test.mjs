import test from 'node:test';
import assert from 'node:assert/strict';
import { publicDefines } from './public-env.mjs';

test('only explicitly public settings can be compiled into browser code', () => {
  assert.deepEqual(publicDefines({}), {
    'process.env.REACT_APP_API_URL': '""',
    'process.env.REACT_APP_GOOGLE_CLIENT_ID': '""',
  });
  const result = publicDefines({ REACT_APP_API_URL: '/fixture', REACT_APP_GOOGLE_CLIENT_ID: 'public-id', SECRET: 'never-ship', REACT_APP_SECRET: 'also-never-ship' });
  assert.equal(Object.keys(result).length, 2);
  assert.equal(result['process.env.REACT_APP_API_URL'], '"/fixture"');
  assert.ok(!JSON.stringify(result).includes('never-ship'));
});

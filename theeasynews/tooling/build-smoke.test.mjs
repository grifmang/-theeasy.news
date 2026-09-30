import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('production build retains static entry assets and only approved public config', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-vite-check-'));
  try {
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'),
      'build', '--outDir', output], {
      cwd: root, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, REACT_APP_API_URL: '/fixture-public-api',
        REACT_APP_GOOGLE_CLIENT_ID: 'fixture-public-google',
        SECRET: 'fixture-secret-never-ship', REACT_APP_SECRET: 'fixture-prefixed-secret-never-ship' },
    });
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)];
    assert.ok(assets.length >= 2);
    for (const [, asset] of assets) assert.ok(fs.existsSync(path.join(output, asset.slice(1))));
    assert.ok(!html.includes('%PUBLIC_URL%'));
    const scripts = fs.readdirSync(path.join(output, 'assets')).filter(name => name.endsWith('.js'))
      .map(name => fs.readFileSync(path.join(output, 'assets', name), 'utf8')).join('\n');
    assert.ok(scripts.includes('/fixture-public-api'));
    assert.ok(scripts.includes('fixture-public-google'));
    assert.ok(!scripts.includes('fixture-secret-never-ship'));
    assert.ok(!scripts.includes('fixture-prefixed-secret-never-ship'));
    assert.ok(!scripts.includes('process.env.REACT_APP_'));
  } finally {
    // Only the exact disposable directory returned by mkdtemp above is removed.
    fs.rmSync(output, { recursive: true, force: true });
  }
});

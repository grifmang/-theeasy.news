// Operator-invoked synthetic probe only. Importing this file is inert.
// Accept compiled binaries as gzip buffers; never accept these through an API.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gunzipSync } = require('zlib');
const { spawnSync } = require('child_process');

function runSandboxProbe({ launcherGzip, adversaryGzip, nodeIntegrity, htmlWorkerBase64 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-isolation-probe-'));
  const results = [];
  try {
    const runtime = path.join(root, 'runtime'); fs.mkdirSync(runtime);
    const launcher = path.join(root, 'launcher'), helper = path.join(runtime, 'worker');
    fs.writeFileSync(launcher, gunzipSync(Buffer.from(launcherGzip, 'base64')), { mode: 0o700 });
    fs.writeFileSync(helper, gunzipSync(Buffer.from(adversaryGzip, 'base64')), { mode: 0o700 });
    const privateFile = path.join(root, 'private.txt'), readable = path.join(runtime, 'public.txt');
    fs.writeFileSync(privateFile, 'synthetic private fixture');
    fs.writeFileSync(readable, 'synthetic runtime fixture');
    fs.symlinkSync(privateFile, `${readable}-link`);
    const cases = ['checks', 'links', 'scratch-exec', 'fd-limit', 'threads', 'memory', 'file-limit', 'cpu'];
    for (const mode of cases) {
      const scratch = fs.mkdtempSync(path.join(root, 'scratch-'));
      const inherited = fs.openSync(privateFile, 'r');
      try {
        const result = spawnSync(launcher, [runtime, scratch, helper, mode, privateFile, readable], {
          input: '', encoding: 'utf8', timeout: 6000,
          env: { SANDBOX_TEST_SECRET: 'do-not-inherit' },
          stdio: ['pipe', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', inherited],
        });
        const pass = mode === 'cpu' ? ['SIGXCPU', 'SIGKILL'].includes(result.signal)
          : mode === 'file-limit' ? result.signal === 'SIGXFSZ' : result.status === 0;
        results.push({ mode, pass, status: result.status, signal: result.signal, error: result.error?.code,
          diagnostic: pass ? undefined : result.stderr.slice(0, 300) });
      } finally { fs.closeSync(inherited); }
    }
    // Use the portable, exact-version runtime tested locally. The Railway Nix
    // binary requires a loader outside our allowlist; do not allow /nix/store.
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(nodeIntegrity || '')) throw new Error('Missing trusted Node integrity');
    const npm = spawnSync('npm', ['pack', 'node-linux-x64@22.23.1', '--ignore-scripts', '--json',
      '--registry=https://registry.npmjs.org'], { cwd: root, encoding: 'utf8', timeout: 60000,
      env: { PATH: process.env.PATH, HOME: root, NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_CACHE: path.join(root, 'npm-cache') } });
    if (npm.status !== 0) throw new Error('Portable runtime acquisition failed');
    const archive = path.join(root, 'node-linux-x64-22.23.1.tgz');
    const digest = `sha512-${require('crypto').createHash('sha512').update(fs.readFileSync(archive)).digest('base64')}`;
    if (digest !== nodeIntegrity) throw new Error('Portable runtime integrity mismatch');
    // Exact archive bytes matched the locally inspected regular-file member.
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', runtime, '--strip-components=2', 'package/bin/node'],
      { timeout: 10000, encoding: 'utf8' });
    if (unpack.status !== 0) throw new Error('Portable runtime unpack failed');
    const node = path.join(runtime, 'node'); fs.chmodSync(node, 0o700);
    const openssl = path.join(runtime, 'openssl.cnf'); fs.writeFileSync(openssl, '');
    const scratch = fs.mkdtempSync(path.join(root, 'node-scratch-'));
    const program = `const fs=require('fs'),assert=require('assert');
      assert.equal(process.env.SANDBOX_TEST_SECRET,undefined);
      assert.throws(()=>fs.readFileSync(process.argv[1]),{code:'EACCES'});
      assert.equal(require('child_process').spawnSync('/bin/true').error.code,'EPERM');
      const socket=require('net').createConnection({host:'127.0.0.1',port:9});
      socket.once('connect',()=>{process.exitCode=1;socket.destroy();});
      socket.once('error',error=>{assert.equal(error.code,'EPERM');process.stdout.write('node restrictions verified');});`;
    const nodeResult = spawnSync(launcher, [runtime, scratch, node, `--openssl-config=${openssl}`,
      '--jitless', '--no-expose-wasm', '--max-old-space-size=96', '--max-semi-space-size=4',
      '-e', program, privateFile], { input: '', encoding: 'utf8', timeout: 6000, env: { SANDBOX_TEST_SECRET: 'do-not-inherit' } });
    results.push({ mode: 'portable-node-22.23.1', pass: nodeResult.status === 0 && nodeResult.stdout === 'node restrictions verified',
      status: nodeResult.status, signal: nodeResult.signal, error: nodeResult.error?.code,
      diagnostic: nodeResult.status === 0 ? undefined : nodeResult.stderr.slice(0, 2000) });
    if (htmlWorkerBase64) {
      const packages = [
        ['parse5', '8.0.1', 'sha512-z1e/HMG90obSGeidlli3hj7cbocou0/wa5HacvI3ASx34PecNjNQeaHNo5WIZpWofN9kgkqV1q5YvXe3F0FoPw=='],
        ['entities', '8.1.0', 'sha512-kxL7msIffSuh9aaFAMD7rxAIuTRMAHMeBtgHW2yUdWw732ZNh4MehkF2gdjvtdmikkaIP9bFDDJOPlsvm7avrA=='],
      ];
      for (const [name, version, integrity] of packages) {
        const packed = spawnSync('npm', ['pack', `${name}@${version}`, '--ignore-scripts', '--json',
          '--registry=https://registry.npmjs.org'], { cwd: root, encoding: 'utf8', timeout: 60000,
          env: { PATH: process.env.PATH, HOME: root, NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_CACHE: path.join(root, 'npm-cache') } });
        if (packed.status !== 0) throw new Error('Parser dependency acquisition failed');
        const archivePath = path.join(root, `${name}-${version}.tgz`);
        const hash = `sha512-${require('crypto').createHash('sha512').update(fs.readFileSync(archivePath)).digest('base64')}`;
        if (hash !== integrity) throw new Error('Parser dependency integrity mismatch');
        const destination = path.join(runtime, 'node_modules', name); fs.mkdirSync(destination, { recursive: true });
        // Only exact, pinned trusted package artifacts are handled by this probe.
        const extracted = spawnSync('tar', ['-xzf', archivePath, '-C', destination, '--strip-components=1'],
          { timeout: 10000, encoding: 'utf8' });
        if (extracted.status !== 0) throw new Error('Parser dependency extraction failed');
      }
      fs.writeFileSync(path.join(runtime, 'package.json'), '{"type":"module"}');
      const worker = path.join(runtime, 'html-parser-worker.mjs');
      fs.writeFileSync(worker, Buffer.from(htmlWorkerBase64, 'base64'));
      const largeSource = Array.from({ length: 5000 }, (_, i) => `<p>Synthetic record ${i}.</p>`).join('');
      const htmlCases = [
        { name: 'entities-and-active-content', input: '<p>Person A &amp; Person B: $1,200.</p><script>invented</script>', expected: 'Person A & Person B: $1,200.\n' },
        { name: 'table-and-footnote', input: '<table><tr><td>Date</td><td>2020-01-02</td></tr></table><p>Note 1</p>', expected: 'Date\t2020-01-02\t\nNote 1\n' },
        { name: 'larger-document', input: largeSource, expected: Array.from({ length: 5000 }, (_, i) => `Synthetic record ${i}.\n`).join('') },
        { name: 'empty-content', input: '<script>not evidence</script>', rejected: true },
        { name: 'invalid-utf8', input: Buffer.from([0xff]), rejected: true },
      ];
      for (const fixture of htmlCases) {
        const work = fs.mkdtempSync(path.join(root, 'html-scratch-'));
        const parsed = spawnSync(launcher, [runtime, work, node, `--openssl-config=${openssl}`,
          '--jitless', '--no-expose-wasm', '--max-old-space-size=96', '--max-semi-space-size=4', worker],
          { input: fixture.input, encoding: 'utf8', timeout: 6000, maxBuffer: 8388608, env: {} });
        let pass = fixture.rejected ? parsed.status === 1 && parsed.stdout === '' : false;
        if (!fixture.rejected && parsed.status === 0) {
          const output = JSON.parse(parsed.stdout);
          pass = output.text === fixture.expected && output.quality.requiresReview === true &&
            output.extractorVersion === 'parse5-8.0.1-text-v1' && output.spans.length > 0 &&
            output.spans.every(span => Number.isInteger(span.start) && span.start >= 0 && span.end > span.start &&
              span.end <= output.text.length && span.sourceStart >= 0 && span.sourceEnd <= fixture.input.length);
        }
        results.push({ mode: `html-${fixture.name}`, pass, status: parsed.status, signal: parsed.signal,
          diagnostic: pass ? undefined : parsed.stderr.slice(0, 1000) });
      }
    }
    const report = { node: process.version, uid: process.getuid(), results, pass: results.every(item => item.pass) };
    console.log(JSON.stringify(report));
    return report;
  } finally {
    // Exact directory returned by mkdtemp; only synthetic probe files inside.
    fs.rmSync(root, { recursive: true, force: true });
  }
}
module.exports = { runSandboxProbe };

// Synthetic Linux integration tests, run by sandbox-tests.py; no service imports.
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {extractHtml}=require('../evidence/extract-html');

async function runHtmlWrapperProbe(bundleDirectory,scratchParent) {
  const manifestSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(bundleDirectory,'manifest.json'))).digest('hex');
  const options={bundleDirectory,manifestSha256,scratchParent};
  const result=await extractHtml(Buffer.from('<p>Application &amp; sandbox.</p>'),options);
  assert.equal(result.text,'Application & sandbox.\n');
  assert.equal(result.quality.requiresReview,true);
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  await assert.rejects(extractHtml(Buffer.from('<p>Must not run.</p>')));
  const controller=new AbortController();
  const pending=extractHtml(Buffer.from('<p>Cancelled.</p>'),{...options,signal:controller.signal});
  controller.abort();
  await assert.rejects(pending);
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  await assert.rejects(extractHtml(Buffer.from([255]),options));
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  const worker=path.join(bundleDirectory,'runtime/html-parser-worker.mjs');
  fs.chmodSync(worker,0o600);fs.appendFileSync(worker,'\n// tampered synthetic fixture\n');
  await assert.rejects(extractHtml(Buffer.from('<p>Reject altered worker.</p>'),options));
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  // Deliberately rebuild trusted *test* manifests for adversarial worker
  // fixtures. Production must obtain its expected digest outside the bundle.
  function fixtureWorker(source) {
    fs.writeFileSync(worker,source);
    const manifestPath=path.join(bundleDirectory,'manifest.json');
    const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    const entry=manifest.files.find(file=>file.path==='runtime/html-parser-worker.mjs');
    entry.size=Buffer.byteLength(source);
    entry.sha256=crypto.createHash('sha256').update(source).digest('hex');
    fs.chmodSync(manifestPath,0o600);fs.writeFileSync(manifestPath,JSON.stringify(manifest));
    options.manifestSha256=crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
  }
  fixtureWorker('process.stdin.resume();process.stdout.write("{}");');
  await assert.rejects(extractHtml(Buffer.from('<p>Reject malformed result.</p>'),options));
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  fixtureWorker('process.stdin.resume();setInterval(()=>{},1000);');
  await assert.rejects(extractHtml(Buffer.from('<p>Deadline.</p>'),options));
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  fixtureWorker('process.stdin.resume();process.stdout.write("x".repeat(9*1024*1024));setInterval(()=>{},1000);');
  await assert.rejects(extractHtml(Buffer.from('<p>Output bound.</p>'),options));
  assert.deepEqual(fs.readdirSync(scratchParent),[]);
  return {cases:8};
}
module.exports={runHtmlWrapperProbe};

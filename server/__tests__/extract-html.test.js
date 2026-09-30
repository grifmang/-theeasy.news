// Portable fidelity/lifecycle fixtures. Linux sandbox-tests.py tests the real
// production entry point without mocking its kernel or executable.
const {extractHtml}=require('../test-support/html-worker-harness');
test('HTML extraction decodes entities, keeps paragraphs and marks review required',async()=>{
  const source='<!doctype html><html><body><p>A &amp; B</p><p>Second fact.</p><script>steal()</script></body></html>';
  const result=await extractHtml(Buffer.from(source));
  expect(result?.text).toContain('A & B');expect(result.text).toContain('\nSecond fact.');
  expect(result.text).not.toContain('steal');expect(result.quality.requiresReview).toBe(true);
  const first=result.spans[0];
  expect(result.text.slice(first.start,first.end)).toBe('A & B');
  expect(source.slice(first.sourceStart,first.sourceEnd)).toBe('A &amp; B');
});
test('table cells remain separated and footnotes remain present',async()=>{
  const result=await extractHtml(Buffer.from('<html><body><table><tr><td>Name</td><td>Amount</td></tr><tr><td>Alice</td><td>10</td></tr></table><p>Footnote: estimate only.</p></body></html>'));
  expect(result?.text).toContain('Name\tAmount');
  expect(result.text).toContain('Alice\t10');expect(result.text).toContain('Footnote: estimate only.');
});
test('scripts, styles, templates and explicitly hidden text are not evidence',async()=>{
  const result=await extractHtml(Buffer.from('<html><body><style>secret1</style><template>secret2</template><p hidden>secret3</p><p>Visible</p></body></html>'));
  expect(result?.text).toContain('Visible');expect(result.text).not.toContain('secret');
});
test('invalid UTF-8 and empty HTML reject rather than inventing text',async()=>{
  await expect(extractHtml(Buffer.from([255]))).rejects.toThrow();
  await expect(extractHtml(Buffer.from('<html><body></body></html>'))).rejects.toThrow();
});
test('oversized output is rejected without returning truncated evidence',async()=>{
  await expect(extractHtml(Buffer.from('<html><body><p>'+'x'.repeat(1000001)+'</p></body></html>'))).rejects.toThrow();
});
test('pre-cancelled extraction rejects before parsing',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(extractHtml(Buffer.from('<html><body>Text</body></html>'),{signal:controller.signal})).rejects.toThrow();
});
test('spaces between inline elements preserve names and amounts',async()=>{
  const result=await extractHtml(Buffer.from('<html><body><p><span>Alice</span> <b>Smith</b> paid <span>10</span> <span>USD</span>.</p></body></html>'));
  expect(result.text).toBe('Alice Smith paid 10 USD.\n');
});
test('preformatted whitespace survives nested markup',async()=>{
  const result=await extractHtml(Buffer.from('<html><body><pre>Line 1\n  <b>Line 2</b>\n\t10  USD</pre></body></html>'));
  expect(result.text).toBe('Line 1\n  Line 2\n\t10  USD\n');
});
test('in-flight cancellation does not resolve until the parser child exits',async()=>{
  jest.resetModules();
  const childProcess=require('child_process'),realSpawn=childProcess.spawn;
  let child;
  const spy=jest.spyOn(childProcess,'spawn').mockImplementation((...args)=>{child=realSpawn(...args);return child;});
  try {
    const isolated=require('../test-support/html-worker-harness');
    const controller=new AbortController();
    const pending=isolated.extractHtml(Buffer.from('<html><body>Text</body></html>'),{signal:controller.signal});
    const rejected=expect(pending).rejects.toThrow(/extraction/);
    controller.abort();await rejected;
    expect(child.exitCode!==null||child.signalCode!==null).toBe(true);
  } finally {
    if(child&&child.exitCode===null&&child.signalCode===null) await new Promise(resolve=>{child.once('close',resolve);child.kill();});
    spy.mockRestore();
  }
});
test('deadline terminates a stalled child before reporting failure',async()=>{
  jest.resetModules();
  const childProcess=require('child_process'),realSpawn=childProcess.spawn;
  let child;
  const spy=jest.spyOn(childProcess,'spawn').mockImplementation((executable,args,options)=>{
    child=realSpawn(executable,['-e','process.stdin.resume();setInterval(()=>{},1000)'],options);return child;
  });
  try {
    const isolated=require('../test-support/html-worker-harness');
    await expect(isolated.extractHtml(Buffer.from('<html><body>Text</body></html>'))).rejects.toThrow(/extraction/);
    expect(child.exitCode!==null||child.signalCode!==null).toBe(true);
  } finally {
    if(child&&child.exitCode===null&&child.signalCode===null) await new Promise(resolve=>{child.once('close',resolve);child.kill('SIGKILL');});
    spy.mockRestore();
  }
},10000);

const { createRequire } = require('node:module');

test.each(['gaxios', 'node-cron'])('%s resolves patched CommonJS uuid', dependency => {
  const dependencyRequire = createRequire(require.resolve(dependency));
  expect(dependencyRequire('uuid/package.json').version).toBe('11.1.1');
  expect(dependencyRequire('uuid').v4()).toMatch(/^[0-9a-f-]{36}$/);
});

test('real cron creates and manually executes a stopped task', () => {
  const cron = require('node-cron');
  const callback = jest.fn();
  const task = cron.schedule('* * * * *', callback, { scheduled: false });
  try {
    expect(task.options.name).toMatch(/^[0-9a-f-]{36}$/);
    task.now();
    expect(callback).toHaveBeenCalledTimes(1);
  } finally { task.stop(); }
});

test('gaxios builds a multipart body using its real uuid dependency without network', async () => {
  const { Gaxios } = require('gaxios');
  let contentType, body = '';
  await new Gaxios().request({
    url: 'https://example.invalid/upload', method: 'POST',
    multipart: [{ headers: { 'Content-Type': 'text/plain' }, content: 'fixture-content' }],
    adapter: async options => {
      contentType = options.headers['Content-Type'];
      for await (const chunk of options.body) body += chunk.toString();
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config: options };
    },
  });
  const boundary = contentType.split('boundary=')[1];
  expect(boundary).toMatch(/^[0-9a-f-]{36}$/);
  expect(body).toContain(boundary);
  expect(body).toContain('fixture-content');
});

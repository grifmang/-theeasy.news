import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

test('lint gate detects undefined values, invalid hooks, and inaccessible images', async () => {
  const lint = new ESLint({ cwd: fileURLToPath(new URL('../', import.meta.url)) });
  const [result] = await lint.lintText(`import React, { useState } from 'react';
    export default function Example({enabled}) {
      if (enabled) useState(0);
      return <img src={unknownImage} />;
    }`, { filePath: 'src/LintFixture.jsx' });
  const rules = result.messages.map(message => message.ruleId);
  for (const expected of ['no-undef', 'react-hooks/rules-of-hooks', 'jsx-a11y/alt-text']) {
    assert.ok(rules.includes(expected), `Missing enforcement: ${expected}`);
  }
});

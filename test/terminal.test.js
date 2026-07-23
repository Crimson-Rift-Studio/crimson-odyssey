import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import * as terminal from '../src/core/terminal.js';

async function enterSecret(chunks) {
  assert.equal(typeof terminal.readMaskedInput, 'function');
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  let output = '';
  const result = terminal.readMaskedInput('API key: ', {
    input,
    output: { write(chunk) { output += String(chunk); } }
  });
  for (const chunk of chunks) input.write(chunk);
  return { value: await result, output };
}

test('masked input accepts single characters and Enter without leaking the secret', async () => {
  const result = await enterSecret(['a', 'b', 'c', '\r']);
  assert.equal(result.value, 'abc');
  assert.match(result.output, /\*{3}/);
  assert.equal(result.output.includes('abc'), false);
});

test('masked input accepts a pasted multi-character chunk', async () => {
  const result = await enterSecret(['pasted-secret', '\r']);
  assert.equal(result.value, 'pasted-secret');
  assert.match(result.output, /\*{13}/);
  assert.equal(result.output.includes('pasted-secret'), false);
});

test('masked input handles backspace', async () => {
  const result = await enterSecret(['abc', '\x7f', 'd', '\r']);
  assert.equal(result.value, 'abd');
  assert.equal(result.output.includes('abc'), false);
});

test('masked input supports Ctrl+C cancellation without secret leakage', async () => {
  assert.equal(typeof terminal.readMaskedInput, 'function');
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  let output = '';
  const result = terminal.readMaskedInput('API key: ', {
    input,
    output: { write(chunk) { output += String(chunk); } }
  });
  input.write('partial-secret');
  input.write('\x03');
  await assert.rejects(result, /cancel/i);
  assert.equal(output.includes('partial-secret'), false);
});

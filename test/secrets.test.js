import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { setSecret, resolveSecret, deleteSecret, secretStatus } from '../src/core/secrets.js';
import { globalPaths } from '../src/core/paths.js';
import { sanitizeLogText } from '../src/core/log.js';
import { tempDir } from './helpers.js';

test('encrypted vault stores and resolves a secret without plaintext leakage', () => {
  const tmp = tempDir('crimson-vault-');
  const oldPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const secret = 'test-secret-value-123456789';
    const ref = setSecret('provider-key', secret, { home: tmp.dir });
    assert.equal(ref, 'vault:provider-key');
    assert.equal(resolveSecret(ref, { home: tmp.dir }), secret);
    const paths = globalPaths(tmp.dir);
    assert.equal(existsSync(paths.vault), true);
    assert.equal(readFileSync(paths.vault, 'utf8').includes(secret), false);
    assert.deepEqual(secretStatus(ref, { home: tmp.dir }), { ref, available: true, backend: 'vault' });
    assert.equal(deleteSecret(ref, { home: tmp.dir }), true);
    assert.equal(resolveSecret(ref, { home: tmp.dir }), null);
  } finally {
    process.env.PATH = oldPath;
    tmp.cleanup();
  }
});

test('environment secret references are resolved without persistence', () => {
  process.env.CRIMSON_TEST_SECRET = 'environment-value';
  assert.equal(resolveSecret('env:CRIMSON_TEST_SECRET'), 'environment-value');
  delete process.env.CRIMSON_TEST_SECRET;
});

test('log sanitizer removes common Telegram, Discord, and provider token patterns', () => {
  const text = [
    ['8663874963', ':', 'AAEF37MWdgdpupengyiN6iZwDTHWOqcMjak'].join(''),
    ['MTUyMTIwNzUwMzkwMjIxNjI4Mg', '.', 'GkwEAg', '.', 'QW1JQizNl2f--u0gmyn6cOzlb5E5FYXbWqsJ6w'].join(''),
    ['sk-', 'abcdefghijklmnopqrstuvwxyz', '123456'].join('')
  ].join(' ');
  const out = sanitizeLogText(text);
  assert.equal(out.includes('8663874963:'), false);
  assert.equal(out.includes('.GkwEAg.'), false);
  assert.equal(out.includes(['sk-', 'abcdefghijklmnopqrstuvwxyz'].join('')), false);
  assert.match(out, /\[REDACTED\]/);
});

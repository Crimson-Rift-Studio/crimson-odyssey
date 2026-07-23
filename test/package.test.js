import test from 'node:test';
import assert from 'node:assert/strict';
import * as pkg from '../src/index.js';

test('public package entry exports core APIs', () => {
  assert.equal(pkg.VERSION, '0.3.0');
  assert.equal(typeof pkg.main, 'function');
  assert.equal(typeof pkg.initializeWorkspace, 'function');
  assert.equal(typeof pkg.runAgentTurn, 'function');
  assert.equal(Array.isArray(pkg.PROVIDERS), true);
});

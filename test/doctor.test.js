import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeWorkspace } from '../src/core/state.js';
import * as doctor from '../src/doctor.js';
import { tempDir } from './helpers.js';

test('doctor initializes and reports a usable workspace with model warnings', async () => {
  const tmp = tempDir();
  try {
    initializeWorkspace(tmp.dir);
    const report = await doctor.runDoctor({ workspace: tmp.dir });
    assert.equal(report.ok, true);
    assert.equal(['warning', 'healthy'].includes(report.status), true);
    assert.equal(report.checks.some((item) => item.name === 'Workspace state' && item.ok), true);
    assert.equal(report.checks.some((item) => item.name === 'Model provider' && !item.ok), true);
  } finally { tmp.cleanup(); }
});

test('selected provider doctor rejects missing direct credentials', async () => {
  assert.equal(typeof doctor.doctorSelectedProvider, 'function');
  const result = await doctor.doctorSelectedProvider({
    model: { provider: 'openai', model: 'gpt-test', secretRef: 'env:MISSING_TEST_KEY' },
    config: { providers: { openai: { secretRef: 'env:MISSING_TEST_KEY' } } }
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /credential/i);
});

test('selected provider doctor rejects an authentication failure from the model catalog', async () => {
  const result = await doctor.doctorSelectedProvider({
    model: { provider: 'openai', model: 'gpt-test', secretRef: 'env:OPENAI_API_KEY' },
    config: { providers: { openai: { secretRef: 'env:OPENAI_API_KEY' } } },
    catalog: { error: '401 Unauthorized: invalid API key', models: [{ id: 'gpt-test' }] },
    resolveSecretImpl: () => 'invalid-key'
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /authentication/i);
});

test('selected provider doctor rejects an unavailable CLI executable', async () => {
  assert.equal(typeof doctor.doctorSelectedProvider, 'function');
  const result = await doctor.doctorSelectedProvider({
    model: { provider: 'codex-cli', model: 'default', executable: 'C:\\missing\\codex.exe' },
    config: { providers: { 'codex-cli': { executable: 'C:\\missing\\codex.exe' } } },
    cliResolver: () => ({ usable: false, error: 'OpenAI Codex CLI executable was not found' })
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/i);
});

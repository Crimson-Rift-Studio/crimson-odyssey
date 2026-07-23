import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFullSetup } from '../src/setup/full.js';
import { loadWorkspaceState } from '../src/core/state.js';
import { loadLoadout } from '../src/loadout/engine.js';
import { tempDir } from './helpers.js';

function fakeIO(overrides = {}) {
  const choices = {
    'Preferred language': 'id',
    'Model provider': 'openai',
    'Credential storage for OpenAI': 'secure',
    'Model': 'gpt-test',
    'Starter Loadout': 'builder',
    'Security profile': 'builder',
    'History retention': '180',
    'Update behavior': 'notify',
    'Messaging gateways': 'none',
    ...(overrides.choices || {})
  };
  return {
    lines: [],
    write(value = '') { this.lines.push(value); },
    async choose(title) { return choices[title]; },
    async confirm(title, fallback) { return overrides.confirms?.[title] ?? fallback; },
    async ask(title, fallback = '') { return overrides.answers?.[title] ?? fallback; },
    async secret() { return 'test-secret-value'; },
    close() {}
  };
}

test('full setup configures the agent without creating an env file', async () => {
  const tmp = tempDir();
  try {
    const result = await runFullSetup({
      workspace: tmp.dir,
      io: fakeIO(),
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: () => 'vault:openai-api-key',
      doctorImpl: async () => ({ ok: true, status: 'healthy', counts: { passed: 10, warnings: 0, failed: 0 } })
    });
    assert.equal(result.ok, true);
    const state = loadWorkspaceState(tmp.dir);
    assert.equal(state.config.schemaVersion, 3);
    assert.equal(state.config.setup.completed, true);
    assert.equal(state.config.setup.version, '0.3.0');
    assert.equal(state.config.history.retentionDays, 180);
    assert.equal(state.config.updates.mode, 'notify');
    assert.equal(state.identity.language, 'id');
    assert.equal(state.config.security.allowShell, true);
    assert.equal(state.model.secretRef, 'vault:openai-api-key');
    assert.equal(existsSync(join(tmp.dir, '.env')), false);
    assert.equal(readFileSync(state.paths.config, 'utf8').includes('test-secret-value'), false);
    const loadout = loadLoadout(state.paths, 'default');
    assert.deepEqual(loadout.slots.weapon, ['software-engineer']);
    assert.deepEqual(loadout.slots.armor, ['production-guard']);
  } finally { tmp.cleanup(); }
});

test('setup can reference an environment variable without writing its value', async () => {
  const tmp = tempDir();
  try {
    await runFullSetup({
      workspace: tmp.dir,
      io: fakeIO({
        choices: { 'Credential storage for OpenAI': 'env', 'Starter Loadout': 'minimal' },
        answers: { 'Environment variable': 'MY_OPENAI_KEY' }
      }),
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    const state = loadWorkspaceState(tmp.dir);
    assert.equal(state.model.secretRef, 'env:MY_OPENAI_KEY');
    assert.equal(state.config.providers.openai.secretRef, 'env:MY_OPENAI_KEY');
    assert.equal(existsSync(join(tmp.dir, '.env')), false);
  } finally { tmp.cleanup(); }
});

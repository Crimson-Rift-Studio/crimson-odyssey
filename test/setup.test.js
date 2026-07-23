import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFullSetup } from '../src/setup/full.js';
import { loadWorkspaceState } from '../src/core/state.js';
import { loadLoadout } from '../src/loadout/engine.js';
import { VERSION } from '../src/core/identity.js';
import { tempDir } from './helpers.js';

function fakeIO(overrides = {}) {
  const choices = {
    'Preferred language': 'id',
    'Model provider': 'openai',
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
    choiceLists: {},
    write(value = '') { this.lines.push(value); },
    async choose(title, options) { this.choiceLists[title] = options; return choices[title]; },
    async confirm(title, fallback) { return overrides.confirms?.[title] ?? fallback; },
    async ask(title, fallback = '') { return overrides.answers?.[title] ?? fallback; },
    async secret(title) { return overrides.secrets?.[title] ?? 'test-secret-value'; },
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
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy', counts: { passed: 10, warnings: 0, failed: 0 } })
    });
    assert.equal(result.ok, true);
    const state = loadWorkspaceState(tmp.dir);
    assert.equal(state.config.schemaVersion, 3);
    assert.equal(state.config.setup.completed, true);
    assert.equal(state.config.setup.version, VERSION);
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

test('setup keeps an existing environment credential and does not ask for a new key', async () => {
  const tmp = tempDir();
  process.env.OPENAI_API_KEY = 'existing-key';
  try {
    let secretCalls = 0;
    await runFullSetup({
      workspace: tmp.dir,
      io: { ...fakeIO(), async ask(title, fallback = '') { if (title.includes('[K]eep')) return 'K'; return fallback; }, async secret() { secretCalls += 1; return 'unused'; } },
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    const state = loadWorkspaceState(tmp.dir);
    assert.equal(state.model.secretRef, 'env:OPENAI_API_KEY');
    assert.equal(secretCalls, 0);
    assert.equal(existsSync(join(tmp.dir, '.env')), false);
  } finally { delete process.env.OPENAI_API_KEY; tmp.cleanup(); }
});

test('setup replaces an existing credential when requested', async () => {
  const tmp = tempDir();
  process.env.OPENAI_API_KEY = 'existing-key';
  try {
    let stored = null;
    await runFullSetup({
      workspace: tmp.dir,
      io: {
        ...fakeIO(),
        async ask(title, fallback = '') { return title.includes('[K]eep') ? 'R' : fallback; },
        async secret() { return 'replacement-key'; }
      },
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: (_name, value) => { stored = value; return 'vault:openai-api-key'; },
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    assert.equal(stored, 'replacement-key');
    assert.equal(loadWorkspaceState(tmp.dir).model.secretRef, 'vault:openai-api-key');
  } finally { delete process.env.OPENAI_API_KEY; tmp.cleanup(); }
});

test('credential keep or replace rejects invalid input and reprompts', async () => {
  const tmp = tempDir();
  process.env.OPENAI_API_KEY = 'existing-key';
  try {
    const answers = ['invalid', 'R'];
    let prompts = 0;
    let stored = null;
    await runFullSetup({
      workspace: tmp.dir,
      io: {
        ...fakeIO(),
        async ask(title, fallback = '') {
          if (title.includes('Credential exists')) {
            prompts += 1;
            return answers.shift();
          }
          return fallback;
        },
        async secret() { return 'replacement-key'; }
      },
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: (_name, value) => { stored = value; return 'vault:openai-api-key'; },
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    assert.equal(prompts, 2);
    assert.equal(stored, 'replacement-key');
  } finally { delete process.env.OPENAI_API_KEY; tmp.cleanup(); }
});

test('auto setup detects installed agents and prioritizes usable CLI providers', async () => {
  const tmp = tempDir();
  try {
    const io = fakeIO({ choices: { 'Model provider': 'codex-cli', 'Model': 'default' } });
    const result = await runFullSetup({
      workspace: tmp.dir,
      io,
      autoDetect: true,
      detectImpl: () => ({ agents: [{ id: 'codex-cli', name: 'OpenAI Codex CLI', command: 'codex', executable: 'C:\\tools\\codex.exe', provider: 'codex-cli', usable: true }], unusable: [], credentials: [] }),
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'default', tags: [], source: 'suggested' }] }),
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    assert.equal(result.model.provider, 'codex-cli');
    assert.equal(result.model.executable, 'C:\\tools\\codex.exe');
    assert.equal(loadWorkspaceState(tmp.dir).config.providers['codex-cli'].executable, 'C:\\tools\\codex.exe');
    assert.equal(io.lines.some((line) => line.includes('Detected agent: OpenAI Codex CLI')), true);
    assert.equal(io.choiceLists['Model provider'][0].label.includes('[CLI found]'), true);
  } finally { tmp.cleanup(); }
});

test('unavailable CLI is reported separately and is not marked ready', async () => {
  const tmp = tempDir();
  try {
    const io = fakeIO();
    await runFullSetup({
      workspace: tmp.dir,
      io,
      autoDetect: true,
      detectImpl: () => ({
        agents: [],
        unusable: [{ id: 'codex-cli', name: 'OpenAI Codex CLI', command: 'C:\\broken\\codex.cmd', provider: 'codex-cli', error: 'version check failed' }],
        credentials: []
      }),
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: () => 'vault:openai-api-key',
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    const codex = io.choiceLists['Model provider'].find((item) => item.value === 'codex-cli');
    assert.match(codex.label, /\[not configured\]/);
    assert.equal(codex.label.includes('[ready]'), false);
    assert.equal(io.lines.some((line) => line.startsWith('Unusable agent: OpenAI Codex CLI')), true);
  } finally { tmp.cleanup(); }
});

test('setup can keep the current model explicitly', async () => {
  const tmp = tempDir();
  process.env.OPENAI_API_KEY = 'existing-key';
  try {
    const state = loadWorkspaceState(tmp.dir);
    const { writeJSON } = await import('../src/core/fs.js');
    writeJSON(state.paths.model, { provider: 'openai', model: 'gpt-current', secretRef: 'env:OPENAI_API_KEY' });
    const io = fakeIO({ choices: { Model: '__current__' } });
    const result = await runFullSetup({
      workspace: tmp.dir,
      io,
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-live', tags: [], source: 'live' }] }),
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    assert.equal(result.model.model, 'gpt-current');
    assert.match(io.choiceLists.Model[0].label, /Keep current model/);
  } finally { delete process.env.OPENAI_API_KEY; tmp.cleanup(); }
});

test('setup offers manual model input when live fetch fails', async () => {
  const tmp = tempDir();
  try {
    const io = fakeIO({
      choices: { Model: '__manual__' },
      answers: { 'Exact model ID': 'provider/model-exact' }
    });
    const result = await runFullSetup({
      workspace: tmp.dir,
      io,
      askLaunch: false,
      fetchModelsImpl: async () => { throw new Error('model endpoint unavailable'); },
      setSecretImpl: () => 'vault:openai-api-key',
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    assert.equal(result.model.model, 'provider/model-exact');
    assert.equal(io.lines.some((line) => line.includes('model endpoint unavailable')), true);
  } finally { tmp.cleanup(); }
});

test('real provider doctor allows manual model fallback with a warning', async () => {
  const tmp = tempDir();
  process.env.OPENAI_API_KEY = 'existing-key';
  try {
    const io = fakeIO({
      choices: { Model: '__manual__' },
      answers: { 'Exact model ID': 'provider/model-exact' }
    });
    const result = await runFullSetup({
      workspace: tmp.dir,
      io,
      askLaunch: false,
      fetchModelsImpl: async () => { throw new Error('model endpoint unavailable'); },
      doctorImpl: async () => ({ ok: true, status: 'warning' })
    });
    assert.equal(result.ok, true);
    assert.equal(result.model.model, 'provider/model-exact');
    assert.equal(result.providerCheck.warnings.some((item) => item.includes('model endpoint unavailable')), true);
  } finally { delete process.env.OPENAI_API_KEY; tmp.cleanup(); }
});

test('configured Telegram can be kept without asking for credentials again', async () => {
  const tmp = tempDir();
  try {
    const state = loadWorkspaceState(tmp.dir);
    const existing = {
      id: 'telegram',
      type: 'telegram',
      name: 'Existing bot',
      secretRef: 'vault:telegram-bot-token',
      ownerUid: '42',
      enabled: true,
      binding: { status: 'bound' }
    };
    const { saveGatewayConfig } = await import('../src/gateway/common.js');
    saveGatewayConfig(state.paths, existing);
    let secretCalls = 0;
    const io = fakeIO({
      choices: { 'Messaging gateways': 'telegram' },
      answers: { 'Telegram is already configured. [K]eep or [R]econfigure': 'K' }
    });
    io.secret = async () => { secretCalls += 1; return 'unused'; };
    const result = await runFullSetup({
      workspace: tmp.dir,
      io,
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: () => 'vault:openai-api-key',
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorGatewayImpl: async () => ({ ok: true }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    assert.equal(secretCalls, 1);
    assert.equal(result.gateways[0].name, 'Existing bot');
  } finally { tmp.cleanup(); }
});

test('configured Discord can be reconfigured with validated owner and server IDs', async () => {
  const tmp = tempDir();
  try {
    const state = loadWorkspaceState(tmp.dir);
    const { saveGatewayConfig, loadGatewayConfig } = await import('../src/gateway/common.js');
    saveGatewayConfig(state.paths, {
      id: 'discord',
      type: 'discord',
      name: 'Old bot',
      secretRef: 'vault:discord-bot-token',
      ownerUid: '42',
      serverId: '100',
      binding: { status: 'bound' }
    });
    const io = fakeIO({
      choices: { 'Messaging gateways': 'discord' },
      answers: {
        'Discord is already configured. [K]eep or [R]econfigure': 'R',
        'Gateway ID': 'discord',
        'Owner UID': '77',
        'Discord server ID, optional': '200',
        'Display name': 'New bot'
      },
      secrets: { 'discord bot token': 'new-token' }
    });
    await runFullSetup({
      workspace: tmp.dir,
      io,
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: (name) => `vault:${name}`,
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorGatewayImpl: async () => ({ ok: true }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    const configured = loadGatewayConfig(loadWorkspaceState(tmp.dir).paths, 'discord');
    assert.equal(configured.ownerUid, '77');
    assert.equal(configured.serverId, '200');
    assert.equal(configured.name, 'New bot');
  } finally { tmp.cleanup(); }
});

test('channel reconfiguration keeps the existing gateway ID and reprompts invalid action', async () => {
  const tmp = tempDir();
  try {
    const state = loadWorkspaceState(tmp.dir);
    const { saveGatewayConfig, loadGatewayConfig } = await import('../src/gateway/common.js');
    saveGatewayConfig(state.paths, {
      id: 'telegram-main',
      type: 'telegram',
      name: 'Old bot',
      secretRef: 'vault:telegram-bot-token',
      ownerUid: '42',
      binding: { status: 'bound' }
    });
    const actions = ['invalid', 'R'];
    let actionPrompts = 0;
    const io = fakeIO({ choices: { 'Messaging gateways': 'telegram' } });
    io.ask = async (title, fallback = '') => {
      if (title.includes('already configured')) {
        actionPrompts += 1;
        return actions.shift();
      }
      if (title === 'Gateway ID') return 'renamed-gateway';
      if (title === 'Owner UID') return '77';
      if (title === 'Display name') return 'New bot';
      return fallback;
    };
    await runFullSetup({
      workspace: tmp.dir,
      io,
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: (name) => `vault:${name}`,
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorGatewayImpl: async () => ({ ok: true }),
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    assert.equal(actionPrompts, 2);
    assert.equal(loadGatewayConfig(loadWorkspaceState(tmp.dir).paths, 'telegram-main').ownerUid, '77');
    assert.equal(loadGatewayConfig(loadWorkspaceState(tmp.dir).paths, 'renamed-gateway'), null);
  } finally { tmp.cleanup(); }
});

test('selected gateway runs doctor and prints an actionable warning on failure', async () => {
  const tmp = tempDir();
  try {
    const io = fakeIO({
      choices: { 'Messaging gateways': 'telegram' },
      answers: {
        'Gateway ID': 'telegram',
        'Owner UID': '42',
        'Display name': 'Telegram bot'
      }
    });
    let doctorCalls = 0;
    const result = await runFullSetup({
      workspace: tmp.dir,
      io,
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: (name) => `vault:${name}`,
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorGatewayImpl: async () => {
        doctorCalls += 1;
        return { ok: false, error: 'Telegram token was rejected; verify the BotFather token' };
      },
      doctorImpl: async () => ({ ok: true, status: 'healthy' })
    });
    assert.equal(doctorCalls, 1);
    assert.equal(result.gatewayChecks[0].ok, false);
    assert.equal(io.lines.some((line) => line.includes('verify the BotFather token')), true);
  } finally { tmp.cleanup(); }
});

test('setup does not complete when the selected provider is unusable', async () => {
  const tmp = tempDir();
  try {
    const result = await runFullSetup({
      workspace: tmp.dir,
      io: fakeIO(),
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: () => 'vault:openai-api-key',
      providerDoctorImpl: async () => ({ ok: false, error: 'provider authentication failed', warnings: [] }),
      doctorImpl: async () => ({ ok: true, status: 'warning' })
    });
    assert.equal(result.ok, false);
    assert.equal(result.launchTui, false);
    assert.equal(loadWorkspaceState(tmp.dir).config.setup.completed, false);
  } finally { tmp.cleanup(); }
});

test('setup remains incomplete when the workspace doctor throws', async () => {
  const tmp = tempDir();
  try {
    await assert.rejects(runFullSetup({
      workspace: tmp.dir,
      io: fakeIO(),
      askLaunch: false,
      fetchModelsImpl: async () => ({ models: [{ id: 'gpt-test', tags: [], source: 'suggested' }] }),
      setSecretImpl: () => 'vault:openai-api-key',
      providerDoctorImpl: async () => ({ ok: true, warnings: [] }),
      doctorImpl: async () => { throw new Error('doctor crashed'); }
    }), /doctor crashed/);
    assert.equal(loadWorkspaceState(tmp.dir).config.setup.completed, false);
  } finally { tmp.cleanup(); }
});

test('rerunning setup marks a previously completed workspace incomplete before prompting', async () => {
  const tmp = tempDir();
  try {
    const state = loadWorkspaceState(tmp.dir);
    const { writeJSON } = await import('../src/core/fs.js');
    state.config.setup = { completed: true, version: VERSION, completedAt: new Date().toISOString() };
    writeJSON(state.paths.config, state.config);
    const io = fakeIO();
    io.choose = async () => { throw new Error('prompt aborted'); };
    await assert.rejects(runFullSetup({ workspace: tmp.dir, io, askLaunch: false }), /prompt aborted/);
    assert.equal(loadWorkspaceState(tmp.dir).config.setup.completed, false);
  } finally { tmp.cleanup(); }
});

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PROVIDERS, fetchModels } from '../providers/catalog.js';
import { setSecret } from '../core/secrets.js';
import { readSecret } from '../core/terminal.js';
import { loadWorkspaceState, readYamlFile, updateYamlFile } from '../core/state.js';
import { readJSON, writeJSON } from '../core/fs.js';
import { saveLoadout } from '../loadout/engine.js';
import { saveGatewayConfig, beginPairing } from '../gateway/common.js';
import { runDoctor } from '../doctor.js';
import { VERSION } from '../core/identity.js';

export const STARTER_LOADOUTS = {
  balanced: { weapon: ['crimson-core'], armor: ['production-guard'], accessory: ['natural-writing', 'deep-research'], magic: ['business-strategist', 'creative-director'] },
  builder: { weapon: ['software-engineer'], armor: ['production-guard'], accessory: ['deep-research', 'natural-writing'], magic: ['business-strategist', 'creative-director'] },
  creative: { weapon: ['creative-director'], armor: ['production-guard'], accessory: ['natural-writing', 'business-strategist'], magic: ['deep-research', 'software-engineer'] },
  minimal: { weapon: ['crimson-core'], armor: ['production-guard'], accessory: ['natural-writing'], magic: [] }
};

export function consoleIO() {
  let rl = stdin.isTTY ? readline.createInterface({ input: stdin, output: stdout }) : null;
  let linesPromise = null;
  const reader = () => {
    if (!rl) rl = readline.createInterface({ input: stdin, output: stdout });
    return rl;
  };
  async function lines() {
    if (!linesPromise) linesPromise = (async () => {
      let data = '';
      for await (const chunk of stdin) data += String(chunk);
      return data.split(/\r?\n/);
    })();
    return linesPromise;
  }
  async function question(label, fallback = '') {
    const prompt = `${label}${fallback ? ` [${fallback}]` : ''}: `;
    if (!stdin.isTTY) {
      const values = await lines();
      const raw = values.shift() ?? '';
      stdout.write(`${prompt}${raw}\n`);
      return raw.trim() || fallback;
    }
    const answer = (await reader().question(prompt)).trim();
    return answer || fallback;
  }
  return {
    write(text = '') { stdout.write(`${text}\n`); },
    ask(label, fallback = '') { return question(label, fallback); },
    async confirm(label, fallback = true) {
      const answer = (await question(`${label} (${fallback ? 'Y/n' : 'y/N'})`)).toLowerCase();
      return answer ? ['y', 'yes', 'ya', 'iya', '1'].includes(answer) : fallback;
    },
    async choose(title, choices, fallback = choices[0]?.value) {
      stdout.write(`\n${title}\n`);
      choices.forEach((choice, index) => stdout.write(`${index + 1}. ${choice.label}\n`));
      const defaultIndex = Math.max(0, choices.findIndex((choice) => choice.value === fallback));
      while (true) {
        const answer = await question('Select', String(defaultIndex + 1));
        const index = Number(answer) - 1;
        if (Number.isInteger(index) && choices[index]) return choices[index].value;
        stdout.write('Invalid selection. Try again.\n');
      }
    },
    async secret(label) {
      if (!stdin.isTTY) return question(label);
      reader().close();
      rl = null;
      return readSecret(`${label}: `);
    },
    close() { try { rl?.close(); } catch { /* closed */ } rl = null; }
  };
}

async function credential(io, provider, name, setSecretImpl) {
  if (!provider.secretEnv) return null;
  const mode = await io.choose(`Credential storage for ${provider.name}`, [
    { label: 'Secure storage, recommended', value: 'secure' },
    { label: 'Use an existing environment variable', value: 'env' },
    { label: 'Skip for now', value: 'skip' }
  ], 'secure');
  if (mode === 'env') return `env:${await io.ask('Environment variable', provider.secretEnv)}`;
  if (mode === 'skip') return null;
  const value = await io.secret(`API key for ${provider.name}`);
  return value ? setSecretImpl(name, value) : null;
}

async function configureModel(state, io, { fetchModelsImpl, setSecretImpl }) {
  const providerId = await io.choose('Model provider', PROVIDERS.map((item) => ({ label: item.name, value: item.id })), state.model.provider || 'openai');
  const provider = PROVIDERS.find((item) => item.id === providerId);
  const config = readJSON(state.paths.config, state.config);
  config.providers ||= {};
  config.providers[providerId] ||= {};
  if (providerId === 'custom') config.providers.custom.baseUrl = await io.ask('Custom base URL', config.providers.custom.baseUrl || 'http://127.0.0.1:8000/v1');
  const secretRef = await credential(io, provider, `${providerId}-api-key`, setSecretImpl);
  if (secretRef) config.providers[providerId].secretRef = secretRef;
  writeJSON(state.paths.config, config);
  const catalog = await fetchModelsImpl(providerId, config, { paths: state.paths, refresh: true });
  const choices = catalog.models.map((entry) => ({ label: entry.id, value: entry.id }));
  choices.push({ label: 'Enter exact model ID', value: '__manual__' });
  const picked = await io.choose('Model', choices, state.model.provider === providerId ? state.model.model : choices[0]?.value);
  const model = picked === '__manual__' ? await io.ask('Exact model ID') : picked;
  if (!model) throw new Error('Model ID is required');
  const selected = { provider: providerId, model, custom: picked === '__manual__', baseUrl: config.providers[providerId]?.baseUrl || provider.baseUrl || null, secretRef: config.providers[providerId]?.secretRef || null, updatedAt: new Date().toISOString() };
  writeJSON(state.paths.model, selected);
  return selected;
}

function profile(state, identityPatch, soulPatch) {
  updateYamlFile(state.paths.identity, { ...readYamlFile(state.paths.identity, state.identity), ...identityPatch }, state.paths.revisions);
  if (soulPatch) updateYamlFile(state.paths.soul, { ...readYamlFile(state.paths.soul, state.soul), ...soulPatch }, state.paths.revisions);
}

function applyOperationalSettings(state, { preset, security, retentionDays, updateMode }) {
  saveLoadout(state.paths, { version: 2, name: 'default', slots: STARTER_LOADOUTS[preset], updatedAt: new Date().toISOString() });
  const agent = readYamlFile(state.paths.agent, state.agent);
  agent.act_mode = security === 'autonomous' ? 'always' : 'ask';
  updateYamlFile(state.paths.agent, agent, state.paths.revisions);
  const config = readJSON(state.paths.config, state.config);
  config.security ||= {};
  config.security.allowShell = security !== 'safe';
  config.security.ownerOnly = true;
  config.security.redactLogs = true;
  config.history = { ...(config.history || {}), retentionDays };
  config.updates = { ...(config.updates || {}), mode: updateMode, channel: 'stable', intervalHours: 24, repository: 'aabrur/crimson-odyssey', branch: 'main' };
  writeJSON(state.paths.config, config);
}

async function gateway(state, io, type, setSecretImpl) {
  const id = await io.ask('Gateway ID', type);
  const token = await io.secret(`${type} bot token`);
  if (!token) return null;
  const ownerUid = await io.ask('Owner UID');
  if (!ownerUid) throw new Error('Owner UID is required');
  const serverId = type === 'discord' ? await io.ask('Discord server ID, optional') : '';
  const config = { id, type, name: await io.ask('Display name', type), secretRef: setSecretImpl(`${id}-bot-token`, token), ownerUid, serverId: serverId || null, ownerOnly: true, enabled: true, createdAt: new Date().toISOString(), binding: { status: 'unbound' } };
  saveGatewayConfig(state.paths, config);
  const code = beginPairing(state.paths, config);
  io.write(`Start with crimson gateway start ${id}, then send /bind ${code} from owner UID ${ownerUid}.`);
  return config;
}

export async function runFullSetup({ workspace = process.cwd(), io = consoleIO(), fetchModelsImpl = fetchModels, setSecretImpl = setSecret, doctorImpl = runDoctor, askLaunch = true } = {}) {
  let state = loadWorkspaceState(workspace);
  io.write('CRIMSON ODYSSEY FULL SETUP');
  io.write('No manual .env, JSON, or YAML editing is required.');
  try {
    const language = await io.choose('Preferred language', [
      { label: 'Auto detect', value: 'auto' },
      { label: 'Bahasa Indonesia', value: 'id' },
      { label: 'English', value: 'en' }
    ], state.identity.language || 'auto');
    const identityPatch = { language };
    if (await io.confirm('Customize Identity?', false)) {
      identityPatch.name = await io.ask('Agent name', state.identity.name);
      identityPatch.role = await io.ask('Agent role', state.identity.role);
      identityPatch.voice = await io.ask('Agent voice', state.identity.voice);
    }
    let soulPatch = null;
    if (await io.confirm('Customize Soul?', false)) soulPatch = { purpose: await io.ask('Purpose', state.soul.purpose), decision_style: await io.ask('Decision style', state.soul.decision_style), quality_standard: await io.ask('Quality standard', state.soul.quality_standard) };
    profile(state, identityPatch, soulPatch);
    state = loadWorkspaceState(workspace);
    const model = await configureModel(state, io, { fetchModelsImpl, setSecretImpl });
    const preset = await io.choose('Starter Loadout', [
      { label: 'Balanced', value: 'balanced' }, { label: 'Builder', value: 'builder' }, { label: 'Creative', value: 'creative' }, { label: 'Minimal', value: 'minimal' }
    ], 'balanced');
    const security = await io.choose('Security profile', [
      { label: 'Safe, approval-first', value: 'safe' }, { label: 'Builder, shell available', value: 'builder' }, { label: 'Autonomous', value: 'autonomous' }
    ], 'safe');
    const retentionDays = Number(await io.choose('History retention', [
      { label: '30 days', value: '30' }, { label: '90 days', value: '90' }, { label: '180 days', value: '180' }, { label: 'Manual pruning', value: '0' }
    ], String(state.config.history?.retentionDays ?? 90)));
    const updateMode = await io.choose('Update behavior', [
      { label: 'Notify', value: 'notify' }, { label: 'Ask before install', value: 'ask' }, { label: 'Auto install', value: 'auto' }, { label: 'Off', value: 'off' }
    ], state.config.updates?.mode || 'notify');
    applyOperationalSettings(state, { preset, security, retentionDays, updateMode });
    const gatewayMode = await io.choose('Messaging gateways', [
      { label: 'Not now', value: 'none' }, { label: 'Telegram', value: 'telegram' }, { label: 'Discord', value: 'discord' }, { label: 'Both', value: 'both' }
    ], 'none');
    const gateways = [];
    if (['telegram', 'both'].includes(gatewayMode)) gateways.push(await gateway(state, io, 'telegram', setSecretImpl));
    if (['discord', 'both'].includes(gatewayMode)) gateways.push(await gateway(state, io, 'discord', setSecretImpl));
    state = loadWorkspaceState(workspace);
    const config = readJSON(state.paths.config, state.config);
    config.setup = { completed: true, version: VERSION, completedAt: new Date().toISOString() };
    writeJSON(state.paths.config, config);
    const doctor = await doctorImpl({ workspace });
    io.write(`Setup complete. Doctor status: ${doctor.status}.`);
    const launchTui = askLaunch ? await io.confirm('Open Crimson Odyssey now?', true) : false;
    return { ok: doctor.ok, launchTui, model, preset, security, updateMode, gateways: gateways.filter(Boolean), doctor };
  } finally {
    io.close?.();
  }
}

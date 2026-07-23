import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, readdirSync } from 'node:fs';
import { PROVIDERS, fetchModels } from '../providers/catalog.js';
import { setSecret, resolveSecret } from '../core/secrets.js';
import { readSecret } from '../core/terminal.js';
import { loadWorkspaceState, readYamlFile, updateYamlFile } from '../core/state.js';
import { readJSON, writeJSON } from '../core/fs.js';
import { saveLoadout } from '../loadout/engine.js';
import { saveGatewayConfig, beginPairing } from '../gateway/common.js';
import { doctorGateway } from '../gateway/index.js';
import { runDoctor } from '../doctor.js';
import { doctorSelectedProvider } from '../doctor.js';
import { VERSION } from '../core/identity.js';
import { detectInstalledAgents, resolveCliProvider } from './detect.js';

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

async function keepOrReplace(io, prompt) {
  while (true) {
    const action = (await io.ask(prompt, 'K')).trim().toLowerCase();
    if (action === 'k') return 'keep';
    if (action === 'r') return 'replace';
    io.write('Enter K to keep or R to replace.');
  }
}

async function credential(io, provider, name, setSecretImpl, existingRef, resolveSecretImpl) {
  if (!provider.secretEnv) return existingRef || null;
  let available = false;
  try { available = existingRef && Boolean(resolveSecretImpl(existingRef)); } catch { /* unusable reference */ }
  if (available) {
    const action = await keepOrReplace(io, `Credential exists for ${provider.name}. [K]eep or [R]eplace`);
    if (action === 'keep') return existingRef;
  }
  const value = await io.secret(`API key for ${provider.name}`);
  if (!value) throw new Error(`API key is required for ${provider.name}`);
  return setSecretImpl(name, value);
}

function providerMarker(provider, state, config, detected, resolveSecretImpl) {
  const agent = detected?.agents?.find((item) => item.provider === provider.id && item.usable !== false);
  const secretRef = config.providers?.[provider.id]?.secretRef || (provider.secretEnv && process.env[provider.secretEnv] ? `env:${provider.secretEnv}` : null);
  let keyFound = Boolean(detected?.credentials?.some((item) => item.provider === provider.id));
  try { keyFound ||= Boolean(secretRef && resolveSecretImpl(secretRef)); } catch { /* unavailable reference */ }
  const active = state.model.provider === provider.id && Boolean(state.model.model);
  if (active && ((provider.kind === 'cli' && agent) || (provider.kind !== 'cli' && (!provider.secretEnv || keyFound)))) return '[ready]';
  if (agent && provider.kind === 'cli') return '[CLI found]';
  if (keyFound) return '[key found]';
  return '[not configured]';
}

async function configureModel(state, io, {
  fetchModelsImpl,
  setSecretImpl,
  resolveSecretImpl,
  cliResolver,
  detected = null
}) {
  const config = readJSON(state.paths.config, state.config);
  config.providers ||= {};
  const cliProviders = new Set((detected?.agents || []).filter((item) => item.usable !== false).map((item) => item.provider));
  const keyedProviders = new Set((detected?.credentials || []).map((item) => item.provider));
  const score = (provider) => cliProviders.has(provider.id) ? 2 : keyedProviders.has(provider.id) ? 1 : 0;
  const ordered = [...PROVIDERS].sort((a, b) => score(b) - score(a));
  const providerId = await io.choose('Model provider', ordered.map((item) => ({
    label: `${item.name} ${providerMarker(item, state, config, detected, resolveSecretImpl)}`,
    value: item.id
  })), state.model.provider || ordered[0]?.id || 'openai');
  const provider = PROVIDERS.find((item) => item.id === providerId);
  config.providers[providerId] ||= {};
  if (provider.kind === 'cli') {
    const detectedAgent = detected?.agents?.find((item) => item.provider === providerId && item.usable !== false);
    const resolved = detectedAgent || cliResolver(providerId, config);
    if (resolved?.usable !== false && resolved?.executable) config.providers[providerId].executable = resolved.executable;
  }
  if (providerId === 'custom') config.providers.custom.baseUrl = await io.ask('Custom base URL', config.providers.custom.baseUrl || 'http://127.0.0.1:8000/v1');
  const existingRef = config.providers[providerId].secretRef || (provider.secretEnv && process.env[provider.secretEnv] ? `env:${provider.secretEnv}` : null);
  const secretRef = await credential(io, provider, `${providerId}-api-key`, setSecretImpl, existingRef, resolveSecretImpl);
  if (secretRef) config.providers[providerId].secretRef = secretRef;
  writeJSON(state.paths.config, config);
  let catalog;
  try {
    catalog = await fetchModelsImpl(providerId, config, { paths: state.paths, refresh: true });
  } catch (error) {
    catalog = { provider, models: [], fromCache: false, liveAvailable: false, error: error.message || String(error) };
  }
  if (catalog.error) io.write(`Live model fetch failed for ${provider.name}: ${catalog.error}. Using cached or suggested models, or enter an exact model ID.`);
  const choices = catalog.models.map((entry) => ({ label: entry.id, value: entry.id }));
  if (state.model.provider === providerId && state.model.model) choices.unshift({ label: `Keep current model (${state.model.model})`, value: '__current__' });
  choices.push({ label: 'Enter exact model ID', value: '__manual__' });
  const fallback = state.model.provider === providerId && state.model.model ? '__current__' : choices[0]?.value;
  const picked = await io.choose('Model', choices, fallback);
  const model = picked === '__manual__' ? await io.ask('Exact model ID') : picked === '__current__' ? state.model.model : picked;
  if (!model) throw new Error('Model ID is required');
  const selected = {
    provider: providerId,
    model,
    custom: picked === '__manual__',
    baseUrl: config.providers[providerId]?.baseUrl || provider.baseUrl || null,
    secretRef: config.providers[providerId]?.secretRef || null,
    ...(provider.kind === 'cli' && config.providers[providerId]?.executable ? { executable: config.providers[providerId].executable } : {}),
    updatedAt: new Date().toISOString()
  };
  writeJSON(state.paths.model, selected);
  return { selected, catalog };
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

function configuredGateway(paths, type) {
  if (!existsSync(paths.gateways)) return null;
  for (const name of readdirSync(paths.gateways).filter((item) => item.endsWith('.json'))) {
    const config = readJSON(`${paths.gateways}/${name}`, null);
    if (config?.type === type) return config;
  }
  return null;
}

function validateId(value, label, pattern) {
  if (!pattern.test(value)) throw new Error(`${label} is invalid`);
}

async function gateway(state, io, type, setSecretImpl) {
  const title = type === 'telegram' ? 'Telegram' : 'Discord';
  const existing = configuredGateway(state.paths, type);
  if (existing) {
    const action = await keepOrReplace(io, `${title} is already configured. [K]eep or [R]econfigure`);
    if (action === 'keep') return existing;
  }
  const id = existing?.id || await io.ask('Gateway ID', type);
  validateId(id, 'Gateway ID', /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
  const token = await io.secret(`${type} bot token`);
  if (!token) throw new Error('Bot token is required');
  const ownerUid = await io.ask('Owner UID', existing?.ownerUid || '');
  validateId(ownerUid, 'Owner UID', /^\d+$/);
  const serverId = type === 'discord' ? await io.ask('Discord server ID, optional', existing?.serverId || '') : '';
  if (serverId) validateId(serverId, 'Discord server ID', /^\d+$/);
  const config = {
    id,
    type,
    name: await io.ask('Display name', existing?.name || type),
    secretRef: setSecretImpl(`${id}-bot-token`, token),
    ownerUid,
    serverId: serverId || null,
    ownerOnly: true,
    enabled: true,
    createdAt: existing?.createdAt || new Date().toISOString(),
    binding: { status: 'unbound' }
  };
  saveGatewayConfig(state.paths, config);
  const code = beginPairing(state.paths, config);
  io.write(`Start with crimson gateway start ${id}, then send /bind ${code} from owner UID ${ownerUid}.`);
  return config;
}

export async function runFullSetup({
  workspace = process.cwd(),
  io = consoleIO(),
  fetchModelsImpl = fetchModels,
  setSecretImpl = setSecret,
  resolveSecretImpl = resolveSecret,
  providerDoctorImpl = doctorSelectedProvider,
  doctorGatewayImpl = doctorGateway,
  doctorImpl = runDoctor,
  cliResolver = resolveCliProvider,
  askLaunch = true,
  autoDetect = false,
  detectImpl = detectInstalledAgents
} = {}) {
  let state = loadWorkspaceState(workspace);
  const initialConfig = readJSON(state.paths.config, state.config);
  initialConfig.setup = { completed: false, version: null, completedAt: null };
  writeJSON(state.paths.config, initialConfig);
  state = loadWorkspaceState(workspace);
  io.write('CRIMSON ODYSSEY FULL SETUP');
  io.write('No manual .env, JSON, or YAML editing is required.');
  try {
    const detected = autoDetect ? detectImpl() : null;
    if (detected) {
      io.write('AUTO DETECTION');
      if (detected.agents.length) detected.agents.forEach((item) => io.write(`Detected agent: ${item.name} (${item.command})${item.provider ? ' [usable]' : ' [detection only]'}`));
      if (detected.unusable?.length) detected.unusable.forEach((item) => io.write(`Unusable agent: ${item.name} (${item.command}): ${item.error}`));
      if (detected.credentials.length) detected.credentials.forEach((item) => io.write(`Detected credential environment: ${item.envKey}`));
      if (!detected.agents.length && !detected.unusable?.length && !detected.credentials.length) io.write('No supported agents or credential environments were detected.');
    }
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
    const configuredModel = await configureModel(state, io, { fetchModelsImpl, setSecretImpl, resolveSecretImpl, cliResolver, detected });
    const model = configuredModel.selected;
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
    const gatewayChecks = [];
    for (const configured of gateways.filter(Boolean)) {
      let result;
      try { result = await doctorGatewayImpl(state.paths, configured.id); }
      catch (error) { result = { ok: false, error: error.message || String(error) }; }
      gatewayChecks.push({ id: configured.id, ...result });
      if (!result.ok) io.write(`Gateway ${configured.id} warning: ${result.error || 'validation failed'}. Run crimson gateway doctor ${configured.id} after correcting the configuration.`);
    }
    state = loadWorkspaceState(workspace);
    let config = readJSON(state.paths.config, state.config);
    config.setup = { completed: false, version: null, completedAt: null };
    writeJSON(state.paths.config, config);
    const providerCheck = await providerDoctorImpl({ model, config, catalog: configuredModel.catalog });
    for (const warning of providerCheck.warnings || []) io.write(`Provider warning: ${warning}`);
    const doctor = await doctorImpl({ workspace });
    const ok = Boolean(providerCheck.ok && doctor.ok);
    if (ok) {
      config = readJSON(state.paths.config, config);
      config.setup = { completed: true, version: VERSION, completedAt: new Date().toISOString() };
      writeJSON(state.paths.config, config);
    }
    if (ok) io.write(`Setup verified. Doctor status: ${doctor.status}.`);
    else io.write(`Setup verification failed: ${providerCheck.error || `doctor status ${doctor.status}`}.`);
    const launchTui = ok && askLaunch ? await io.confirm('Open Crimson Odyssey now?', true) : false;
    return { ok, launchTui, model, preset, security, updateMode, gateways: gateways.filter(Boolean), gatewayChecks, providerCheck, doctor };
  } finally {
    io.close?.();
  }
}

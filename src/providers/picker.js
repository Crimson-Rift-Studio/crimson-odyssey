import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { PROVIDERS, fetchModels } from './catalog.js';
import { setSecret, resolveSecret } from '../core/secrets.js';
import { readJSON, writeJSON } from '../core/fs.js';
import { readSecret } from '../core/terminal.js';
import { resolveCliProvider } from '../setup/detect.js';
import { doctorSelectedProvider } from '../doctor.js';

export async function promptChoice(title, choices, { allowCustom = false, rl } = {}) {
  const own = !rl;
  const reader = rl || readline.createInterface({ input, output });
  try {
    output.write(`\n${title}\n\n`);
    choices.forEach((choice, index) => output.write(`${index + 1}. ${choice.label}\n`));
    if (allowCustom) output.write('0. Enter custom value\n');
    while (true) {
      const answer = (await reader.question('\nSelect: ')).trim();
      if (allowCustom && answer === '0') {
        const custom = (await reader.question('Custom value: ')).trim();
        if (custom) return { custom: true, value: custom };
      }
      const index = Number(answer) - 1;
      if (Number.isInteger(index) && choices[index]) return { custom: false, value: choices[index].value };
      output.write('Invalid selection. Try again.\n');
    }
  } finally {
    if (own) reader.close();
  }
}

export function prepareModelSelection(providerId, model, config, {
  custom = false,
  cliResolver = resolveCliProvider
} = {}) {
  const provider = PROVIDERS.find((item) => item.id === providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  if (!model?.trim()) throw new Error('Model ID is required');
  config.providers ||= {};
  config.providers[providerId] ||= {};
  if (provider.kind === 'cli') {
    const resolved = cliResolver(providerId, config);
    if (!resolved.usable || !resolved.executable) throw new Error(resolved.error || `${provider.name} executable is unavailable`);
    config.providers[providerId].executable = resolved.executable;
  }
  return {
    provider: providerId,
    model,
    custom,
    baseUrl: config.providers[providerId]?.baseUrl || provider.baseUrl || null,
    secretRef: config.providers[providerId]?.secretRef || (provider.secretEnv ? `env:${provider.secretEnv}` : null),
    ...(provider.kind === 'cli' ? { executable: config.providers[providerId].executable } : {}),
    updatedAt: new Date().toISOString()
  };
}

function credentialAvailable(ref) {
  try { return Boolean(ref && resolveSecret(ref)); } catch { return false; }
}

function providerStatus(provider, state, config, cliResolver) {
  if (provider.kind === 'cli') {
    const resolved = cliResolver(provider.id, config);
    if (resolved.usable) return state.model.provider === provider.id && state.model.model ? '[ready]' : '[CLI found]';
    return '[not configured]';
  }
  const secretRef = config.providers?.[provider.id]?.secretRef || (provider.secretEnv && process.env[provider.secretEnv] ? `env:${provider.secretEnv}` : null);
  const keyFound = credentialAvailable(secretRef);
  if (state.model.provider === provider.id && state.model.model && (!provider.secretEnv || keyFound)) return '[ready]';
  if (keyFound) return '[key found]';
  return '[not configured]';
}

export async function runModelSetup(state, {
  refresh = true,
  fetchModelsImpl = fetchModels,
  setSecretImpl = setSecret,
  cliResolver = resolveCliProvider,
  providerDoctorImpl = doctorSelectedProvider
} = {}) {
  let providerId;
  let config;
  let provider;
  let replaceCredential = false;

  const providerReader = readline.createInterface({ input, output });
  try {
    const providerPick = await promptChoice('Select provider', PROVIDERS.map((item) => ({
      label: `${item.name} ${providerStatus(item, state, readJSON(state.paths.config, state.config), cliResolver)}`,
      value: item.id
    })), { rl: providerReader });
    providerId = providerPick.value;
    provider = PROVIDERS.find((item) => item.id === providerId);
    config = readJSON(state.paths.config, state.config);
    config.providers ||= {};
    config.providers[provider.id] ||= {};
    if (provider.id === 'custom') {
      config.providers.custom.baseUrl = (await providerReader.question('Base URL, including /v1 when required: ')).trim();
    }
    const existingRef = config.providers[provider.id].secretRef || (provider.secretEnv && process.env[provider.secretEnv] ? `env:${provider.secretEnv}` : null);
    if (provider.secretEnv && credentialAvailable(existingRef)) {
      let action;
      while (!['', 'k', 'r'].includes(action)) {
        action = (await providerReader.question(`Credential exists for ${provider.name}. [K]eep or [R]eplace [K]: `)).trim().toLowerCase();
        if (!['', 'k', 'r'].includes(action)) output.write('Enter K to keep or R to replace.\n');
      }
      replaceCredential = action === 'r';
      if (!replaceCredential) config.providers[provider.id].secretRef = existingRef;
    } else {
      replaceCredential = Boolean(provider.secretEnv);
    }
  } finally {
    providerReader.close();
  }

  if (replaceCredential) {
    const value = await readSecret(`API key for ${provider.name}: `);
    if (!value) throw new Error(`API key is required for ${provider.name}`);
    config.providers[provider.id].secretRef = setSecretImpl(`${provider.id}-api-key`, value);
  }

  const catalog = await fetchModelsImpl(provider.id, config, { paths: state.paths, refresh });
  if (catalog.error) output.write(`\nLive model fetch failed: ${catalog.error}. Using cached or suggested models, or enter an exact model ID.\n`);
  const choices = catalog.models.map((entry) => ({
    label: `${entry.id}${entry.tags.length ? ` [${entry.tags.join(', ')}]` : ''}${entry.source === 'live' ? ' [live]' : ''}`,
    value: entry.id
  }));
  if (state.model.provider === provider.id && state.model.model) choices.unshift({ label: `Keep current model (${state.model.model})`, value: state.model.model });
  if (!choices.length) output.write('\nNo models were returned. Enter a model ID manually.\n');

  const modelReader = readline.createInterface({ input, output });
  try {
    const modelPick = await promptChoice(`Select ${provider.name} model`, choices, { allowCustom: true, rl: modelReader });
    const selected = prepareModelSelection(provider.id, modelPick.value, config, { custom: modelPick.custom, cliResolver });
    const providerCheck = await providerDoctorImpl({ model: selected, config, catalog });
    if (!providerCheck.ok) throw new Error(providerCheck.error || `${provider.name} is unavailable`);
    writeJSON(state.paths.config, config);
    writeJSON(state.paths.model, selected);
    output.write(`\nActive model: ${provider.name} / ${selected.model}\n`);
    return selected;
  } finally {
    modelReader.close();
  }
}

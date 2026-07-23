import { join } from 'node:path';
import { readJSON, writeJSON } from '../core/fs.js';
import { resolveSecret } from '../core/secrets.js';

export const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI direct API',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelsPath: '/models',
    secretEnv: 'OPENAI_API_KEY',
    suggested: ['gpt-5.2', 'gpt-5.1', 'gpt-5-mini']
  },
  {
    id: 'anthropic',
    name: 'Anthropic direct API',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    modelsPath: '/v1/models',
    secretEnv: 'ANTHROPIC_API_KEY',
    suggested: ['claude-opus-4-1', 'claude-sonnet-4', 'claude-haiku-4-5']
  },
  {
    id: 'gemini',
    name: 'Google Gemini direct API',
    kind: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsPath: '/models',
    secretEnv: 'GEMINI_API_KEY',
    suggested: ['gemini-3.6-flash', 'gemini-3.5-flash']
  },
  {
    id: 'xai',
    name: 'xAI',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    modelsPath: '/models',
    secretEnv: 'XAI_API_KEY',
    suggested: []
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsPath: '/models',
    secretEnv: 'MISTRAL_API_KEY',
    suggested: ['mistral-large-latest', 'mistral-small-latest']
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsPath: '/models',
    secretEnv: 'GROQ_API_KEY',
    suggested: []
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsPath: '/models',
    secretEnv: 'OPENROUTER_API_KEY',
    suggested: []
  },
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    modelsPath: '/api/tags',
    secretEnv: null,
    suggested: []
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelsPath: '/models',
    secretEnv: null,
    suggested: []
  },
  {
    id: 'codex-cli',
    name: 'OpenAI Codex CLI',
    kind: 'cli',
    command: 'codex',
    suggested: ['default', 'gpt-5.2-codex']
  },
  {
    id: 'claude-cli',
    name: 'Claude Code CLI',
    kind: 'cli',
    command: 'claude',
    suggested: ['default', 'sonnet', 'opus']
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    kind: 'cli',
    command: 'gemini',
    suggested: ['default']
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible endpoint',
    kind: 'openai',
    baseUrl: null,
    modelsPath: '/models',
    secretEnv: 'CRIMSON_CUSTOM_API_KEY',
    suggested: []
  }
];

export function getProvider(id) {
  const provider = PROVIDERS.find((item) => item.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function classifyModel(id, providerId) {
  const model = String(id || '').toLowerCase();
  const tags = [];
  if (providerId === 'ollama' || providerId === 'lmstudio' || model.endsWith(':free') || model.includes('/free')) tags.push('free');
  if (/opus|pro|max|large|405b|reason|gpt-5\.2|gpt-5\.1/.test(model)) tags.push('top');
  if (/code|coder|codex/.test(model)) tags.push('coding');
  if (/vision|vl|pixtral|image/.test(model)) tags.push('vision');
  if (/mini|small|flash|haiku|8b|instant/.test(model)) tags.push('fast');
  return tags;
}

function normalizeLiveModels(provider, payload) {
  if (provider.kind === 'ollama') {
    return (payload?.models || []).map((entry) => entry?.name).filter(Boolean);
  }
  const source = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return source.map((entry) => entry?.id || entry?.name).filter((value) => typeof value === 'string');
}

export async function fetchModels(providerId, config, { paths, refresh = false, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const provider = getProvider(providerId);
  const providerConfig = config?.providers?.[providerId] || {};
  const cacheFile = paths ? join(paths.cache, `models-${providerId}.json`) : null;
  const ttl = (config?.models?.cacheTtlHours ?? 24) * 3600 * 1000;
  const cached = cacheFile ? readJSON(cacheFile, null) : null;
  if (!refresh && cacheFile) {
    if (cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < ttl && Array.isArray(cached.models)) {
      return buildCatalog(provider, cached.models, true, cached.fetchedAt);
    }
  }

  const baseUrl = providerConfig.baseUrl || provider.baseUrl;
  if (provider.kind === 'cli') return buildCatalog(provider, [], false, null);
  if (!baseUrl) return buildCatalog(provider, [], false, null, `No base URL is configured for ${provider.name}`);
  const secretRef = providerConfig.secretRef || (provider.secretEnv ? `env:${provider.secretEnv}` : null);
  const key = resolveSecret(secretRef);
  if (provider.secretEnv && !key && !['ollama', 'lmstudio'].includes(providerId)) {
    return buildCatalog(provider, [], false, null, `No credential is available for ${provider.name}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json' };
    if (providerId === 'anthropic') {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (key) {
      headers.authorization = `Bearer ${key}`;
    }
    const url = `${baseUrl.replace(/\/$/, '')}${provider.modelsPath}`;
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const models = normalizeLiveModels(provider, payload);
    const fetchedAt = new Date().toISOString();
    if (cacheFile) writeJSON(cacheFile, { provider: providerId, fetchedAt, models });
    return buildCatalog(provider, models, false, fetchedAt);
  } catch (error) {
    const fallback = Array.isArray(cached?.models) ? cached.models : [];
    return buildCatalog(provider, fallback, fallback.length > 0, cached?.fetchedAt || null, error.message || String(error));
  } finally {
    clearTimeout(timer);
  }
}

function buildCatalog(provider, live, fromCache, fetchedAt, error = null) {
  const merged = [...new Set([...(provider.suggested || []), ...live])];
  return {
    provider,
    models: merged.map((id) => ({ id, tags: classifyModel(id, provider.id), source: live.includes(id) ? 'live' : 'suggested' })),
    fromCache,
    fetchedAt,
    liveAvailable: live.length > 0,
    error
  };
}

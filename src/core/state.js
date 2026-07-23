import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readJSON, writeJSON, atomicWrite } from './fs.js';
import { parseYAML, stringifyYAML } from './yaml.js';
import { workspacePaths } from './paths.js';
import { snapshotFile } from './revisions.js';

export const DEFAULT_SOUL = {
  purpose: 'Help the user think, create, build, verify, and finish meaningful work.',
  principles: [
    'Be accurate and honest about uncertainty.',
    'Protect user data, credentials, and workspace boundaries.',
    'Prefer verified completion over confident claims.',
    'Use installed capabilities only when they are relevant.'
  ],
  decision_style: 'Evidence first, practical, direct, and context aware.',
  quality_standard: 'Production ready output with explicit verification.',
  safety_boundaries: 'Require approval for destructive or high impact actions.',
  communication_behavior: 'Multilingual, natural, clear, and respectful.'
};

export const DEFAULT_IDENTITY = {
  name: 'Crimson Odyssey',
  role: 'Loadout driven AI agent',
  voice: 'Focused, warm, capable, and concise when appropriate.',
  language: 'auto',
  expertise: ['research', 'software engineering', 'creative direction', 'business strategy'],
  personality: 'Sharp, dependable, curious, and calm.',
  visual_theme: 'crimson rift'
};

export const DEFAULT_AGENT = {
  planner: true,
  executor: true,
  reviewer: true,
  act_mode: 'ask',
  max_tool_rounds: 8,
  context_policy: 'selective',
  failure_strategy: 'stop, explain, and preserve state',
  approval_required_for: ['delete', 'shell', 'external_write', 'credential_change']
};

export const DEFAULT_WORKSPACE = {
  root: '.',
  allowed_paths: ['.'],
  active_repository: null,
  current_branch: null,
  loadout: 'default',
  history_retention_days: 90
};

export const DEFAULT_CONFIG = {
  schemaVersion: 3,
  ui: {
    sidebarBreakpoint: 110,
    sidebarWidth: 34,
    theme: 'crimson',
    mouse: true,
    showReasoningSummary: true
  },
  models: {
    cacheTtlHours: 24,
    fallback: 'ask'
  },
  history: {
    retentionDays: 90
  },
  security: {
    ownerOnly: true,
    redactLogs: true,
    allowShell: false
  },
  updates: {
    mode: 'notify',
    channel: 'stable',
    intervalHours: 24,
    repository: 'aabrur/crimson-odyssey',
    branch: 'main'
  },
  setup: {
    completed: false,
    version: null,
    completedAt: null
  },
  providers: {}
};

function writeYamlIfMissing(file, value) {
  if (!existsSync(file)) atomicWrite(file, `${stringifyYAML(value)}\n`);
}

function mergeDefaults(defaults, current) {
  if (Array.isArray(defaults)) return Array.isArray(current) ? current : defaults;
  if (!defaults || typeof defaults !== 'object') return current === undefined ? defaults : current;
  const out = { ...defaults };
  for (const [key, value] of Object.entries(current || {})) {
    out[key] = key in defaults ? mergeDefaults(defaults[key], value) : value;
  }
  return out;
}

export function initializeWorkspace(workspace = process.cwd()) {
  const p = workspacePaths(workspace);
  for (const key of ['root', 'memory', 'sessions', 'histories', 'loadouts', 'skills', 'logs', 'cache', 'state', 'gateways', 'revisions']) {
    ensureDir(p[key]);
  }
  writeYamlIfMissing(p.soul, DEFAULT_SOUL);
  writeYamlIfMissing(p.identity, DEFAULT_IDENTITY);
  writeYamlIfMissing(p.agent, DEFAULT_AGENT);
  writeYamlIfMissing(p.workspaceConfig, { ...DEFAULT_WORKSPACE, root: p.workspace });

  const currentConfig = readJSON(p.config, null);
  const migratedConfig = mergeDefaults(DEFAULT_CONFIG, currentConfig || {});
  migratedConfig.schemaVersion = DEFAULT_CONFIG.schemaVersion;
  if (!currentConfig || JSON.stringify(currentConfig) !== JSON.stringify(migratedConfig)) writeJSON(p.config, migratedConfig);

  if (!existsSync(p.model)) writeJSON(p.model, { provider: null, model: null, custom: false, updatedAt: null });
  if (!existsSync(p.heartbeat)) writeJSON(p.heartbeat, {
    status: 'idle',
    currentTask: null,
    currentStage: null,
    lastTool: null,
    lastCheckpoint: null,
    health: 'healthy',
    updatedAt: new Date().toISOString()
  });
  const memoryIndex = join(p.memory, 'index.json');
  if (!existsSync(memoryIndex)) writeJSON(memoryIndex, { schemaVersion: 1, items: [] });
  return p;
}

export function readYamlFile(file, fallback = {}) {
  try {
    return parseYAML(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function updateYamlFile(file, value, revisionsRoot) {
  snapshotFile(file, revisionsRoot);
  atomicWrite(file, `${stringifyYAML(value)}\n`);
  return value;
}

export function loadWorkspaceState(workspace = process.cwd()) {
  const paths = initializeWorkspace(workspace);
  return {
    paths,
    soul: readYamlFile(paths.soul, DEFAULT_SOUL),
    identity: readYamlFile(paths.identity, DEFAULT_IDENTITY),
    agent: readYamlFile(paths.agent, DEFAULT_AGENT),
    workspace: readYamlFile(paths.workspaceConfig, DEFAULT_WORKSPACE),
    config: readJSON(paths.config, DEFAULT_CONFIG),
    model: readJSON(paths.model, { provider: null, model: null }),
    heartbeat: readJSON(paths.heartbeat, {})
  };
}

export function updateHeartbeat(paths, patch) {
  const current = readJSON(paths.heartbeat, {});
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  writeJSON(paths.heartbeat, next);
  return next;
}

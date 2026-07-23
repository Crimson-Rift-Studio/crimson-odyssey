import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  resolveExecutable,
  runExecutableSync
} from '../core/executable.js';

const AGENTS = [
  { id: 'codex-cli', name: 'OpenAI Codex CLI', command: 'codex', provider: 'codex-cli', auth: 'existing CLI session' },
  { id: 'claude-cli', name: 'Claude Code', command: 'claude', provider: 'claude-cli', auth: 'existing CLI session' },
  { id: 'gemini-cli', name: 'Gemini CLI', command: 'gemini', provider: 'gemini-cli', auth: 'existing CLI session' },
  { id: 'command-code', name: 'Command Code', command: 'command-code', provider: null, auth: 'detected only' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', provider: null, auth: 'detected only' },
  { id: 'cline', name: 'Cline CLI', command: 'cline', provider: null, auth: 'detected only' },
  { id: 'kilo', name: 'Kilo Code', command: 'kilo', provider: null, auth: 'detected only' },
  { id: 'aider', name: 'Aider', command: 'aider', provider: null, auth: 'detected only' },
  { id: 'ollama', name: 'Ollama', command: 'ollama', provider: 'ollama', auth: 'local runtime' }
];

const ENV_PROVIDERS = [
  ['openai', 'OPENAI_API_KEY'], ['anthropic', 'ANTHROPIC_API_KEY'], ['gemini', 'GEMINI_API_KEY'],
  ['xai', 'XAI_API_KEY'], ['mistral', 'MISTRAL_API_KEY'], ['groq', 'GROQ_API_KEY'],
  ['openrouter', 'OPENROUTER_API_KEY']
];

export { resolveExecutable };

export function commandExists(command, options = {}) {
  return Boolean(resolveExecutable(command, options));
}

export function verifyExecutable(executable, {
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync
} = {}) {
  for (const args of [['--version'], ['--help']]) {
    const result = runExecutableSync(executable, args, { platform, env, spawnSyncImpl, timeout: 5000 });
    if (result.status === 0) {
      const detail = String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || 'command launched';
      return { usable: true, detail };
    }
  }
  return { usable: false, error: 'command did not pass --version or --help verification' };
}

export function resolveCliProvider(providerId, config = {}, options = {}) {
  const agent = AGENTS.find((item) => item.provider === providerId);
  if (!agent) return { usable: false, error: `No CLI bridge is registered for ${providerId}` };
  const stored = config.providers?.[providerId]?.executable;
  const executable = resolveExecutable(stored || agent.command, options);
  if (!executable) return { ...agent, usable: false, error: `${agent.name} executable was not found` };
  const verified = verifyExecutable(executable, options);
  return { ...agent, ...verified, executable, command: executable, detected: true };
}

export function detectInstalledAgents({
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  existsSyncImpl = existsSync,
  env = process.env
} = {}) {
  const options = { platform, spawnSyncImpl, existsSyncImpl, env };
  const agents = [];
  const unusable = [];
  for (const agent of AGENTS) {
    const executable = resolveExecutable(agent.command, options);
    if (!executable) continue;
    const verified = verifyExecutable(executable, options);
    const detected = { ...agent, ...verified, command: executable, executable, detected: true };
    if (verified.usable) agents.push(detected);
    else unusable.push(detected);
  }
  const credentials = ENV_PROVIDERS.filter(([, key]) => Boolean(env[key])).map(([provider, envKey]) => ({ provider, envKey }));
  return { agents, unusable, credentials };
}

import { getProvider } from './catalog.js';
import { resolveSecret } from '../core/secrets.js';
import { spawn, spawnSync } from 'node:child_process';
import { executableInvocation } from '../core/executable.js';


function cliPrompt(system, messages) {
  return [
    system ? `System instructions:\n${system}` : '',
    ...messages.map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}:\n${item.content}`)
  ].filter(Boolean).join('\n\n');
}

export function terminateProcessTree(child, {
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  processKillImpl = process.kill
} = {}) {
  if (platform === 'win32' && child.pid) {
    spawnSyncImpl('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    return;
  }
  if (child.pid) {
    processKillImpl(-child.pid, 'SIGKILL');
    return;
  }
  child.kill?.('SIGKILL');
}

export function runCli(executable, args, {
  cwd = process.cwd(),
  spawnImpl = spawn,
  input = '',
  timeoutMs = 120000,
  platform = process.platform,
  env = process.env,
  terminateProcessTreeImpl = terminateProcessTree
} = {}) {
  return new Promise((resolve, reject) => {
    const invocation = executableInvocation(executable, args, { platform, env });
    const child = spawnImpl(invocation.command, invocation.args, {
      cwd,
      windowsHide: true,
      detached: platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      try {
        terminateProcessTreeImpl(child, { platform });
      } catch {
        // The timeout remains the primary error even if process cleanup fails.
      }
      finish(() => reject(new Error(`${executable} timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { out += String(chunk); });
    child.stderr?.on('data', (chunk) => { err += String(chunk); });
    child.on('error', (error) => finish(() => reject(new Error(`Unable to launch ${executable}: ${error.message}`))));
    child.on('close', (code) => finish(() => code === 0
      ? resolve({ out, err })
      : reject(new Error(`${executable} exited with code ${code}${err ? `: ${err.slice(0, 300)}` : ''}`))));
    child.stdin?.end(input);
  });
}

function cliArgs(provider, model) {
  const selected = model && model !== 'default' ? model : null;
  if (provider.id === 'codex-cli') return ['exec', '--ephemeral', '--skip-git-repo-check', '--color', 'never', '-s', 'read-only', ...(selected ? ['-m', selected] : []), '-'];
  if (provider.id === 'claude-cli') return ['-p', 'Follow the request provided on stdin.', '--output-format', 'json', '--max-turns', '1', '--no-session-persistence', ...(selected ? ['--model', selected] : [])];
  if (provider.id === 'gemini-cli') return ['-p', 'Follow the request provided on stdin.', '--output-format', 'json', ...(selected ? ['--model', selected] : [])];
  throw new Error(`Unsupported CLI provider: ${provider.id}`);
}

function parseCliOutput(provider, out) {
  if (['claude-cli', 'gemini-cli'].includes(provider.id)) {
    try {
      const payload = JSON.parse(out);
      return payload.result || payload.response || payload.content || out;
    } catch { return out; }
  }
  return out;
}

function cliLoginInstruction(provider) {
  if (provider.id === 'codex-cli') return 'Run codex login.';
  if (provider.id === 'claude-cli') return 'Run claude auth login.';
  if (provider.id === 'gemini-cli') return 'Run gemini and complete authentication.';
  return '';
}

function openAIMessages(system, messages) {
  return [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content }))
  ];
}

async function parseError(response) {
  let detail = '';
  try {
    const payload = await response.json();
    detail = payload?.error?.message || payload?.message || JSON.stringify(payload);
  } catch {
    detail = await response.text().catch(() => '');
  }
  return `${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`;
}

export function createModelClient(modelConfig, rootConfig = {}, {
  fetchImpl = fetch,
  spawnImpl = spawn,
  cwd = process.cwd(),
  timeoutMs = 120000,
  platform = process.platform,
  env = process.env,
  terminateProcessTreeImpl = terminateProcessTree
} = {}) {
  const provider = getProvider(modelConfig.provider);
  const providerConfig = rootConfig?.providers?.[provider.id] || {};
  const baseUrl = modelConfig.baseUrl || providerConfig.baseUrl || provider.baseUrl;
  const secretRef = modelConfig.secretRef || providerConfig.secretRef || (provider.secretEnv ? `env:${provider.secretEnv}` : null);

  async function send({ system = '', messages = [], temperature = 0.2, maxTokens = 4096 }) {
    if (!modelConfig.model) throw new Error('No model is selected. Run crimson setup or use /model.');
    if (provider.kind === 'cli') {
      const prompt = cliPrompt(system, messages);
      const executable = modelConfig.executable || providerConfig.executable;
      if (!executable) throw new Error(`No resolved executable is configured for ${provider.name}. Run crimson setup --auto.`);
      try {
        const { out } = await runCli(executable, cliArgs(provider, modelConfig.model), {
          cwd,
          spawnImpl,
          input: prompt,
          timeoutMs,
          platform,
          env,
          terminateProcessTreeImpl
        });
        return { text: String(parseCliOutput(provider, out)).trim(), usage: null, raw: out };
      } catch (error) {
        if (/auth|login|logged in|unauthorized|credential/i.test(error.message)) {
          throw new Error(`${provider.name} is not authenticated. ${cliLoginInstruction(provider)}`);
        }
        throw error;
      }
    }
    const key = resolveSecret(secretRef);
    if (provider.secretEnv && !key && !['ollama', 'lmstudio'].includes(provider.id)) {
      throw new Error(`No credential is available for ${provider.name}`);
    }
    if (!baseUrl) throw new Error(`No base URL is configured for ${provider.name}`);

    if (provider.kind === 'anthropic') {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: modelConfig.model,
          system,
          messages: messages.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content })),
          max_tokens: maxTokens,
          temperature
        })
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = await response.json();
      return {
        text: (payload.content || []).map((item) => item?.text || '').join(''),
        usage: payload.usage || null,
        raw: payload
      };
    }

    if (provider.kind === 'ollama') {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: modelConfig.model,
          messages: openAIMessages(system, messages),
          stream: false,
          options: { temperature }
        })
      });
      if (!response.ok) throw new Error(await parseError(response));
      const payload = await response.json();
      return { text: payload?.message?.content || '', usage: payload?.eval_count ? { output_tokens: payload.eval_count } : null, raw: payload };
    }

    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    if (provider.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/aabrur/crimson-odyssey';
      headers['X-Title'] = 'Crimson Odyssey';
    }
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelConfig.model,
        messages: openAIMessages(system, messages),
        temperature,
        max_tokens: maxTokens
      })
    });
    if (!response.ok) throw new Error(await parseError(response));
    const payload = await response.json();
    return {
      text: payload?.choices?.[0]?.message?.content || '',
      usage: payload?.usage || null,
      raw: payload
    };
  }

  return { provider, send };
}

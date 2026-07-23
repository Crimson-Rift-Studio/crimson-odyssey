import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { initializeWorkspace } from '../src/core/state.js';
import { fetchModels, classifyModel, getProvider } from '../src/providers/catalog.js';
import { createModelClient } from '../src/providers/client.js';
import * as clients from '../src/providers/client.js';
import * as picker from '../src/providers/picker.js';
import { tempDir, jsonResponse } from './helpers.js';

test('provider registry contains the ten locked provider choices', () => {
  const ids = ['openai', 'anthropic', 'gemini', 'xai', 'mistral', 'groq', 'openrouter', 'ollama', 'lmstudio', 'codex-cli', 'claude-cli', 'gemini-cli', 'custom'];
  for (const id of ids) assert.equal(getProvider(id).id, id);
});

test('model classification recognizes free, coding, fast, vision, and top hints', () => {
  assert.deepEqual(classifyModel('meta/model:free', 'openrouter'), ['free']);
  assert.equal(classifyModel('gpt-5.2-codex-mini', 'openai').includes('coding'), true);
  assert.equal(classifyModel('gpt-5.2-codex-mini', 'openai').includes('top'), true);
  assert.equal(classifyModel('gemini-flash-vision', 'gemini').includes('fast'), true);
  assert.equal(classifyModel('gemini-flash-vision', 'gemini').includes('vision'), true);
});

test('live OpenAI-compatible model catalog merges and caches results', async () => {
  const tmp = tempDir();
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const paths = initializeWorkspace(tmp.dir);
    const config = { models: { cacheTtlHours: 24 }, providers: { openai: { secretRef: 'env:OPENAI_API_KEY' } } };
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ data: [{ id: 'live-model-a' }, { id: 'live-model-b' }] });
    };
    const first = await fetchModels('openai', config, { paths, refresh: true, fetchImpl });
    assert.equal(first.models.some((item) => item.id === 'live-model-a'), true);
    const second = await fetchModels('openai', config, { paths, refresh: false, fetchImpl });
    assert.equal(second.fromCache, true);
    assert.equal(calls, 1);
  } finally {
    delete process.env.OPENAI_API_KEY;
    tmp.cleanup();
  }
});

test('Ollama catalog normalizes /api/tags payload', async () => {
  const tmp = tempDir();
  try {
    const paths = initializeWorkspace(tmp.dir);
    const result = await fetchModels('ollama', {}, {
      paths,
      refresh: true,
      fetchImpl: async () => jsonResponse({ models: [{ name: 'llama3.2:latest' }] })
    });
    assert.equal(result.models[0].id, 'llama3.2:latest');
    assert.equal(result.models[0].tags.includes('free'), true);
  } finally { tmp.cleanup(); }
});

test('model fetch failure falls back to cached models and reports the error', async () => {
  const tmp = tempDir();
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const paths = initializeWorkspace(tmp.dir);
    const config = { models: { cacheTtlHours: 24 }, providers: { openai: { secretRef: 'env:OPENAI_API_KEY' } } };
    await fetchModels('openai', config, {
      paths,
      refresh: true,
      fetchImpl: async () => jsonResponse({ data: [{ id: 'cached-model' }] })
    });
    const result = await fetchModels('openai', config, {
      paths,
      refresh: true,
      fetchImpl: async () => { throw new Error('network unavailable'); }
    });
    assert.equal(result.fromCache, true);
    assert.equal(result.models.some((item) => item.id === 'cached-model'), true);
    assert.match(result.error, /network unavailable/);
  } finally {
    delete process.env.OPENAI_API_KEY;
    tmp.cleanup();
  }
});

test('OpenAI-compatible client builds chat completions request and parses answer', async () => {
  process.env.CRIMSON_CUSTOM_API_KEY = 'test-key';
  let request = null;
  try {
    const client = createModelClient({
      provider: 'custom',
      model: 'custom-model',
      baseUrl: 'http://localhost:8000/v1',
      secretRef: 'env:CRIMSON_CUSTOM_API_KEY'
    }, {}, {
      fetchImpl: async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return jsonResponse({ choices: [{ message: { content: 'hello' } }], usage: { total_tokens: 7 } });
      }
    });
    const result = await client.send({ system: 'system', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(request.url, 'http://localhost:8000/v1/chat/completions');
    assert.equal(request.body.model, 'custom-model');
    assert.equal(request.body.messages[0].role, 'system');
    assert.equal(result.text, 'hello');
  } finally { delete process.env.CRIMSON_CUSTOM_API_KEY; }
});

test('Anthropic client uses Messages API shape', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let request = null;
  try {
    const client = createModelClient({ provider: 'anthropic', model: 'claude-test', secretRef: 'env:ANTHROPIC_API_KEY' }, {}, {
      fetchImpl: async (url, options) => {
        request = { url, headers: options.headers, body: JSON.parse(options.body) };
        return jsonResponse({ content: [{ type: 'text', text: 'answer' }], usage: { input_tokens: 1, output_tokens: 2 } });
      }
    });
    const result = await client.send({ system: 'system', messages: [{ role: 'user', content: 'question' }] });
    assert.equal(request.url.endsWith('/v1/messages'), true);
    assert.equal(request.headers['x-api-key'], 'test-key');
    assert.equal(request.body.system, 'system');
    assert.equal(result.text, 'answer');
  } finally { delete process.env.ANTHROPIC_API_KEY; }
});

test('Ollama client uses local /api/chat endpoint without credential', async () => {
  let request = null;
  const client = createModelClient({ provider: 'ollama', model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434' }, {}, {
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return jsonResponse({ message: { content: 'local answer' }, eval_count: 4 });
    }
  });
  const result = await client.send({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(request.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(request.body.stream, false);
  assert.equal(result.text, 'local answer');
});

test('CLI client uses the persisted resolved executable and pipes the prompt', async () => {
  const calls = [];
  let stdin = '';
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end(value) { stdin = String(value); } };
    queueMicrotask(() => {
      child.stdout.emit('data', 'cli answer');
      child.emit('close', 0);
    });
    return child;
  };
  const client = createModelClient({
    provider: 'codex-cli',
    model: 'default',
    executable: 'C:\\tools\\codex.exe'
  }, {}, { spawnImpl });
  const result = await client.send({ messages: [{ role: 'user', content: 'hello from stdin' }] });
  assert.equal(calls[0].command, 'C:\\tools\\codex.exe');
  assert.equal(calls[0].args.at(-1), '-');
  assert.match(stdin, /hello from stdin/);
  assert.equal(result.text, 'cli answer');
});

test('CLI client invokes Windows .cmd shim without placing the prompt on the command line', async () => {
  let call = null;
  let stdin = '';
  const spawnImpl = (command, args) => {
    call = { command, args };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end(value) { stdin = String(value); } };
    queueMicrotask(() => {
      child.stdout.emit('data', 'shim answer');
      child.emit('close', 0);
    });
    return child;
  };
  const client = createModelClient({
    provider: 'codex-cli',
    model: 'default',
    executable: 'C:\\tools\\codex.cmd'
  }, {}, { spawnImpl });
  await client.send({ messages: [{ role: 'user', content: 'never put this prompt in cmd' }] });
  assert.match(call.command, /cmd\.exe$/i);
  assert.deepEqual(call.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(call.args.join(' ').includes('never put this prompt in cmd'), false);
  assert.match(stdin, /never put this prompt in cmd/);
});

for (const fixture of [
  { provider: 'claude-cli', payload: { result: 'claude answer' }, expected: 'claude answer' },
  { provider: 'gemini-cli', payload: { response: 'gemini answer' }, expected: 'gemini answer' }
]) {
  test(`${fixture.provider} client parses its headless JSON response`, async () => {
    let args = [];
    const spawnImpl = (_command, receivedArgs) => {
      args = receivedArgs;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end() {} };
      queueMicrotask(() => {
        child.stdout.emit('data', JSON.stringify(fixture.payload));
        child.emit('close', 0);
      });
      return child;
    };
    const client = createModelClient({
      provider: fixture.provider,
      model: 'default',
      executable: `C:\\tools\\${fixture.provider}.exe`
    }, {}, { spawnImpl });
    const result = await client.send({ messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(result.text, fixture.expected);
    assert.equal(args.includes('--output-format'), true);
    assert.equal(args.includes('json'), true);
  });
}

test('model selection preparation persists CLI executable metadata', () => {
  assert.equal(typeof picker.prepareModelSelection, 'function');
  const config = { providers: { 'codex-cli': {} } };
  const selected = picker.prepareModelSelection('codex-cli', 'default', config, {
    cliResolver: () => ({ usable: true, executable: 'C:\\tools\\codex.exe' })
  });
  assert.equal(selected.executable, 'C:\\tools\\codex.exe');
  assert.equal(config.providers['codex-cli'].executable, 'C:\\tools\\codex.exe');
});

test('model selection preparation rejects an unavailable CLI without fallback', () => {
  assert.equal(typeof picker.prepareModelSelection, 'function');
  assert.throws(() => picker.prepareModelSelection('gemini-cli', 'default', { providers: {} }, {
    cliResolver: () => ({ usable: false, error: 'Gemini CLI executable was not found' })
  }), /not found/);
});

test('CLI timeout terminates the spawned process tree', async () => {
  assert.equal(typeof clients.runCli, 'function');
  let terminatedPid = null;
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end() {} };
  const result = clients.runCli('C:\\tools\\codex.exe', ['--version'], {
    spawnImpl: () => child,
    timeoutMs: 5,
    terminateProcessTreeImpl: (process) => { terminatedPid = process.pid; }
  });
  await assert.rejects(result, /timed out/);
  assert.equal(terminatedPid, 4321);
});

test('POSIX process-tree termination signals the detached process group', () => {
  let killed = null;
  clients.terminateProcessTree({ pid: 4321 }, {
    platform: 'linux',
    processKillImpl: (pid, signal) => { killed = { pid, signal }; }
  });
  assert.deepEqual(killed, { pid: -4321, signal: 'SIGKILL' });
});

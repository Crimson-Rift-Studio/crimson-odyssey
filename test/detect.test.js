import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as detection from '../src/setup/detect.js';
import { executableInvocation, runExecutableSync } from '../src/core/executable.js';
import { tempDir } from './helpers.js';

test('Windows resolver returns actual .cmd and .exe paths', () => {
  assert.equal(typeof detection.resolveExecutable, 'function');
  const outputs = {
    codex: 'C:\\npm\\codex.cmd\r\n',
    gemini: 'C:\\tools\\gemini.exe\r\n'
  };
  const spawnSyncImpl = (_command, args) => ({ status: outputs[args[0]] ? 0 : 1, stdout: outputs[args[0]] || '' });
  const existsSyncImpl = (path) => Object.values(outputs).some((value) => value.trim() === path);
  assert.equal(detection.resolveExecutable('codex', { platform: 'win32', spawnSyncImpl, existsSyncImpl, env: { PATH: '' } }), 'C:\\npm\\codex.cmd');
  assert.equal(detection.resolveExecutable('gemini', { platform: 'win32', spawnSyncImpl, existsSyncImpl, env: { PATH: '' } }), 'C:\\tools\\gemini.exe');
});

test('auto detection verifies Codex, Claude, and Gemini and separates unusable CLIs', () => {
  const paths = {
    codex: 'C:\\tools\\codex.cmd',
    claude: 'C:\\tools\\claude.exe',
    gemini: 'C:\\tools\\gemini.cmd',
    kilo: 'C:\\tools\\kilo.cmd'
  };
  const spawnSyncImpl = (command, args) => {
    if (command === 'where.exe') return { status: paths[args[0]] ? 0 : 1, stdout: paths[args[0]] ? `${paths[args[0]]}\r\n` : '' };
    const invocation = [command, ...args].join(' ');
    if (invocation.includes('kilo.cmd')) return { status: 1, stderr: 'broken shim' };
    return { status: 0, stdout: '1.0.0' };
  };
  const result = detection.detectInstalledAgents({
    platform: 'win32',
    spawnSyncImpl,
    existsSyncImpl: (path) => Object.values(paths).includes(path),
    env: { PATH: '', ComSpec: 'cmd.exe', OPENAI_API_KEY: 'set' }
  });
  assert.equal(result.agents.some((item) => item.id === 'codex-cli'), true);
  assert.equal(result.agents.some((item) => item.id === 'claude-cli'), true);
  assert.equal(result.agents.some((item) => item.id === 'gemini-cli'), true);
  assert.equal(result.agents.find((item) => item.id === 'codex-cli').executable, paths.codex);
  assert.equal(result.unusable.some((item) => item.id === 'kilo'), true);
  assert.equal(result.agents.some((item) => item.id === 'kilo'), false);
  assert.deepEqual(result.credentials, [{ provider: 'openai', envKey: 'OPENAI_API_KEY' }]);
});

test('Windows command shims use cmd.exe only for .cmd and .bat files', () => {
  const shim = executableInvocation('C:\\npm\\codex.cmd', ['--version'], {
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
  });
  assert.equal(shim.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(shim.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(shim.args[3], 'call');
  assert.match(shim.args[4], /codex\.cmd/);

  const native = executableInvocation('C:\\tools\\codex.exe', ['--version'], { platform: 'win32' });
  assert.equal(native.command, 'C:\\tools\\codex.exe');
  assert.deepEqual(native.args, ['--version']);
});

test('Windows command shim executes from a normal path containing spaces and parentheses', {
  skip: process.platform !== 'win32'
}, () => {
  const tmp = tempDir('crimson shim (test)-');
  try {
    const shim = `${tmp.dir}\\probe.cmd`;
    writeFileSync(shim, '@echo shim-ok\r\n');
    const result = runExecutableSync(shim, []);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'shim-ok');
  } finally { tmp.cleanup(); }
});

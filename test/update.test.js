import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, checkForUpdate, applyUpdate, formatUpdateNotice } from '../src/core/update.js';
import { tempDir } from './helpers.js';

test('semantic version comparison handles newer, older, and equal versions', () => {
  assert.equal(compareVersions('0.3.0', '0.2.9'), 1);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
});

test('update check reports and caches a newer version', async () => {
  const tmp = tempDir();
  try {
    const spawnImpl = (command, args) => {
      if (command === 'npm' && args[0] === 'prefix') return { status: 0, stdout: '/global/npm\n', stderr: '' };
      return { status: 1, stdout: '', stderr: 'not available' };
    };
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return {
        ok: true,
        status: 200,
        headers: { get() { return 'remote-etag'; } },
        async text() { return JSON.stringify({ version: '0.4.0' }); }
      };
    };
    const first = await checkForUpdate({
      currentVersion: '0.3.0',
      packageRoot: tmp.dir,
      config: { updates: { mode: 'notify', intervalHours: 24 } },
      fetchImpl,
      spawnImpl,
      home: join(tmp.dir, 'home'),
      force: true
    });
    assert.equal(first.available, true);
    assert.equal(first.latestVersion, '0.4.0');
    assert.match(formatUpdateNotice(first), /update available/);
    const second = await checkForUpdate({
      currentVersion: '0.3.0',
      packageRoot: tmp.dir,
      config: { updates: { mode: 'notify', intervalHours: 24 } },
      fetchImpl,
      spawnImpl,
      home: join(tmp.dir, 'home')
    });
    assert.equal(second.cached, true);
    assert.equal(requests, 1);
  } finally { tmp.cleanup(); }
});

test('disabled update policy performs no remote request', async () => {
  const tmp = tempDir();
  try {
    let requested = false;
    const result = await checkForUpdate({
      packageRoot: tmp.dir,
      config: { updates: { mode: 'off' } },
      fetchImpl: async () => { requested = true; throw new Error('should not run'); },
      home: join(tmp.dir, 'home')
    });
    assert.equal(result.disabled, true);
    assert.equal(requested, false);
  } finally { tmp.cleanup(); }
});

test('git update refuses to overwrite a dirty working tree', () => {
  const tmp = tempDir();
  try {
    mkdirSync(join(tmp.dir, '.git'));
    const spawnImpl = (command, args) => {
      const text = args.join(' ');
      if (text.includes('remote get-url')) return { status: 0, stdout: 'https://github.com/aabrur/crimson-odyssey.git\n', stderr: '' };
      if (text.includes('status --porcelain')) return { status: 0, stdout: ' M src/cli.js\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    assert.throws(() => applyUpdate({ packageRoot: tmp.dir, spawnImpl, home: join(tmp.dir, 'home') }), /uncommitted changes/);
  } finally { tmp.cleanup(); }
});

test('global update uses the official GitHub package source', () => {
  const tmp = tempDir();
  try {
    const calls = [];
    const spawnImpl = (command, args) => {
      calls.push([command, args]);
      if (command === 'npm' && args[0] === 'prefix') return { status: 0, stdout: tmp.dir, stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const result = applyUpdate({ packageRoot: join(tmp.dir, 'lib', 'node_modules', 'crimson-odyssey'), spawnImpl, home: join(tmp.dir, 'home') });
    assert.equal(result.ok, true);
    assert.equal(calls.some(([command, args]) => command === 'npm' && args.includes('github:aabrur/crimson-odyssey#main')), true);
  } finally { tmp.cleanup(); }
});

test('current update status renders a clear current message', () => {
  assert.equal(formatUpdateNotice({ ok: true, available: false, currentVersion: '0.3.0' }), 'Crimson Odyssey 0.3.0 is current.');
});

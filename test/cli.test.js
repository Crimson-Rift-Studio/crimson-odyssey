import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tempDir } from './helpers.js';

const bin = resolve('bin/crimson.js');

function run(args, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CRIMSON_HOME: `${cwd}/global-home` },
    timeout: 15000,
    windowsHide: true
  });
}

test('CLI version and help smoke tests', () => {
  const tmp = tempDir();
  try {
    const version = run(['--version'], tmp.dir);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), '0.3.0');
    const help = run(['--help'], tmp.dir);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /crimson setup/);
    assert.match(help.stdout, /crimson gateway/);
  } finally { tmp.cleanup(); }
});

test('CLI status and doctor initialize local workspace', () => {
  const tmp = tempDir();
  try {
    const status = run(['status', '--json'], tmp.dir);
    assert.equal(status.status, 0, status.stderr);
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.version, '0.3.0');
    assert.equal(parsed.model.provider, null);
    const doctor = run(['doctor', '--json'], tmp.dir);
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true);
  } finally { tmp.cleanup(); }
});

test('CLI loadout preview and session management smoke tests', () => {
  const tmp = tempDir();
  try {
    const preview = run(['loadout', 'preview'], tmp.dir);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /WEAPON/);
    const created = run(['session', 'new'], tmp.dir);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(created.stdout.trim().length > 10, true);
    const list = run(['session', 'list'], tmp.dir);
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /cli/);
  } finally { tmp.cleanup(); }
});

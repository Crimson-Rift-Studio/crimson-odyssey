import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { writeJSON } from '../src/core/fs.js';
import { initializeWorkspace, loadWorkspaceState, updateYamlFile, readYamlFile } from '../src/core/state.js';
import { stringifyYAML, parseYAML } from '../src/core/yaml.js';
import { listRevisions, rollbackFile } from '../src/core/revisions.js';
import { tempDir } from './helpers.js';

test('workspace initialization creates the complete project-local state tree', () => {
  const tmp = tempDir();
  try {
    const paths = initializeWorkspace(tmp.dir);
    for (const path of [paths.soul, paths.identity, paths.heartbeat, paths.agent, paths.workspaceConfig, paths.config, paths.model]) {
      assert.equal(existsSync(path), true, path);
    }
    for (const path of [paths.memory, paths.sessions, paths.histories, paths.loadouts, paths.skills, paths.logs, paths.cache, paths.state, paths.gateways, paths.revisions]) {
      assert.equal(existsSync(path), true, path);
    }
    const state = loadWorkspaceState(tmp.dir);
    assert.equal(state.identity.name, 'Crimson Odyssey');
    assert.equal(state.workspace.history_retention_days, 90);
  } finally { tmp.cleanup(); }
});

test('simple YAML round trip preserves nested strings, arrays, booleans, and numbers', () => {
  const value = {
    name: 'Crimson Odyssey',
    enabled: true,
    count: 2,
    nested: { mode: 'selective' },
    tags: ['weapon', 'magic'],
    quoted: 'value: with colon'
  };
  const parsed = parseYAML(stringifyYAML(value));
  assert.deepEqual(parsed, value);
});

test('Soul and Identity edits create revisions and can roll back', () => {
  const tmp = tempDir();
  try {
    const paths = initializeWorkspace(tmp.dir);
    const original = readYamlFile(paths.soul);
    const changed = { ...original, purpose: 'Changed purpose' };
    updateYamlFile(paths.soul, changed, paths.revisions);
    assert.equal(readYamlFile(paths.soul).purpose, 'Changed purpose');
    assert.equal(listRevisions(paths.soul, paths.revisions).length, 1);
    rollbackFile(paths.soul, paths.revisions, 0);
    assert.equal(readYamlFile(paths.soul).purpose, original.purpose);
  } finally { tmp.cleanup(); }
});

test('config schema migration preserves user values and adds setup defaults', () => {
  const tmp = tempDir();
  try {
    const paths = initializeWorkspace(tmp.dir);
    writeJSON(paths.config, { schemaVersion: 2, ui: { theme: 'custom' }, history: { retentionDays: 180 } });
    const state = loadWorkspaceState(tmp.dir);
    assert.equal(state.config.schemaVersion, 3);
    assert.equal(state.config.ui.theme, 'custom');
    assert.equal(state.config.history.retentionDays, 180);
    assert.equal(state.config.setup.completed, false);
    assert.equal(state.config.updates.mode, 'notify');
  } finally { tmp.cleanup(); }
});

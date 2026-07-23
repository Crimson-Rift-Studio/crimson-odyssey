import { existsSync } from 'node:fs';
import { loadWorkspaceState } from './core/state.js';
import { secretStatus, keyringBackend } from './core/secrets.js';
import { loadoutPreview, loadSkillCatalog, validateSkill } from './loadout/engine.js';
import { listSessions } from './session/session.js';
import { readJSON } from './core/fs.js';

function check(name, ok, detail, severity = 'error') {
  return { name, ok: Boolean(ok), detail, severity: ok ? 'ok' : severity };
}

export async function runDoctor({ workspace = process.cwd(), live = false, doctorGateway } = {}) {
  const state = loadWorkspaceState(workspace);
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(check('Node.js', major >= 22, process.version, 'error'));
  checks.push(check('Workspace state', existsSync(state.paths.root), state.paths.root));
  checks.push(check('Soul', Boolean(state.soul?.purpose), state.paths.soul));
  checks.push(check('Identity', Boolean(state.identity?.name), state.paths.identity));
  checks.push(check('Heartbeat', Boolean(state.heartbeat?.status), state.paths.heartbeat));
  checks.push(check('Setup', Boolean(state.config.setup?.completed), state.config.setup?.completed ? `completed with v${state.config.setup.version || 'unknown'}` : 'run crimson setup', 'warning'));
  checks.push(check('Update policy', ['notify', 'ask', 'auto', 'off'].includes(state.config.updates?.mode), state.config.updates?.mode || 'not configured', 'warning'));
  checks.push(check('Model provider', Boolean(state.model?.provider), state.model?.provider || 'not configured', 'warning'));
  checks.push(check('Model ID', Boolean(state.model?.model), state.model?.model || 'not configured', 'warning'));
  if (state.model?.secretRef) {
    const status = secretStatus(state.model.secretRef);
    checks.push(check('Model credential', status.available, `${status.backend || 'none'} reference`, 'warning'));
  }
  checks.push(check('OS keyring', Boolean(keyringBackend()), keyringBackend() || 'encrypted vault fallback active', 'warning'));

  const catalog = loadSkillCatalog(state.paths);
  const invalid = catalog.map((skill) => ({ skill, result: validateSkill(skill) })).filter((entry) => !entry.result.valid);
  checks.push(check('Skill catalog', invalid.length === 0, `${catalog.length} skills, ${invalid.length} invalid`));
  const loadout = loadoutPreview(state.paths, state.workspace.loadout || 'default');
  checks.push(check('Loadout', Boolean(loadout.equipped.weapon.length && loadout.equipped.armor.length), `${loadout.equipped.weapon.length} weapon, ${loadout.equipped.armor.length} armor`, 'warning'));
  checks.push(check('Sessions', true, `${listSessions(state.paths).length} sessions`));

  const gatewayIds = [];
  try {
    const { readdirSync } = await import('node:fs');
    for (const name of readdirSync(state.paths.gateways)) if (name.endsWith('.json')) gatewayIds.push(name.slice(0, -5));
  } catch { /* no gateways */ }
  checks.push(check('Gateway configs', true, `${gatewayIds.length} configured`));
  if (live && doctorGateway) {
    for (const id of gatewayIds) {
      const result = await doctorGateway(state.paths, id);
      checks.push(check(`Gateway ${id}`, result.ok, result.ok ? JSON.stringify(result) : result.error, 'warning'));
    }
  }

  const failures = checks.filter((item) => !item.ok && item.severity === 'error');
  const warnings = checks.filter((item) => !item.ok && item.severity === 'warning');
  return {
    ok: failures.length === 0,
    status: failures.length ? 'failed' : warnings.length ? 'warning' : 'healthy',
    workspace: state.paths.workspace,
    checks,
    counts: { passed: checks.filter((item) => item.ok).length, warnings: warnings.length, failed: failures.length }
  };
}

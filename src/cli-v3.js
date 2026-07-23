import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { main as legacyMain } from './cli.js';
import { loadWorkspaceState } from './core/state.js';
import { readJSON, writeJSON } from './core/fs.js';
import { runFullSetup } from './setup/full.js';
import { runModelSetup, promptChoice } from './providers/picker.js';
import { checkForUpdate, applyUpdate, formatUpdateNotice } from './core/update.js';

function print(text = '') { stdout.write(`${text}\n`); }
function jsonFlag(args) { return args.includes('--json'); }

async function updateCommand(args, workspace) {
  const state = loadWorkspaceState(workspace);
  const [sub = 'status'] = args;
  if (sub === 'status' || sub === 'check') {
    const result = await checkForUpdate({ config: state.config, force: sub === 'check' });
    if (jsonFlag(args)) print(JSON.stringify(result, null, 2));
    else print(formatUpdateNotice(result));
    return result.ok ? 0 : 1;
  }
  if (sub === 'apply') {
    const result = applyUpdate({ repository: state.config.updates?.repository, branch: state.config.updates?.branch });
    if (jsonFlag(args)) print(JSON.stringify(result, null, 2));
    else print('Update installed. Restart Crimson Odyssey.');
    return 0;
  }
  if (sub === 'configure') {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const mode = (await promptChoice('Update behavior', [
        { label: 'Notify', value: 'notify' },
        { label: 'Ask before install', value: 'ask' },
        { label: 'Auto install', value: 'auto' },
        { label: 'Off', value: 'off' }
      ], { rl })).value;
      const raw = (await rl.question(`Check interval hours [${state.config.updates?.intervalHours || 24}]: `)).trim();
      const config = readJSON(state.paths.config, state.config);
      config.updates = { ...(config.updates || {}), mode, intervalHours: Math.max(1, Number(raw || config.updates?.intervalHours || 24)), repository: 'aabrur/crimson-odyssey', branch: 'main', channel: 'stable' };
      writeJSON(state.paths.config, config);
      print(`Update mode: ${mode}`);
      return 0;
    } finally { rl.close(); }
  }
  throw new Error(`Unknown update command: ${sub}`);
}

async function startupUpdate(workspace) {
  const state = loadWorkspaceState(workspace);
  if (process.env.CRIMSON_SKIP_UPDATE_CHECK === '1' || state.config.updates?.mode === 'off') return null;
  const status = await checkForUpdate({ config: state.config });
  if (!status.available) return status;
  const mode = state.config.updates?.mode || 'notify';
  if (mode === 'auto') {
    try {
      applyUpdate({ repository: state.config.updates?.repository, branch: state.config.updates?.branch });
      print('Crimson Odyssey updated. Restart the command.');
      return { ...status, applied: true };
    } catch (error) { print(`Automatic update was not applied: ${error.message}`); }
  }
  if (mode === 'ask' && stdin.isTTY) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question(`${formatUpdateNotice(status)} Install now? [y/N]: `)).trim().toLowerCase();
      if (['y', 'yes', 'ya', 'iya'].includes(answer)) {
        applyUpdate({ repository: state.config.updates?.repository, branch: state.config.updates?.branch });
        print('Update installed. Restart the command.');
        return { ...status, applied: true };
      }
    } finally { rl.close(); }
  } else {
    print(formatUpdateNotice(status));
  }
  return status;
}

export async function main(args = [], { workspace = process.cwd() } = {}) {
  const [command, ...rest] = args;
  if (command === 'setup') {
    const result = await runFullSetup({ workspace, askLaunch: !rest.includes('--no-tui'), autoDetect: rest.includes('--auto') });
    if (result.launchTui) return legacyMain([], { workspace });
    return result.ok ? 0 : 1;
  }
  if (command === 'model') {
    const state = loadWorkspaceState(workspace);
    await runModelSetup(state, { refresh: true });
    return 0;
  }
  if (command === 'update') return updateCommand(rest, workspace);
  if (!command) {
    const state = loadWorkspaceState(workspace);
    if (!state.config.setup?.completed && stdin.isTTY) {
      const result = await runFullSetup({ workspace });
      if (!result.launchTui) return result.ok ? 0 : 1;
    }
    const update = await startupUpdate(workspace);
    if (update?.applied) return 0;
  }
  return legacyMain(args, { workspace });
}

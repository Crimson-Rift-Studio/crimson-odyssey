import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

export function globalHome() {
  return resolve(process.env.CRIMSON_HOME || join(homedir(), '.crimson'));
}

export function findWorkspaceRoot(start = process.cwd()) {
  return resolve(process.env.CRIMSON_WORKSPACE || start);
}

export function workspacePaths(workspace = findWorkspaceRoot()) {
  const root = resolve(workspace);
  const odyssey = join(root, '.crimson', 'odyssey');
  return {
    workspace: root,
    root: odyssey,
    soul: join(odyssey, 'soul.yaml'),
    identity: join(odyssey, 'identity.yaml'),
    heartbeat: join(odyssey, 'heartbeat.json'),
    agent: join(odyssey, 'agent.yaml'),
    workspaceConfig: join(odyssey, 'workspace.yaml'),
    config: join(odyssey, 'config.json'),
    model: join(odyssey, 'model.json'),
    memory: join(odyssey, 'memory'),
    sessions: join(odyssey, 'sessions'),
    histories: join(odyssey, 'histories'),
    loadouts: join(odyssey, 'loadouts'),
    skills: join(odyssey, 'skills'),
    logs: join(odyssey, 'logs'),
    cache: join(odyssey, 'cache'),
    state: join(odyssey, 'state'),
    gateways: join(odyssey, 'gateways'),
    revisions: join(odyssey, 'revisions')
  };
}

export function globalPaths(home = globalHome()) {
  return {
    home,
    vault: join(home, 'secrets.vault'),
    vaultKey: join(home, 'vault.key'),
    cache: join(home, 'cache'),
    logs: join(home, 'logs'),
    updateCache: join(home, 'cache', 'update-status.json'),
    updateLock: join(home, 'cache', 'update.lock')
  };
}

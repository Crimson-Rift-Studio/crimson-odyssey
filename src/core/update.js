import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './identity.js';
import { globalPaths } from './paths.js';
import { ensureDir, readJSON, writeJSON } from './fs.js';

export const UPDATE_REPOSITORY = 'aabrur/crimson-odyssey';
export const UPDATE_BRANCH = 'main';
export const DEFAULT_UPDATE_CONFIG = {
  mode: 'notify',
  channel: 'stable',
  intervalHours: 24,
  repository: UPDATE_REPOSITORY,
  branch: UPDATE_BRANCH
};

export function packageRootFromModule() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function normalizeUpdateConfig(config = {}) {
  return {
    ...DEFAULT_UPDATE_CONFIG,
    ...(config.updates || config.update || {})
  };
}

export function compareVersions(left, right) {
  const parse = (value) => String(value || '0.0.0')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function run(spawnImpl, command, args, options = {}) {
  return spawnImpl(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 15000,
    cwd: options.cwd,
    env: options.env || process.env,
    shell: false
  });
}

function outputText(result) {
  return String(result?.stdout || '').trim();
}

function successful(result) {
  return result && result.status === 0;
}

export function detectInstall({ packageRoot = packageRootFromModule(), spawnImpl = spawnSync } = {}) {
  const root = resolve(packageRoot);
  if (existsSync(join(root, '.git'))) {
    const remoteResult = run(spawnImpl, 'git', ['-C', root, 'remote', 'get-url', 'origin']);
    return {
      mode: 'git',
      packageRoot: root,
      remote: successful(remoteResult) ? outputText(remoteResult) : null
    };
  }
  const globalPrefix = run(spawnImpl, 'npm', ['prefix', '-g']);
  const normalizedRoot = root.replace(/\\/g, '/').toLowerCase();
  const normalizedPrefix = outputText(globalPrefix).replace(/\\/g, '/').toLowerCase();
  if (successful(globalPrefix) && normalizedRoot.startsWith(normalizedPrefix)) {
    return { mode: 'npm-global', packageRoot: root, remote: `github:${UPDATE_REPOSITORY}` };
  }
  return { mode: 'local-package', packageRoot: root, remote: `github:${UPDATE_REPOSITORY}` };
}

function cacheFresh(cache, updateConfig, now) {
  const checkedAt = Date.parse(cache?.checkedAt || 0);
  const intervalMs = Math.max(1, Number(updateConfig.intervalHours || 24)) * 3600 * 1000;
  return Number.isFinite(checkedAt) && now - checkedAt < intervalMs;
}

function parsePackage(content) {
  const parsed = JSON.parse(String(content || ''));
  if (!parsed?.version) throw new Error('Remote package metadata has no version');
  return parsed;
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  return {
    accept: 'application/vnd.github.raw+json',
    'user-agent': 'crimson-odyssey-updater',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function remoteFromHttp({ fetchImpl, repository, branch, timeoutMs }) {
  const apiUrl = `https://api.github.com/repos/${repository}/contents/package.json?ref=${encodeURIComponent(branch)}`;
  let response = await fetchWithTimeout(fetchImpl, apiUrl, { headers: githubHeaders() }, timeoutMs);
  if (response.ok) {
    return { package: parsePackage(await response.text()), method: 'github-api', remoteSha: response.headers?.get?.('etag') || null };
  }
  const rawUrl = `https://raw.githubusercontent.com/${repository}/${branch}/package.json`;
  response = await fetchWithTimeout(fetchImpl, rawUrl, { headers: githubHeaders() }, timeoutMs);
  if (!response.ok) throw new Error(`Remote metadata request failed with HTTP ${response.status}`);
  return { package: parsePackage(await response.text()), method: 'github-raw', remoteSha: response.headers?.get?.('etag') || null };
}

function remoteFromGit({ install, spawnImpl, branch, timeoutMs }) {
  const fetchResult = run(spawnImpl, 'git', ['-C', install.packageRoot, 'fetch', '--quiet', '--no-tags', 'origin', branch], { timeout: timeoutMs });
  if (!successful(fetchResult)) throw new Error(String(fetchResult?.stderr || 'git fetch failed').trim());
  const packageResult = run(spawnImpl, 'git', ['-C', install.packageRoot, 'show', 'FETCH_HEAD:package.json'], { timeout: timeoutMs });
  if (!successful(packageResult)) throw new Error(String(packageResult?.stderr || 'git show failed').trim());
  const localShaResult = run(spawnImpl, 'git', ['-C', install.packageRoot, 'rev-parse', 'HEAD']);
  const remoteShaResult = run(spawnImpl, 'git', ['-C', install.packageRoot, 'rev-parse', 'FETCH_HEAD']);
  return {
    package: parsePackage(packageResult.stdout),
    method: 'git-fetch',
    localSha: successful(localShaResult) ? outputText(localShaResult) : null,
    remoteSha: successful(remoteShaResult) ? outputText(remoteShaResult) : null
  };
}

export async function checkForUpdate({
  currentVersion = VERSION,
  packageRoot = packageRootFromModule(),
  config = {},
  fetchImpl = fetch,
  spawnImpl = spawnSync,
  force = false,
  home,
  now = Date.now(),
  timeoutMs = 5000
} = {}) {
  const updateConfig = normalizeUpdateConfig(config);
  const global = globalPaths(home);
  ensureDir(global.cache);
  const cached = readJSON(global.updateCache, null);
  if (updateConfig.mode === 'off') {
    return { ok: true, disabled: true, available: false, currentVersion, latestVersion: currentVersion, checkedAt: new Date(now).toISOString(), mode: 'off' };
  }
  if (!force && cacheFresh(cached, updateConfig, now)) return { ...cached, cached: true };

  const install = detectInstall({ packageRoot, spawnImpl });
  let remote;
  let error = null;
  try {
    if (install.mode === 'git') remote = remoteFromGit({ install, spawnImpl, branch: updateConfig.branch, timeoutMs });
    else remote = await remoteFromHttp({ fetchImpl, repository: updateConfig.repository, branch: updateConfig.branch, timeoutMs });
  } catch (firstError) {
    try {
      remote = await remoteFromHttp({ fetchImpl, repository: updateConfig.repository, branch: updateConfig.branch, timeoutMs });
    } catch (secondError) {
      error = secondError?.message || firstError?.message || 'Update check failed';
    }
  }

  const latestVersion = remote?.package?.version || currentVersion;
  const newerVersion = compareVersions(latestVersion, currentVersion) > 0;
  const newerCommit = Boolean(remote?.remoteSha && remote?.localSha && remote.remoteSha !== remote.localSha);
  const result = {
    ok: !error,
    available: Boolean(!error && (newerVersion || newerCommit)),
    reason: newerVersion ? 'version' : newerCommit ? 'commit' : 'current',
    currentVersion,
    latestVersion,
    checkedAt: new Date(now).toISOString(),
    method: remote?.method || null,
    install,
    remoteSha: remote?.remoteSha || null,
    localSha: remote?.localSha || null,
    mode: updateConfig.mode,
    error
  };
  writeJSON(global.updateCache, result);
  return result;
}

function acquireLock(lockFile) {
  ensureDir(dirname(lockFile));
  if (existsSync(lockFile)) {
    const age = Date.now() - Number(readFileSync(lockFile, 'utf8') || 0);
    if (Number.isFinite(age) && age < 10 * 60 * 1000) throw new Error('Another Crimson update is already running');
    unlinkSync(lockFile);
  }
  writeFileSync(lockFile, String(Date.now()), { mode: 0o600 });
}

function releaseLock(lockFile) {
  try { unlinkSync(lockFile); } catch { /* best effort */ }
}

function commandFailure(result, fallback) {
  const message = String(result?.stderr || result?.stdout || fallback || 'Command failed').trim();
  return new Error(message);
}

export function applyUpdate({
  packageRoot = packageRootFromModule(),
  spawnImpl = spawnSync,
  home,
  repository = UPDATE_REPOSITORY,
  branch = UPDATE_BRANCH
} = {}) {
  const install = detectInstall({ packageRoot, spawnImpl });
  const lockFile = globalPaths(home).updateLock;
  acquireLock(lockFile);
  try {
    const commands = [];
    if (install.mode === 'git') {
      const dirty = run(spawnImpl, 'git', ['-C', install.packageRoot, 'status', '--porcelain']);
      if (!successful(dirty)) throw commandFailure(dirty, 'Unable to inspect Git working tree');
      if (outputText(dirty)) throw new Error('Update blocked because the repository has uncommitted changes');
      const pull = run(spawnImpl, 'git', ['-C', install.packageRoot, 'pull', '--ff-only', 'origin', branch], { timeout: 120000 });
      commands.push(['git', 'pull']);
      if (!successful(pull)) throw commandFailure(pull, 'Git update failed');
      const installDeps = run(spawnImpl, 'npm', ['install'], { cwd: install.packageRoot, timeout: 180000 });
      commands.push(['npm', 'install']);
      if (!successful(installDeps)) throw commandFailure(installDeps, 'Dependency installation failed');
      const verify = run(spawnImpl, 'npm', ['run', 'check'], { cwd: install.packageRoot, timeout: 180000 });
      commands.push(['npm', 'run', 'check']);
      if (!successful(verify)) throw commandFailure(verify, 'Post-update verification failed');
      return { ok: true, mode: install.mode, restartRequired: true, commands };
    }

    const npmInstall = run(spawnImpl, 'npm', ['install', '-g', `github:${repository}#${branch}`], { timeout: 240000 });
    commands.push(['npm', 'install', '-g', `github:${repository}#${branch}`]);
    if (!successful(npmInstall)) throw commandFailure(npmInstall, 'Global package update failed');
    return { ok: true, mode: install.mode, restartRequired: true, commands };
  } finally {
    releaseLock(lockFile);
  }
}

export function formatUpdateNotice(status) {
  if (!status || status.disabled) return '';
  if (!status.ok) return `Update check unavailable: ${status.error || 'unknown error'}`;
  if (!status.available) return `Crimson Odyssey ${status.currentVersion} is current.`;
  const target = status.latestVersion && status.latestVersion !== status.currentVersion
    ? `v${status.latestVersion}`
    : 'a newer repository revision';
  return `Crimson Odyssey update available: ${target}. Run crimson update apply.`;
}

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32, posix } from 'node:path';

function pathModule(platform) {
  return platform === 'win32' ? win32 : posix;
}

export function resolveExecutable(command, {
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync,
  existsSyncImpl = existsSync
} = {}) {
  if (!command) return null;
  const paths = pathModule(platform);
  if (paths.isAbsolute(command) || /[\\/]/.test(command)) {
    return existsSyncImpl(command) ? paths.resolve(command) : null;
  }

  const finder = platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSyncImpl(finder, [command], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
  const found = result.status === 0
    ? String(result.stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean).filter(existsSyncImpl)
    : [];
  if (found.length) {
    const supported = platform === 'win32'
      ? found.filter((item) => ['.exe', '.cmd', '.bat', '.ps1'].includes(win32.extname(item).toLowerCase()))
      : found;
    return paths.resolve(supported[0] || found[0]);
  }

  const searchPath = env.PATH || env.Path || '';
  const extensions = platform === 'win32'
    ? [...new Set(['.exe', '.cmd', '.bat', '.ps1', '', ...String(env.PATHEXT || '').toLowerCase().split(';').filter(Boolean)])]
    : [''];
  for (const directory of searchPath.split(paths.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = paths.join(directory, platform === 'win32' && paths.extname(command) ? command : `${command}${extension}`);
      if (existsSyncImpl(candidate)) return paths.resolve(candidate);
    }
  }
  return null;
}

export function executableInvocation(executable, args = [], {
  platform = process.platform,
  env = process.env
} = {}) {
  const extension = platform === 'win32' ? win32.extname(executable).toLowerCase() : '';
  if (extension === '.cmd' || extension === '.bat') {
    const path = String(executable);
    const unsafePath = /[&|<>^"%!\r\n]/.test(path) || (/[()]/.test(path) && !/\s/.test(path));
    const unsafeArgument = args.some((value) => !/^[A-Za-z0-9_ .:\\/@+-]+$/.test(String(value)));
    if (unsafePath || unsafeArgument) {
      throw new Error('Unsafe argument for Windows command shim');
    }
    return {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', 'call', executable, ...args]
    };
  }
  if (extension === '.ps1') {
    const powershell = env.SystemRoot
      ? win32.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe';
    return {
      command: powershell,
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args]
    };
  }
  return { command: executable, args };
}

export function runExecutableSync(executable, args = [], {
  platform = process.platform,
  env = process.env,
  spawnSyncImpl = spawnSync,
  timeout = 5000,
  input
} = {}) {
  const invocation = executableInvocation(executable, args, { platform, env });
  return spawnSyncImpl(invocation.command, invocation.args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    input
  });
}

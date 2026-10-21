import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const LIBRARY_DIR_NAME = 'YT Music Converter';
export const WORKSPACE_FILES = {
  helper: 'updater-helper.cjs',
  archive: 'package.zip',
  journal: 'journal.json',
  state: 'state.json',
  notes: 'release-notes.json',
  lock: 'apply.lock',
  cancel: 'apply.cancel',
  bootOk: 'boot-ok.json',
  log: 'updater.log',
  watchdog: 'recover-update.ps1',
} as const;

export function installIdFor(installDir: string): string {
  return createHash('sha256').update(installDir.toLowerCase()).digest('hex').slice(0, 16);
}

export function workspaceRoot(localAppDataDir: string, installId: string): string {
  return path.join(localAppDataDir, LIBRARY_DIR_NAME, 'updater', installId);
}

export function workspaceDirectories(localAppDataDir: string): string[] {
  const root = path.join(localAppDataDir, LIBRARY_DIR_NAME, 'updater');
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(root, entry.name));
  } catch {
    return [];
  }
}

export function newUpdateId(version: string): string {
  return `${version}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function helperDirFor(installDir: string, updateId: string): string {
  const resolved = path.resolve(installDir);
  return path.join(path.dirname(resolved), `${path.basename(resolved)}.helper-${updateId}`);
}

export function updateMarkerPath(installDir: string): string {
  const resolved = path.resolve(installDir);
  return path.join(path.dirname(resolved), `.ytmc-updating-${installIdFor(resolved)}.json`);
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

export function appendLog(filePath: string, line: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
}

export function directorySize(dir: string, maxEntries = Number.POSITIVE_INFINITY): number {
  let total = 0;
  let seen = 0;
  const stack: string[] = [dir];
  while (stack.length > 0 && seen < maxEntries) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen >= maxEntries) break;
      const full = path.join(current, entry.name);
      try {
        const stats = fs.lstatSync(full);
        if (stats.isSymbolicLink()) continue;
        if (stats.isDirectory()) stack.push(full);
        else if (stats.isFile()) total += stats.size;
      } catch {}
    }
  }
  return total;
}

const HELPER_RUNTIME_SKIP = new Set(['data', 'resources']);

function runtimeTreeBytes(source: string, root: boolean): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(source, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (root && HELPER_RUNTIME_SKIP.has(entry.name)) continue;
    const full = path.join(source, entry.name);
    try {
      const stats = fs.lstatSync(full);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) total += runtimeTreeBytes(full, false);
      else if (stats.isFile()) total += stats.size;
    } catch {}
  }
  return total;
}

export function helperRuntimeBytes(installDir: string): number {
  return runtimeTreeBytes(path.resolve(installDir), true);
}

export function supportsHardlinks(dir: string): boolean {
  const token = randomUUID().replace(/-/g, '').slice(0, 8);
  const source = path.join(dir, `.ytmc-link-${token}`);
  const target = path.join(dir, `.ytmc-link-${token}.target`);
  try {
    fs.writeFileSync(source, 'x');
    fs.linkSync(source, target);
    return true;
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(source, { force: true });
    } catch {}
    try {
      fs.rmSync(target, { force: true });
    } catch {}
  }
}

async function linkRuntimeTree(source: string, destination: string, root: boolean): Promise<void> {
  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (root && HELPER_RUNTIME_SKIP.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const stats = await fs.promises.lstat(from);
    if (stats.isSymbolicLink()) continue;
    if (stats.isDirectory()) {
      await linkRuntimeTree(from, to, false);
      continue;
    }
    if (!stats.isFile()) continue;
    try {
      await fs.promises.link(from, to);
    } catch {
      await fs.promises.copyFile(from, to);
    }
  }
}

export async function createHelperRuntime(installDir: string, helperDir: string): Promise<void> {
  if (fs.existsSync(helperDir) && !(await removePathWithRetries(helperDir))) {
    throw new Error('The previous helper folder is still locked.');
  }
  await fs.promises.mkdir(helperDir, { recursive: true });
  await linkRuntimeTree(path.resolve(installDir), helperDir, true);
}

export function staleSiblingTrees(installDir: string, keep: string[] = []): string[] {
  const resolved = path.resolve(installDir);
  const parent = path.dirname(resolved);
  const prefix = `${path.basename(resolved)}.`;
  const kept = new Set(keep.map(dir => path.resolve(dir)));
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(parent, entry.name))
      .filter(dir => {
        const suffix = path.basename(dir).slice(prefix.length);
        return (
          path.basename(dir).startsWith(prefix) &&
          /^(new|old|failed|helper)-\d+\.\d+\.\d+-[0-9a-f]{8}$/.test(suffix) &&
          !kept.has(dir)
        );
      });
  } catch {
    return [];
  }
}

export function staleUpdateMarkers(installDir: string): string[] {
  const resolved = path.resolve(installDir);
  const parent = path.dirname(resolved);
  const marker = path.basename(updateMarkerPath(resolved));
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name === marker)
      .map(entry => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

export function sanitizedEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return { ...env, ...overrides };
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function killProcessTree(pid: number, tree: boolean, force = true): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      const args = tree ? ['/T', '/PID', String(pid)] : ['/PID', String(pid)];
      if (force) args.splice(0, 0, '/F');
      spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {}
}

export function processImageName(pid: number): Promise<string | null> {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const child = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('exit', () => {
      const match = /^"([^"]+)"/.exec(output.trim());
      resolve(match ? match[1] : null);
    });
  });
}

interface InstallProcess {
  pid: number;
  name: string;
  path: string;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(script: string): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    );
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 10_000);
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', () => finish(null));
    child.on('exit', code => finish(code === 0 ? output.trim() : null));
  });
}

export async function processExecutablePath(pid: number): Promise<string | null> {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return null;
  const output = await runPowerShell(
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { $p.ExecutablePath } else { '' }`
  );
  return output && output.length > 0 ? output : null;
}

async function processesUnderInstall(installDir: string): Promise<InstallProcess[] | null> {
  if (process.platform !== 'win32') return [];
  const root = `${path.resolve(installDir)}${path.sep}`;
  const script = [
    `$root = ${powerShellQuote(root)}`,
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId, Name, ExecutablePath | ConvertTo-Json -Compress`,
  ].join('; ');
  const output = await runPowerShell(script);
  if (output === null) return null;
  if (output.length === 0) return [];
  try {
    const parsed = JSON.parse(output) as
      | { ProcessId?: unknown; Name?: unknown; ExecutablePath?: unknown }
      | Array<{ ProcessId?: unknown; Name?: unknown; ExecutablePath?: unknown }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map(row => ({
        pid: Number(row.ProcessId),
        name: typeof row.Name === 'string' ? row.Name : '',
        path: typeof row.ExecutablePath === 'string' ? row.ExecutablePath : '',
      }))
      .filter(row => Number.isInteger(row.pid) && row.pid > 0);
  } catch {
    return null;
  }
}

export async function sweepProcessesUnderInstall(
  installDir: string,
  excludePids: number[],
  timeoutMs = 15_000,
  log?: (line: string) => void
): Promise<boolean | null> {
  const excluded = new Set(excludePids.filter(pid => Number.isInteger(pid) && pid > 0));
  excluded.add(process.pid);
  const deadline = Date.now() + timeoutMs;
  let known = false;
  while (Date.now() < deadline) {
    const processes = await processesUnderInstall(installDir);
    if (processes === null) return known ? true : null;
    known = true;
    const targets = processes.filter(entry => !excluded.has(entry.pid));
    if (targets.length === 0) return true;
    for (const target of targets) {
      log?.(`stopping process ${target.pid} ${target.name}`);
      killProcessTree(target.pid, true);
    }
    await delay(500);
  }
  return known ? false : null;
}

export async function removePathWithRetries(
  target: string,
  attempts = 10,
  delayMs = 500
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    } catch {
      await delay(delayMs);
    }
  }
  return false;
}

export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await delay(200);
  }
  return !isProcessAlive(pid);
}

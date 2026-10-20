import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const LIBRARY_DIR_NAME = 'YT Music Converter';
export const WORKSPACE_FILES = {
  helper: 'updater-helper.cjs',
  archive: 'package.zip',
  pending: 'pending.json',
  journal: 'journal.json',
  state: 'state.json',
  lock: 'apply.lock',
  bootOk: 'boot-ok.json',
  log: 'updater.log',
} as const;

export function installIdFor(installDir: string): string {
  return createHash('sha256').update(installDir.toLowerCase()).digest('hex').slice(0, 16);
}

export function workspaceRoot(localAppDataDir: string, installId: string): string {
  return path.join(localAppDataDir, LIBRARY_DIR_NAME, 'updater', installId);
}

export function newUpdateId(version: string): string {
  return `${version}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
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

export function directorySize(dir: string): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  }
  return total;
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

export async function removeDirectoryWithRetries(
  dir: string,
  attempts = 10,
  delayMs = 500
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
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

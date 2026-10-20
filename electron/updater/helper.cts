import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { archiveInfo, extractArchive } from './extract.cjs';
import { hashFileHex, verifyDigestSignature } from './signature.cjs';
import {
  WORKSPACE_FILES,
  appendLog,
  delay,
  isProcessAlive,
  killProcessTree,
  processImageName,
  readJson,
  removeDirectoryWithRetries,
  sanitizedEnv,
  staleSiblingTrees,
  waitForProcessExit,
  writeJson,
} from './install.cjs';

process.noAsar = true;

export interface LaunchPort {
  launch(executable: string, args: string[], cwd: string): number;
  isAlive(pid: number): boolean;
}

export interface HelperOptions {
  workspace: string;
  installDir: string;
  archivePath: string;
  digestHex: string;
  signatureBase64: string;
  updateId: string;
  fromVersion: string;
  toVersion: string;
  exeName: string;
  appPid: number;
  backendPid: number;
  nonce: string;
  bootTimeoutMs?: number;
  livenessMs?: number;
  appExitTimeoutMs?: number;
  swapRetryMs?: number;
  launch: LaunchPort;
  log?: (line: string) => void;
}

export type ApplyOutcome =
  | { outcome: 'applied'; pid: number }
  | { outcome: 'aborted'; reason: string }
  | { outcome: 'rolled-back'; reason: string };

export interface BootReport {
  updateId?: unknown;
  version?: unknown;
  nonce?: unknown;
}

const APP_EXIT_TIMEOUT_MS = 60_000;
const DEFAULT_BOOT_TIMEOUT_MS = 300_000;
const DEFAULT_LIVENESS_MS = 10_000;
const POLL_INTERVAL_MS = 500;
const PROGRESS_INTERVAL_MS = 250;
const SWAP_RETRY_MS = 5_000;
const SWAP_RETRY_STEP_MS = 200;
const REQUIRED_TREE = [
  'resources/app.asar',
  'resources/server.cjs',
  'resources/bin/ffmpeg.exe',
  'resources/bin/yt-dlp.exe',
];
const CACHE_DIRECTORIES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'GrShaderCache',
  'Crashpad',
]);

export const realLaunchPort: LaunchPort = {
  launch(executable, args, cwd) {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: sanitizedEnv(),
    });
    child.unref();
    return child.pid ?? 0;
  },
  isAlive: isProcessAlive,
};

function validateTree(root: string, exeName: string): string | null {
  const required = [exeName, ...REQUIRED_TREE];
  for (const relative of required) {
    const full = path.join(root, relative);
    try {
      const stats = fs.statSync(full);
      if (!stats.isFile() || stats.size <= 0) return relative;
    } catch {
      return relative;
    }
  }
  return null;
}

function copyDataTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory() && CACHE_DIRECTORIES.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDataTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

async function renameWithRetries(from: string, to: string, timeoutMs: number): Promise<void> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / SWAP_RETRY_STEP_MS));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
      if (attempt < attempts - 1) await delay(SWAP_RETRY_STEP_MS);
    }
  }
  throw lastError;
}

async function launchWithRetries(
  port: LaunchPort,
  executable: string,
  args: string[],
  cwd: string
): Promise<number> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const pid = port.launch(executable, args, cwd);
      if (pid > 0) return pid;
      lastError = new Error('launch returned no pid');
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await delay(500);
  }
  throw lastError;
}

export async function runApply(options: HelperOptions): Promise<ApplyOutcome> {
  const installDir = path.resolve(options.installDir);
  const parentDir = path.dirname(installDir);
  const installName = path.basename(installDir);
  const newDir = path.join(parentDir, `${installName}.new-${options.updateId}`);
  const oldDir = path.join(parentDir, `${installName}.old-${options.updateId}`);
  const failedDir = path.join(parentDir, `${installName}.failed-${options.updateId}`);
  const journalPath = path.join(options.workspace, WORKSPACE_FILES.journal);
  const bootOkPath = path.join(options.workspace, WORKSPACE_FILES.bootOk);
  const lockPath = path.join(options.workspace, WORKSPACE_FILES.lock);
  const cancelPath = path.join(options.workspace, WORKSPACE_FILES.cancel);
  const logPath = path.join(options.workspace, WORKSPACE_FILES.log);
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const livenessMs = options.livenessMs ?? DEFAULT_LIVENESS_MS;
  const appExitTimeoutMs = options.appExitTimeoutMs ?? APP_EXIT_TIMEOUT_MS;
  const swapRetryMs = options.swapRetryMs ?? SWAP_RETRY_MS;
  const startedAt = Date.now();

  const log = (line: string) => {
    appendLog(logPath, line);
    options.log?.(line);
  };
  const mark = (label: string) => log(`${label} ${Date.now() - startedAt}ms`);
  let loggedPhase = '';
  const writePhase = (phase: string, extra: Record<string, unknown> = {}) => {
    writeJson(journalPath, {
      schema: 1,
      updateId: options.updateId,
      phase,
      installDir,
      newDir,
      oldDir,
      failedDir,
      fromVersion: options.fromVersion,
      toVersion: options.toVersion,
      at: Date.now(),
      ...extra,
    });
    if (phase !== loggedPhase) {
      loggedPhase = phase;
      log(`phase ${phase}`);
    }
  };
  const finish = <T extends ApplyOutcome>(outcome: T): T => {
    fs.rmSync(lockPath, { force: true });
    return outcome;
  };
  const relaunchOld = async () => {
    const executable = path.join(installDir, options.exeName);
    if (!fs.existsSync(executable)) return;
    try {
      await launchWithRetries(options.launch, executable, [], parentDir);
    } catch (error) {
      log(`relaunch after abort failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const abort = async (reason: string): Promise<ApplyOutcome> => {
    const outcome = finish({ outcome: 'aborted', reason });
    if (!isProcessAlive(options.appPid)) await relaunchOld();
    return outcome;
  };
  const fail = async (reason: string, detail?: string, restored = true): Promise<ApplyOutcome> => {
    writePhase('failed', {
      reason,
      ...(detail ? { detail } : {}),
      restored,
    });
    if (fs.existsSync(newDir)) await removeDirectoryWithRetries(newDir);
    return abort(reason);
  };

  log(`apply start update=${options.updateId} from=${options.fromVersion} to=${options.toVersion}`);
  writePhase('start', { percent: 1 });
  writeJson(lockPath, { pid: process.pid, updateId: options.updateId, at: Date.now() });

  for (const dir of staleSiblingTrees(installDir, [newDir, oldDir, failedDir])) {
    if (await removeDirectoryWithRetries(dir)) log(`removed stale tree ${path.basename(dir)}`);
  }

  writePhase('verifying', { percent: 2 });
  const archiveDigest = await hashFileHex(options.archivePath);
  if (archiveDigest !== options.digestHex) {
    return fail('archive-digest-mismatch');
  }
  const signature = verifyDigestSignature(archiveDigest, options.signatureBase64);
  if (!signature.ok) {
    return fail(`archive-signature-${signature.reason}`, signature.reason);
  }
  const info = await archiveInfo(options.archivePath);
  if (!info) {
    return fail('archive-unreadable');
  }
  mark('verify');

  if (!(await removeDirectoryWithRetries(newDir))) {
    return fail('new-tree-cleanup-failed', newDir);
  }
  writePhase('extracting', {
    percent: 2,
    bytes: 0,
    totalBytes: info.bytes,
    entries: 0,
    totalEntries: info.entries,
  });
  let lastProgressAt = 0;
  const extracted = await extractArchive(options.archivePath, newDir, {
    totalBytes: info.bytes,
    totalEntries: info.entries,
    onProgress: progress => {
      const now = Date.now();
      if (now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
      lastProgressAt = now;
      const percent =
        progress.totalBytes > 0
          ? Math.min(85, 2 + Math.floor((progress.bytes / progress.totalBytes) * 83))
          : null;
      writePhase('extracting', {
        percent,
        bytes: progress.bytes,
        totalBytes: progress.totalBytes,
        entries: progress.entries,
        totalEntries: progress.totalEntries,
      });
    },
  });
  if (!extracted.ok) {
    const reason = `extract-${extracted.reason}`;
    log(`extract failed: ${reason}${extracted.detail ? ` (${extracted.detail})` : ''}`);
    return fail(reason, extracted.detail);
  }
  mark('extract');
  writePhase('validating', { percent: 86 });
  const missing = validateTree(newDir, options.exeName);
  if (missing) {
    return fail(`tree-invalid-${missing}`, missing);
  }
  mark('validate');

  writePhase('pre-swap', { percent: 90 });
  const deadline = Date.now() + appExitTimeoutMs;
  let appState: 'exited' | 'cancelled' | 'timeout' = 'timeout';
  while (Date.now() < deadline) {
    if (fs.existsSync(cancelPath)) {
      appState = 'cancelled';
      break;
    }
    if (!isProcessAlive(options.appPid)) {
      appState = 'exited';
      break;
    }
    await delay(200);
  }
  if (appState === 'cancelled') {
    if (!(await removeDirectoryWithRetries(newDir))) {
      log(`cancel cleanup failed: ${newDir}`);
    }
    try {
      fs.rmSync(cancelPath, { force: true });
    } catch (error) {
      log(
        `cancel marker cleanup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    writePhase('cancelled', { reason: 'conversion-active' });
    return finish({ outcome: 'aborted', reason: 'conversion-active' });
  }
  if (appState === 'timeout') {
    const image = await processImageName(options.appPid);
    log(`app pid ${options.appPid} still alive image=${image ?? 'unknown'}`);
    killProcessTree(options.appPid, false);
    if (!(await waitForProcessExit(options.appPid, 30_000))) {
      return fail('app-still-running');
    }
  }
  try {
    fs.rmSync(cancelPath, { force: true });
  } catch (error) {
    log(`cancel marker cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  mark('app exit');

  if (options.backendPid > 0 && isProcessAlive(options.backendPid)) {
    killProcessTree(options.backendPid, true);
    if (!(await waitForProcessExit(options.backendPid, 15_000))) {
      return fail('backend-still-running');
    }
  }
  mark('backend exit');

  writePhase('copying', { percent: 92 });
  const dataDir = path.join(installDir, 'data');
  if (fs.existsSync(dataDir)) {
    try {
      copyDataTree(dataDir, path.join(newDir, 'data'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log(`data copy failed: ${detail}`);
      return fail('data-copy-failed', detail);
    }
  }
  mark('copy');

  writePhase('installing', { percent: 96 });
  if (!(await removeDirectoryWithRetries(oldDir))) {
    return fail('old-tree-remove-failed', oldDir, true);
  }
  try {
    await renameWithRetries(installDir, oldDir, swapRetryMs);
    await renameWithRetries(newDir, installDir, swapRetryMs);
  } catch (error) {
    let restored = false;
    if (fs.existsSync(oldDir) && !fs.existsSync(installDir)) {
      try {
        await renameWithRetries(oldDir, installDir, swapRetryMs);
      } catch (restoreError) {
        log(
          `swap restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
        );
      }
    }
    restored = fs.existsSync(path.join(installDir, options.exeName));
    const detail = error instanceof Error ? error.message : String(error);
    log(`swap failed: ${detail} restored=${restored}`);
    return fail('swap-failed', detail, restored);
  }
  mark('swap');

  const executable = path.join(installDir, options.exeName);
  writePhase('launched', { percent: 99 });
  let pid = 0;

  const rollback = async (reason: string, detail?: string): Promise<ApplyOutcome> => {
    log(`rollback reason=${reason}`);
    if (pid > 0) {
      const image = await processImageName(pid);
      if (isProcessAlive(pid) && (image === null || /music converter|electron/i.test(image))) {
        killProcessTree(pid, true);
        await waitForProcessExit(pid, 15_000);
      }
    }
    try {
      if (!fs.existsSync(oldDir)) throw new Error('old tree is missing');
      if (fs.existsSync(installDir)) {
        await removeDirectoryWithRetries(failedDir);
        await renameWithRetries(installDir, failedDir, swapRetryMs);
      }
      await renameWithRetries(oldDir, installDir, swapRetryMs);
    } catch (error) {
      const restoreDetail = error instanceof Error ? error.message : String(error);
      log(`rollback rename failed: ${restoreDetail}`);
      writePhase('failed', { reason: 'rollback-failed', detail: restoreDetail });
      return finish({ outcome: 'rolled-back', reason: 'rollback-failed' });
    }
    writePhase('rolled-back', { reason, ...(detail ? { detail } : {}) });
    try {
      await launchWithRetries(
        options.launch,
        path.join(installDir, options.exeName),
        [],
        parentDir
      );
    } catch (error) {
      log(`relaunch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return finish({ outcome: 'rolled-back', reason });
  };

  try {
    fs.rmSync(bootOkPath, { force: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return rollback('boot-report-cleanup-failed', detail);
  }

  try {
    pid = await launchWithRetries(
      options.launch,
      executable,
      [
        `--ytmc-update-id=${options.updateId}`,
        `--ytmc-update-version=${options.toVersion}`,
        `--ytmc-update-nonce=${options.nonce}`,
        `--ytmc-update-report=${bootOkPath}`,
      ],
      parentDir
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return rollback('launch-failed', detail);
  }
  log(`launched ${executable} pid=${pid}`);

  const bootDeadline = Date.now() + bootTimeoutMs;
  let sawAlive = false;
  while (Date.now() < bootDeadline) {
    const report = readJson<BootReport>(bootOkPath);
    if (report) {
      if (report.updateId !== options.updateId) return rollback('boot-report-mismatch');
      if (report.version !== options.toVersion) return rollback('boot-version-mismatch');
      if (report.nonce !== options.nonce) return rollback('boot-nonce-mismatch');
      await delay(livenessMs);
      if (!options.launch.isAlive(pid)) return rollback('app-died-after-boot');
      writePhase('boot-ok', { percent: 100 });
      log('apply success');
      return finish({ outcome: 'applied', pid });
    }
    if (options.launch.isAlive(pid)) {
      sawAlive = true;
    } else if (sawAlive) {
      return rollback('app-exited');
    }
    await delay(POLL_INTERVAL_MS);
  }
  return rollback('boot-timeout');
}

export interface HelperCliOptions extends Omit<HelperOptions, 'launch' | 'log'> {}

export function parseHelperArgs(argv: string[]): HelperCliOptions | null {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) continue;
    values.set(token.slice(2), next);
    index += 1;
  }
  const read = (name: string): string | null => values.get(name) ?? null;
  const installDir = read('install');
  const workspace = read('workspace');
  const archivePath = read('archive');
  const digestHex = read('digest');
  const signatureBase64 = read('signature');
  const updateId = read('update-id');
  const fromVersion = read('from');
  const toVersion = read('to');
  const exeName = read('exe');
  const nonce = read('nonce');
  if (
    !installDir ||
    !workspace ||
    !archivePath ||
    !digestHex ||
    !signatureBase64 ||
    !updateId ||
    !fromVersion ||
    !toVersion ||
    !exeName ||
    !nonce
  ) {
    return null;
  }
  return {
    workspace,
    installDir,
    archivePath,
    digestHex,
    signatureBase64,
    updateId,
    fromVersion,
    toVersion,
    exeName,
    nonce,
    appPid: Number(read('app-pid') ?? '0') || 0,
    backendPid: Number(read('backend-pid') ?? '0') || 0,
    bootTimeoutMs: Number(read('boot-timeout') ?? '') || undefined,
    livenessMs: Number(read('liveness') ?? '') || undefined,
    appExitTimeoutMs: Number(read('app-exit-timeout') ?? '') || undefined,
    swapRetryMs: Number(read('swap-retry') ?? '') || undefined,
  };
}

async function main(): Promise<void> {
  const options = parseHelperArgs(process.argv.slice(1));
  if (!options) {
    process.exitCode = 2;
    return;
  }
  const outcome = await runApply({ ...options, launch: realLaunchPort });
  process.exitCode = outcome.outcome === 'applied' ? 0 : 1;
}

if (require.main === module) {
  void main();
}

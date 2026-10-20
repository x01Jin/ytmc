import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractArchive } from './extract.cjs';
import { hashFileHex, verifyDigestSignature } from './signature.cjs';
import {
  WORKSPACE_FILES,
  appendLog,
  delay,
  isProcessAlive,
  killProcessTree,
  processImageName,
  readJson,
  sanitizedEnv,
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
const REQUIRED_TREE = [
  'resources/app.asar',
  'resources/server.cjs',
  'resources/bin/ffmpeg.exe',
  'resources/bin/yt-dlp.exe',
];

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
  const logPath = path.join(options.workspace, WORKSPACE_FILES.log);
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const livenessMs = options.livenessMs ?? DEFAULT_LIVENESS_MS;

  const log = (line: string) => {
    appendLog(logPath, line);
    options.log?.(line);
  };
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
  };
  const finish = <T extends ApplyOutcome>(outcome: T): T => {
    fs.rmSync(lockPath, { force: true });
    return outcome;
  };
  const relaunchOld = () => {
    const executable = path.join(installDir, options.exeName);
    if (!fs.existsSync(executable)) return;
    try {
      options.launch.launch(executable, [], installDir);
    } catch (error) {
      log(`relaunch after abort failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const abort = (reason: string): ApplyOutcome => {
    const outcome = finish({ outcome: 'aborted', reason });
    if (reason !== 'app-still-running') relaunchOld();
    return outcome;
  };

  log(`apply start update=${options.updateId} from=${options.fromVersion} to=${options.toVersion}`);
  writePhase('start');

  const appExited = await waitForProcessExit(options.appPid, APP_EXIT_TIMEOUT_MS);
  if (!appExited) {
    const image = await processImageName(options.appPid);
    log(`app pid ${options.appPid} still alive image=${image ?? 'unknown'}`);
    killProcessTree(options.appPid, false);
    if (!(await waitForProcessExit(options.appPid, 30_000))) {
      writePhase('failed', { reason: 'app-still-running' });
      return abort('app-still-running');
    }
  }
  if (options.backendPid > 0 && isProcessAlive(options.backendPid)) {
    killProcessTree(options.backendPid, true);
    await waitForProcessExit(options.backendPid, 15_000);
  }

  const archiveDigest = await hashFileHex(options.archivePath);
  if (archiveDigest !== options.digestHex) {
    writePhase('failed', { reason: 'archive-digest-mismatch' });
    return abort('archive-digest-mismatch');
  }
  const signature = verifyDigestSignature(archiveDigest, options.signatureBase64);
  if (!signature.ok) {
    writePhase('failed', { reason: `archive-signature-${signature.reason}` });
    return abort('archive-signature-invalid');
  }

  fs.rmSync(newDir, { recursive: true, force: true });
  const extracted = await extractArchive(options.archivePath, newDir);
  if (!extracted.ok) {
    fs.rmSync(newDir, { recursive: true, force: true });
    const reason = `extract-${extracted.reason}`;
    log(`extract failed: ${reason}${extracted.detail ? ` (${extracted.detail})` : ''}`);
    writePhase('failed', {
      reason,
      ...(extracted.detail ? { detail: extracted.detail } : {}),
    });
    return abort(reason);
  }
  log(`extracted ${extracted.entries} entries, ${extracted.bytes} bytes`);
  const missing = validateTree(newDir, options.exeName);
  if (missing) {
    fs.rmSync(newDir, { recursive: true, force: true });
    const reason = `tree-invalid-${missing}`;
    writePhase('failed', { reason });
    return abort(reason);
  }

  const dataDir = path.join(installDir, 'data');
  if (fs.existsSync(dataDir)) {
    fs.cpSync(dataDir, path.join(newDir, 'data'), { recursive: true });
  }

  writePhase('pre-swap');
  let swapped = false;
  try {
    fs.rmSync(oldDir, { recursive: true, force: true });
    fs.renameSync(installDir, oldDir);
    fs.renameSync(newDir, installDir);
    swapped = true;
  } catch (error) {
    if (swapped) {
      try {
        fs.renameSync(installDir, newDir);
        fs.renameSync(oldDir, installDir);
      } catch {}
    } else if (fs.existsSync(oldDir) && !fs.existsSync(installDir)) {
      try {
        fs.renameSync(oldDir, installDir);
      } catch {}
    }
    const reason = error instanceof Error ? error.message : String(error);
    writePhase('failed', { reason: 'swap-failed', detail: reason });
    return abort('swap-failed');
  }

  const executable = path.join(installDir, options.exeName);
  writePhase('launched');
  fs.rmSync(bootOkPath, { force: true });
  const pid = options.launch.launch(
    executable,
    [
      `--ytmc-update-id=${options.updateId}`,
      `--ytmc-update-version=${options.toVersion}`,
      `--ytmc-update-nonce=${options.nonce}`,
      `--ytmc-update-report=${bootOkPath}`,
    ],
    installDir
  );
  log(`launched ${executable} pid=${pid}`);

  const rollback = async (reason: string): Promise<ApplyOutcome> => {
    log(`rollback reason=${reason}`);
    const image = await processImageName(pid);
    if (isProcessAlive(pid) && (image === null || /music converter|electron/i.test(image))) {
      killProcessTree(pid, true);
      await waitForProcessExit(pid, 15_000);
    }
    try {
      if (fs.existsSync(oldDir)) {
        if (fs.existsSync(installDir)) {
          fs.rmSync(failedDir, { recursive: true, force: true });
          fs.renameSync(installDir, failedDir);
        }
        fs.renameSync(oldDir, installDir);
      }
    } catch (error) {
      log(`rollback rename failed: ${error instanceof Error ? error.message : String(error)}`);
      writePhase('failed', { reason: 'rollback-failed', detail: reason });
      return finish({ outcome: 'rolled-back', reason: 'rollback-failed' });
    }
    writePhase('rolled-back', { reason });
    try {
      options.launch.launch(path.join(installDir, options.exeName), [], installDir);
    } catch (error) {
      log(`relaunch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return finish({ outcome: 'rolled-back', reason });
  };

  const deadline = Date.now() + bootTimeoutMs;
  let sawAlive = false;
  while (Date.now() < deadline) {
    const report = readJson<BootReport>(bootOkPath);
    if (report) {
      if (report.updateId !== options.updateId) return rollback('boot-report-mismatch');
      if (report.version !== options.toVersion) return rollback('boot-version-mismatch');
      if (report.nonce !== options.nonce) return rollback('boot-nonce-mismatch');
      await delay(livenessMs);
      if (!options.launch.isAlive(pid)) return rollback('app-died-after-boot');
      writePhase('boot-ok');
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

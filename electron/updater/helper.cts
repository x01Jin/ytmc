import { execFileSync, spawn } from 'node:child_process';
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
  processExecutablePath,
  processImageName,
  readJson,
  removeDirectoryWithRetries,
  sanitizedEnv,
  staleSiblingTrees,
  sweepProcessesUnderInstall,
  updateMarkerPath,
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
  helperDir?: string;
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
  watchdog?: boolean;
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
  visible?: unknown;
}

const APP_EXIT_TIMEOUT_MS = 60_000;
const DEFAULT_BOOT_TIMEOUT_MS = 300_000;
const DEFAULT_LIVENESS_MS = 10_000;
const POLL_INTERVAL_MS = 500;
const PROGRESS_INTERVAL_MS = 250;
const SWAP_RETRY_MS = 60_000;
const SWAP_RETRY_STEP_MS = 250;
const SWAP_LOG_INTERVAL_MS = 5_000;
const OLD_TREE_RETENTION_MS = 24 * 60 * 60 * 1000;
const WATCHDOG_SCRIPT = 'recover-update.ps1';
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
      windowsHide: false,
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

function isInsidePath(child: string, parent: string): boolean {
  const childPath = path.resolve(child).toLowerCase();
  const parentPath = path.resolve(parent).toLowerCase();
  return childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`);
}

function copyDataTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory() && CACHE_DIRECTORIES.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const stats = fs.lstatSync(from);
    if (stats.isSymbolicLink()) {
      let target: fs.Stats;
      try {
        target = fs.statSync(from);
      } catch {
        continue;
      }
      if (target.isDirectory()) {
        fs.symlinkSync(fs.readlinkSync(from), to, 'junction');
      } else {
        fs.copyFileSync(from, to);
      }
      continue;
    }
    if (stats.isDirectory()) copyDataTree(from, to);
    else if (stats.isFile()) fs.copyFileSync(from, to);
  }
}

async function renameWithRetries(
  from: string,
  to: string,
  timeoutMs: number,
  log?: (line: string) => void
): Promise<void> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / SWAP_RETRY_STEP_MS));
  let lastError: unknown = null;
  let lastLoggedAt = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
      const now = Date.now();
      if (log && now - lastLoggedAt >= SWAP_LOG_INTERVAL_MS) {
        lastLoggedAt = now;
        log(`rename waiting ${path.basename(from)} -> ${path.basename(to)}: ${code}`);
      }
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

export const WATCHDOG_SOURCE = `param(
  [string]$Install,
  [string]$Old,
  [string]$New,
  [string]$HelperDir,
  [string]$Exe,
  [string]$Marker,
  [string]$Lock,
  [string]$Log,
  [string]$Journal,
  [string]$Failed,
  [string]$BootOk,
  [int]$HelperPid = 0,
  [int]$BootWaitSeconds = 300,
  [switch]$RecoverOnly
)
$ErrorActionPreference = 'SilentlyContinue'
$runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
function Write-Log([string]$Message) {
  Add-Content -LiteralPath $Log -Value "$(Get-Date -Format o) watchdog $Message"
}
function Remove-Tree([string]$Path) {
  if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
}
function Remove-RunEntry {
  reg.exe delete $runKey /v YTMCUpdateRecovery /f | Out-Null
}
function Finish([string]$Reason) {
  Write-Log $Reason
  Remove-Tree $Marker
  Remove-Tree $Lock
  Remove-Tree $HelperDir
  Remove-RunEntry
  exit 0
}
$installExe = Join-Path $Install $Exe
$installRoot = $Install.TrimEnd('\\') + '\\'
if (-not $Failed) { $Failed = $Install + '.failed-recovery' }
function Read-Phase {
  if (-not (Test-Path -LiteralPath $Journal)) { return '' }
  try { return (Get-Content -LiteralPath $Journal -Raw | ConvertFrom-Json).phase } catch { return '' }
}
function Test-BootOk {
  if (-not (Test-Path -LiteralPath $BootOk)) { return $false }
  try {
    $report = Get-Content -LiteralPath $BootOk -Raw | ConvertFrom-Json
    if ($report.visible -ne $true) { return $false }
    if (Test-Path -LiteralPath $Journal) {
      $state = Get-Content -LiteralPath $Journal -Raw | ConvertFrom-Json
      if ($state.updateId -and $report.updateId -and ($state.updateId -ne $report.updateId)) {
        return $false
      }
    }
    return $true
  } catch { return $false }
}
function Stop-App {
  Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}
function Restore-Tree([string]$Source) {
  if (-not (Test-Path -LiteralPath $Source)) { return $false }
  Stop-App
  if (Test-Path -LiteralPath $Install) {
    Remove-Tree $Failed
    for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
      Rename-Item -LiteralPath $Install -NewName (Split-Path -Leaf $Failed)
      if (-not (Test-Path -LiteralPath $Install)) { break }
      Start-Sleep -Milliseconds 500
    }
    if (Test-Path -LiteralPath $Install) { return $false }
  }
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    Rename-Item -LiteralPath $Source -NewName (Split-Path -Leaf $Install)
    if (Test-Path -LiteralPath $installExe) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}
function Start-App {
  if (-not (Test-Path -LiteralPath $installExe)) { return }
  if ((Read-Phase) -eq 'boot-ok') { return }
  Remove-Tree $Marker
  Remove-Tree $Lock
  $running = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath -ieq $installExe
  })
  if ($running.Count -eq 0) {
    Start-Process -FilePath $installExe -WorkingDirectory (Split-Path -Parent $Install) -WindowStyle Normal
    Write-Log 'launched app'
  }
}
if ($RecoverOnly -and (Test-Path -LiteralPath $Lock)) {
  try {
    $lockState = Get-Content -LiteralPath $Lock -Raw | ConvertFrom-Json
    $lockProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($lockState.pid)"
    if ($lockProcess -and $lockState.helperDir -and $lockProcess.ExecutablePath -and $lockProcess.ExecutablePath.StartsWith(($lockState.helperDir.TrimEnd('\\') + '\\'), [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-Log 'helper still running; leaving recovery to the next logon'
      exit 0
    }
  } catch {}
}
if (-not $RecoverOnly -and $HelperPid -gt 0) {
  $helper = Get-CimInstance Win32_Process -Filter "ProcessId = $HelperPid"
  $helperStart = $helper.CreationDate
  $deadline = (Get-Date).AddMinutes(45)
  while ((Get-Date) -lt $deadline) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $HelperPid"
    if ($null -eq $current) { break }
    if ($null -ne $helperStart -and $current.CreationDate -ne $helperStart) { break }
    Start-Sleep -Milliseconds 500
  }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $HelperPid"
  if ($null -ne $current) {
    if ($null -eq $helperStart -or $current.CreationDate -eq $helperStart) {
      Write-Log 'helper exceeded the recovery window; stopping it'
      Stop-Process -Id $HelperPid -Force
      Start-Sleep -Seconds 2
    } else {
      Write-Log 'helper pid was reused; leaving it alone'
      exit 0
    }
  }
}
if (Test-Path -LiteralPath $installExe) {
  if ((Read-Phase) -eq 'launched' -and (Test-Path -LiteralPath $Old)) {
    Start-App
    $booted = $false
    $waited = 0
    while ($waited -lt $BootWaitSeconds) {
      if (Test-BootOk) { $booted = $true; break }
      Start-Sleep -Seconds 2
      $waited += 2
    }
    if (($BootWaitSeconds -le 0) -and (Test-BootOk)) { $booted = $true }
    if (-not $booted) {
      Write-Log 'boot confirmation missing; restoring previous tree'
      if (-not (Restore-Tree $Old)) {
        Write-Log 'repair failed; keeping recovery entry for the next logon'
        exit 1
      }
      Remove-Tree $Marker
      Remove-Tree $Lock
      Remove-Tree $HelperDir
      Remove-RunEntry
      Start-App
      exit 0
    }
  }
  Start-App
  Finish 'install is present'
}
Write-Log 'install is missing; repairing'
$source = $null
if (Test-Path -LiteralPath $Old) { $source = $Old }
elseif (Test-Path -LiteralPath $New) { $source = $New }
if ($null -eq $source) { Finish 'no tree available' }
if (-not (Restore-Tree $source)) {
  Write-Log 'repair failed; keeping recovery entry for the next logon'
  exit 1
}
Remove-Tree $Marker
Remove-Tree $Lock
Remove-Tree $HelperDir
Remove-RunEntry
Start-App
exit 0
`;

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function runReg(args: string[]): void {
  try {
    execFileSync('reg.exe', args, { stdio: 'ignore', windowsHide: true, timeout: 5000 });
  } catch {}
}

function watchdogArgs(
  scriptPath: string,
  installDir: string,
  oldDir: string,
  newDir: string,
  helperDir: string,
  exeName: string,
  markerPath: string,
  lockPath: string,
  logPath: string,
  journalPath: string,
  failedDir: string,
  bootOkPath: string,
  helperPid: number,
  recoverOnly: boolean
): string[] {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    scriptPath,
    '-Install',
    installDir,
    '-Old',
    oldDir,
    '-New',
    newDir,
    '-HelperDir',
    helperDir,
    '-Exe',
    exeName,
    '-Marker',
    markerPath,
    '-Lock',
    lockPath,
    '-Log',
    logPath,
    '-Journal',
    journalPath,
    '-Failed',
    failedDir,
    '-BootOk',
    bootOkPath,
  ];
  if (recoverOnly) args.push('-RecoverOnly');
  else args.push('-HelperPid', String(helperPid));
  return args;
}

export function startDetachedPowerShell(commandLine: string): number {
  const script = [
    `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${commandLine.replace(/'/g, "''")}' }`,
    'if ($result.ReturnValue -ne 0) { exit 1 }',
    '$result.ProcessId',
  ].join('; ');
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true }
  ).trim();
  const pid = Number(output);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('WMI returned no process id.');
  return pid;
}

function startWatchdog(
  options: HelperOptions,
  installDir: string,
  oldDir: string,
  newDir: string,
  scriptPath: string,
  markerPath: string,
  lockPath: string,
  logPath: string,
  journalPath: string,
  log: (line: string) => void
): boolean {
  const helperDir = options.helperDir ?? '';
  const resolvedInstall = path.resolve(installDir);
  const failedDir = path.join(
    path.dirname(resolvedInstall),
    `${path.basename(resolvedInstall)}.failed-${options.updateId}`
  );
  const bootOkPath = path.join(options.workspace, WORKSPACE_FILES.bootOk);
  const command = [
    'powershell.exe',
    ...watchdogArgs(
      scriptPath,
      installDir,
      oldDir,
      newDir,
      helperDir,
      options.exeName,
      markerPath,
      lockPath,
      logPath,
      journalPath,
      failedDir,
      bootOkPath,
      process.pid,
      false
    ),
  ]
    .map(quoteArg)
    .join(' ');
  runReg([
    'add',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '/v',
    'YTMCUpdateRecovery',
    '/t',
    'REG_SZ',
    '/d',
    command,
    '/f',
  ]);
  try {
    const detachedArgs = watchdogArgs(
      scriptPath,
      installDir,
      oldDir,
      newDir,
      helperDir,
      options.exeName,
      markerPath,
      lockPath,
      logPath,
      journalPath,
      failedDir,
      bootOkPath,
      process.pid,
      false
    );
    const commandLine = ['powershell.exe', ...detachedArgs].map(quoteArg).join(' ');
    const pid = startDetachedPowerShell(commandLine);
    log(`watchdog started pid=${pid}`);
    return true;
  } catch (error) {
    log(`watchdog start failed: ${error instanceof Error ? error.message : String(error)}`);
    stopWatchdog(log);
    return false;
  }
}

function stopWatchdog(log: (line: string) => void): void {
  runReg([
    'delete',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '/v',
    'YTMCUpdateRecovery',
    '/f',
  ]);
  log('watchdog recovery entry removed');
}

async function runApplyInner(options: HelperOptions): Promise<ApplyOutcome> {
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
  const watchdogEnabled = options.watchdog ?? process.platform === 'win32';
  const markerPath = updateMarkerPath(installDir);
  const watchdogPath = path.join(options.workspace, WATCHDOG_SCRIPT);
  const startedAt = Date.now();
  let watchdogStarted = false;
  let preserveRecovery = false;

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
      helperDir: options.helperDir ?? '',
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
    if (!preserveRecovery) {
      fs.rmSync(lockPath, { force: true });
      fs.rmSync(markerPath, { force: true });
      if (watchdogStarted) stopWatchdog(log);
      watchdogStarted = false;
    }
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
    if (!restored) preserveRecovery = true;
    if (restored && fs.existsSync(newDir)) await removeDirectoryWithRetries(newDir);
    return abort(reason);
  };

  log(`apply start update=${options.updateId} from=${options.fromVersion} to=${options.toVersion}`);
  writePhase('start', { percent: 1 });
  writeJson(lockPath, {
    pid: process.pid,
    updateId: options.updateId,
    at: Date.now(),
    helperDir: options.helperDir ?? '',
  });

  const keptTrees = [newDir, oldDir, failedDir, options.helperDir ?? ''];
  const prefixLength = installName.length + 1;
  for (const dir of staleSiblingTrees(installDir, keptTrees)) {
    const suffix = path.basename(dir).slice(prefixLength);
    if (suffix.startsWith('old-')) {
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs < OLD_TREE_RETENTION_MS) continue;
      } catch {
        continue;
      }
    }
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

  if (watchdogEnabled) {
    try {
      fs.writeFileSync(watchdogPath, WATCHDOG_SOURCE, 'utf8');
      writeJson(markerPath, {
        pid: process.pid,
        updateId: options.updateId,
        installDir,
        at: Date.now(),
      });
      watchdogStarted = startWatchdog(
        options,
        installDir,
        oldDir,
        newDir,
        watchdogPath,
        markerPath,
        lockPath,
        logPath,
        journalPath,
        log
      );
      if (!watchdogStarted) {
        return fail('recovery-unavailable', 'watchdog start failed', true);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log(`watchdog setup failed: ${detail}`);
      return fail('recovery-unavailable', detail);
    }
  }

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
    const executable = await processExecutablePath(options.appPid);
    const owned = executable === null ? null : isInsidePath(executable, installDir);
    log(`app pid ${options.appPid} still alive image=${image ?? 'unknown'} owned=${owned}`);
    if (
      owned === true ||
      (owned === null && (image === null || /music converter|electron/i.test(image)))
    ) {
      killProcessTree(options.appPid, true);
      if (!(await waitForProcessExit(options.appPid, 30_000))) {
        return fail('app-still-running');
      }
    }
  }
  try {
    fs.rmSync(cancelPath, { force: true });
  } catch (error) {
    log(`cancel marker cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  mark('app exit');

  if (options.backendPid > 0 && isProcessAlive(options.backendPid)) {
    const executable = await processExecutablePath(options.backendPid);
    const owned = executable === null ? null : isInsidePath(executable, installDir);
    log(`backend pid ${options.backendPid} owned=${owned}`);
    if (owned === true) {
      killProcessTree(options.backendPid, true);
      if (!(await waitForProcessExit(options.backendPid, 15_000))) {
        return fail('backend-still-running');
      }
    }
  }
  mark('backend exit');

  const swept = await sweepProcessesUnderInstall(installDir, [process.pid], 15_000, log);
  if (swept === false) {
    return fail('app-still-running', undefined, true);
  }
  if (swept === null) log('process sweep unavailable');
  mark('process sweep');

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

  const lateSweep = await sweepProcessesUnderInstall(installDir, [process.pid], 15_000, log);
  if (lateSweep === false) {
    return fail('app-still-running');
  }
  if (lateSweep === null) log('late process sweep unavailable');

  writePhase('installing', { percent: 96 });
  if (!(await removeDirectoryWithRetries(oldDir))) {
    return fail('old-tree-remove-failed', oldDir, true);
  }
  if (fs.existsSync(oldDir)) {
    return fail('old-tree-remove-failed', oldDir, true);
  }
  try {
    await renameWithRetries(installDir, oldDir, swapRetryMs, log);
    await renameWithRetries(newDir, installDir, swapRetryMs, log);
  } catch (error) {
    let restored = false;
    if (fs.existsSync(oldDir) && !fs.existsSync(installDir)) {
      try {
        await renameWithRetries(oldDir, installDir, swapRetryMs, log);
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
      const executable = await processExecutablePath(pid);
      const owned = executable === null ? null : isInsidePath(executable, installDir);
      const matches =
        owned === true ||
        (owned === null && image !== null && /music converter|electron/i.test(image));
      if (isProcessAlive(pid) && matches) {
        killProcessTree(pid, true);
        await waitForProcessExit(pid, 15_000);
      }
    }
    await sweepProcessesUnderInstall(installDir, [process.pid], 15_000, log);
    try {
      if (!fs.existsSync(oldDir)) throw new Error('old tree is missing');
      if (fs.existsSync(installDir)) {
        await removeDirectoryWithRetries(failedDir);
        await renameWithRetries(installDir, failedDir, swapRetryMs, log);
      }
      await renameWithRetries(oldDir, installDir, swapRetryMs, log);
    } catch (error) {
      const restoreDetail = error instanceof Error ? error.message : String(error);
      log(`rollback rename failed: ${restoreDetail}`);
      writePhase('failed', { reason: 'rollback-failed', detail: restoreDetail });
      preserveRecovery = true;
      return finish({ outcome: 'rolled-back', reason: 'rollback-failed' });
    }
    writePhase('rolled-back', { reason, ...(detail ? { detail } : {}) });
    fs.rmSync(markerPath, { force: true });
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
  const launchedAt = Date.now();
  let sawAlive = false;
  while (Date.now() < bootDeadline) {
    const report = readJson<BootReport>(bootOkPath);
    if (report) {
      if (report.updateId !== options.updateId) return rollback('boot-report-mismatch');
      if (report.version !== options.toVersion) return rollback('boot-version-mismatch');
      if (report.nonce !== options.nonce) return rollback('boot-nonce-mismatch');
      if (report.visible !== true) return rollback('boot-window-hidden');
      await delay(livenessMs);
      if (!options.launch.isAlive(pid)) return rollback('app-died-after-boot');
      writePhase('boot-ok', { percent: 100 });
      log('apply success');
      return finish({ outcome: 'applied', pid });
    }
    if (options.launch.isAlive(pid)) {
      sawAlive = true;
    } else if (sawAlive || Date.now() - launchedAt > 15_000) {
      return rollback('app-exited');
    }
    await delay(POLL_INTERVAL_MS);
  }
  return rollback('boot-timeout');
}

export async function runApply(options: HelperOptions): Promise<ApplyOutcome> {
  try {
    return await runApplyInner(options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const installDir = path.resolve(options.installDir);
    const parentDir = path.dirname(installDir);
    const installName = path.basename(installDir);
    const newDir = path.join(parentDir, `${installName}.new-${options.updateId}`);
    const oldDir = path.join(parentDir, `${installName}.old-${options.updateId}`);
    const failedDir = path.join(parentDir, `${installName}.failed-${options.updateId}`);
    const journalPath = path.join(options.workspace, WORKSPACE_FILES.journal);
    const logPath = path.join(options.workspace, WORKSPACE_FILES.log);
    appendLog(logPath, `helper crashed: ${detail}`);
    const installExe = path.join(installDir, options.exeName);
    const swapCompleted =
      fs.existsSync(installExe) && fs.existsSync(oldDir) && !fs.existsSync(newDir);
    if (swapCompleted) {
      const journal = readJson<{ phase?: string }>(journalPath);
      if (journal?.phase === 'boot-ok') {
        fs.rmSync(path.join(options.workspace, WORKSPACE_FILES.lock), { force: true });
        fs.rmSync(updateMarkerPath(installDir), { force: true });
        return { outcome: 'applied', pid: 0 };
      }
      await sweepProcessesUnderInstall(installDir, [process.pid], 15_000, (line: string) =>
        appendLog(logPath, line)
      );
      let restored = false;
      try {
        if (fs.existsSync(installDir)) {
          await removeDirectoryWithRetries(failedDir);
          await renameWithRetries(installDir, failedDir, 10_000);
        }
        await renameWithRetries(oldDir, installDir, 10_000);
        restored = fs.existsSync(installExe);
      } catch (restoreError) {
        appendLog(
          logPath,
          `helper crash rollback failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
        );
      }
      try {
        writeJson(journalPath, {
          schema: 1,
          updateId: options.updateId,
          phase: 'rolled-back',
          installDir,
          newDir,
          oldDir,
          failedDir,
          helperDir: options.helperDir ?? '',
          fromVersion: options.fromVersion,
          toVersion: options.toVersion,
          reason: 'helper-crashed',
          detail,
          restored,
          at: Date.now(),
        });
      } catch {}
      if (restored) {
        fs.rmSync(updateMarkerPath(installDir), { force: true });
        try {
          await launchWithRetries(options.launch, installExe, [], parentDir);
        } catch {}
      }
      return { outcome: 'rolled-back', reason: 'helper-crashed' };
    }
    let restored = fs.existsSync(installExe);
    if (!restored && fs.existsSync(oldDir)) {
      try {
        if (fs.existsSync(installDir)) {
          await removeDirectoryWithRetries(failedDir);
          await renameWithRetries(installDir, failedDir, 10_000);
        }
        await renameWithRetries(oldDir, installDir, 10_000);
        restored = fs.existsSync(installExe);
      } catch (restoreError) {
        appendLog(
          logPath,
          `helper crash restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
        );
      }
    }
    try {
      writeJson(journalPath, {
        schema: 1,
        updateId: options.updateId,
        phase: 'failed',
        installDir,
        newDir,
        oldDir,
        failedDir,
        helperDir: options.helperDir ?? '',
        fromVersion: options.fromVersion,
        toVersion: options.toVersion,
        reason: 'helper-crashed',
        detail,
        restored,
        at: Date.now(),
      });
    } catch {}
    if (restored && fs.existsSync(newDir)) await removeDirectoryWithRetries(newDir);
    if (restored) {
      fs.rmSync(path.join(options.workspace, WORKSPACE_FILES.lock), { force: true });
      fs.rmSync(updateMarkerPath(installDir), { force: true });
      if (!isProcessAlive(options.appPid) && fs.existsSync(installExe)) {
        try {
          await launchWithRetries(options.launch, installExe, [], parentDir);
        } catch {}
      }
    }
    return { outcome: restored ? 'aborted' : 'rolled-back', reason: 'helper-crashed' };
  }
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
    ...(read('helper-dir') ? { helperDir: read('helper-dir') as string } : {}),
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

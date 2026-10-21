import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { downloadUpdate } from './download.cjs';
import { archiveInfo } from './extract.cjs';
import { fetchJson, openStream } from './netClient.cjs';
import { readCachedReleaseNotes, writeCachedReleaseNotes } from './notesCache.cjs';
import { runPreflight, type PreflightOutcome } from './preflight.cjs';
import { fetchReleaseNotes, scanForRelease } from './release.cjs';
import { hashFileHex, verifyDigestSignature } from './signature.cjs';
import { isNewerVersion } from './version.cjs';
import {
  WORKSPACE_FILES,
  appendLog,
  createHelperRuntime,
  delay,
  directorySize,
  helperDirFor,
  helperRuntimeBytes,
  installIdFor,
  isProcessAlive,
  killProcessTree,
  newUpdateId,
  processExecutablePath,
  readJson,
  removeDirectoryWithRetries,
  sanitizedEnv,
  staleSiblingTrees,
  staleUpdateMarkers,
  supportsHardlinks,
  updateMarkerPath,
  workspaceRoot,
  writeJson,
} from './install.cjs';

export type UpdatePhase =
  | 'unsupported'
  | 'blocked'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'applying'
  | 'error';

export interface ApplyProgress {
  phase: string;
  percent: number | null;
  bytes: number;
  totalBytes: number | null;
  entries: number;
  totalEntries: number | null;
}

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  archiveBytes: number | null;
  receivedBytes: number;
  progressPercent: number | null;
  applyProgress: ApplyProgress | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  lastApply: {
    ok: boolean;
    reason: string;
    toVersion: string;
    at: number;
    detail?: string;
    restored?: boolean;
  } | null;
  canDownload: boolean;
  canApply: boolean;
}

export interface UpdaterHost {
  isPackaged: boolean;
  installDir: string;
  userDataDir: string;
  libraryDir: string | null;
  localAppDataDir: string | null;
  helperBundlePath: string;
  currentVersion: string;
  backendPort: () => number;
  getWindow: () => BrowserWindow | null;
  bootReport: { updateId: string; version: string; nonce: string; reportPath: string } | null;
}

export interface UpdaterHandle {
  notifyWindowFailure(reason: string): void;
  reportReady(): void;
  dispose(): void;
}

interface PersistedRelease {
  version: string;
  tag: string;
  publishedAt: string;
  archiveSize: number;
  digestHex: string;
  archiveUrl: string;
  signatureUrl: string;
}

interface PersistedApply {
  ok: boolean;
  reason: string;
  toVersion: string;
  at: number;
  detail?: string;
  restored?: boolean;
}

interface PersistedState {
  lastCheckedAt: number | null;
  latest: PersistedRelease | null;
  lastApply: PersistedApply | null;
  failedVersions: string[];
  pendingCleanup: string[];
}

interface JournalRecord {
  updateId?: string;
  phase?: string;
  installDir?: string;
  newDir?: string;
  oldDir?: string;
  failedDir?: string;
  helperDir?: string;
  fromVersion?: string;
  toVersion?: string;
  reason?: string;
  detail?: string;
  restored?: boolean;
  percent?: number;
  bytes?: number;
  totalBytes?: number;
  entries?: number;
  totalEntries?: number;
  at?: number;
}

interface ApplyLock {
  pid?: number;
  updateId?: string;
  at?: number;
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MANUAL_COOLDOWN_MS = 60_000;
const STARTUP_CHECK_DELAY_MS = 15_000;
const CLEANUP_DELAY_MS = 60_000;
const OLD_TREE_RETENTION_MS = 24 * 60 * 60 * 1000;
const PROGRESS_PUBLISH_MS = 250;
const APPLY_POLL_MS = 200;
const HELPER_START_GRACE_MS = 10_000;
const HELPER_DEATH_GRACE_MS = 5_000;
const MAX_APPLY_MS = 30 * 60 * 1000;
const SPACE_HEADROOM_BYTES = 256 * 1024 * 1024;
const ACTIVE_JOB_STATES = new Set(['queued', 'downloading', 'converting']);
const RELEASE_PAGE_BASE = 'https://github.com/x01Jin/ytmc/releases/tag/';

function isTrustedFrame(frame: { url?: string } | null | undefined): boolean {
  const url = frame?.url ?? '';
  return (
    url.startsWith('http://127.0.0.1:') ||
    url.startsWith('http://localhost:') ||
    url.startsWith('file://')
  );
}

function emptyState(currentVersion: string): UpdateState {
  return {
    phase: 'idle',
    currentVersion,
    latestVersion: null,
    releaseUrl: null,
    archiveBytes: null,
    receivedBytes: 0,
    progressPercent: null,
    applyProgress: null,
    errorCode: null,
    errorMessage: null,
    lastCheckedAt: null,
    lastApply: null,
    canDownload: false,
    canApply: false,
  };
}

function readPersisted(filePath: string): PersistedState {
  const raw = readJson<Partial<PersistedState>>(filePath);
  const candidate = raw?.latest;
  const latest =
    candidate &&
    typeof candidate.version === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.publishedAt === 'string' &&
    typeof candidate.archiveSize === 'number' &&
    Number.isSafeInteger(candidate.archiveSize) &&
    candidate.archiveSize > 0 &&
    typeof candidate.digestHex === 'string' &&
    /^[0-9a-f]{64}$/i.test(candidate.digestHex) &&
    typeof candidate.archiveUrl === 'string' &&
    candidate.archiveUrl.startsWith('https://') &&
    typeof candidate.signatureUrl === 'string' &&
    candidate.signatureUrl.startsWith('https://')
      ? candidate
      : null;
  return {
    lastCheckedAt: typeof raw?.lastCheckedAt === 'number' ? raw.lastCheckedAt : null,
    latest,
    lastApply: raw?.lastApply ?? null,
    failedVersions: Array.isArray(raw?.failedVersions)
      ? raw.failedVersions.filter((version): version is string => typeof version === 'string')
      : [],
    pendingCleanup: Array.isArray(raw?.pendingCleanup)
      ? raw.pendingCleanup.filter((dir): dir is string => typeof dir === 'string')
      : [],
  };
}

function selectWorkspace(host: UpdaterHost): string | null {
  const installId = installIdFor(host.installDir);
  const candidates: string[] = [];
  if (host.localAppDataDir) candidates.push(workspaceRoot(host.localAppDataDir, installId));
  candidates.push(path.join(path.dirname(host.installDir), '.ytmc-updater', installId));
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      const probe = path.join(candidate, `.ytmc-write-${process.pid}`);
      fs.writeFileSync(probe, 'x');
      fs.rmSync(probe, { force: true });
      return candidate;
    } catch {}
  }
  return null;
}

const FAILURE_MESSAGES: Record<string, string> = {
  'swap-failed':
    'Windows blocked the app folder rename. Close Explorer windows and antivirus scans pointed at the app folder, then try again.',
  'app-still-running': 'The app could not be closed for the update. Restart it and try again.',
  'backend-still-running': 'The background engine did not stop. Restart the app and try again.',
  'helper-crashed': 'The update helper stopped unexpectedly. The previous version was restored.',
  'apply-helper-exited':
    'The update helper stopped unexpectedly. The previous version is still available.',
  'apply-timeout':
    'The update took too long and was stopped. The previous version is still available.',
  'helper-prepare-failed':
    'The update could not prepare its helper. Check free space and try again.',
  'update-in-progress': 'Another update is already being installed.',
  'old-tree-remove-failed':
    'A previous update folder could not be removed. Restart the app and try again.',
  'recovery-unavailable':
    'The update could not start its recovery watchdog. Check antivirus or policy settings and try again.',
};

function failureMessage(reason: string, detail?: string): string {
  return FAILURE_MESSAGES[reason] ?? detail ?? 'The update could not be installed.';
}

export function initializeUpdater(host: UpdaterHost): UpdaterHandle {
  const selectedWorkspace = selectWorkspace(host);
  const workspace = selectedWorkspace ?? '';
  const workspaceReady = selectedWorkspace !== null;
  const statePath = path.join(workspace, WORKSPACE_FILES.state);
  const journalPath = path.join(workspace, WORKSPACE_FILES.journal);
  const lockPath = path.join(workspace, WORKSPACE_FILES.lock);
  const cancelPath = path.join(workspace, WORKSPACE_FILES.cancel);
  const archivePath = path.join(workspace, WORKSPACE_FILES.archive);
  const signaturePath = path.join(workspace, `${WORKSPACE_FILES.archive}.sig`);
  const helperPath = path.join(workspace, WORKSPACE_FILES.helper);
  const logPath = path.join(workspace, WORKSPACE_FILES.log);
  const notesPath = path.join(workspace, WORKSPACE_FILES.notes);
  const persisted = workspaceReady ? readPersisted(statePath) : readPersisted('');
  const state = emptyState(host.currentVersion);

  let preflight: PreflightOutcome = { ok: true };
  let checkedAt = 0;
  let checking = false;
  let downloadAbort: AbortController | null = null;
  let applying = false;
  let disposed = false;
  let bootReportWritten = false;
  let bootReportInFlight = false;
  let bootReportTimer: NodeJS.Timeout | null = null;
  const bootReportDeadline = host.bootReport ? Date.now() + 5 * 60 * 1000 : 0;
  let windowFailure: string | null = null;
  let recoveryBlocked = false;
  let reconcileAttempts = 0;
  let reconcileTimer: NodeJS.Timeout | null = null;
  let lastProgressPublish = 0;

  const info = (line: string) => {
    if (workspaceReady) appendLog(logPath, line);
  };

  const publish = () => {
    if (disposed) return;
    host.getWindow()?.webContents.send('updates:state', state);
  };

  const setState = (patch: Partial<UpdateState>) => {
    Object.assign(state, patch);
    publish();
  };

  const setTaskbarProgress = (percent: number | null) => {
    const win = host.getWindow();
    if (!win || win.isDestroyed()) return;
    win.setProgressBar(percent === null ? -1 : Math.min(1, Math.max(0, percent / 100)));
  };

  const savePersisted = () => {
    if (!workspaceReady) return;
    try {
      writeJson(statePath, persisted);
    } catch (error) {
      info(`state write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const settlePhase = () => {
    if (!host.isPackaged) {
      setState({ phase: 'unsupported', canDownload: false, canApply: false });
      return;
    }
    if (recoveryBlocked) {
      setState({
        phase: 'error',
        canDownload: false,
        canApply: false,
        errorCode: 'repair-needed',
        errorMessage:
          'The previous update was interrupted. The repair runs automatically; if it does not finish, restart the app.',
      });
      return;
    }
    if (!preflight.ok) {
      setState({
        phase: 'blocked',
        errorCode: preflight.code,
        errorMessage: preflight.message,
        canDownload: false,
        canApply: false,
      });
      return;
    }
    if (persisted.latest && isNewerVersion(persisted.latest.version, host.currentVersion)) {
      applyReleaseToState(persisted.latest);
      if (fs.existsSync(archivePath)) {
        setState({ phase: 'ready', canDownload: false, canApply: true });
      } else {
        setState({ phase: 'available', canDownload: true, canApply: false });
      }
      return;
    }
    setState({ phase: 'idle', canDownload: false, canApply: false });
  };

  const applyReleaseToState = (release: PersistedRelease) => {
    setState({
      latestVersion: release.version,
      releaseUrl: `${RELEASE_PAGE_BASE}${release.tag}`,
      archiveBytes: release.archiveSize,
      errorCode: null,
      errorMessage: null,
      lastCheckedAt: persisted.lastCheckedAt,
      lastApply: persisted.lastApply,
    });
  };

  const refreshPreflight = (unpackedBytes?: number | null, exact = false): PreflightOutcome => {
    const limit = exact ? Number.POSITIVE_INFINITY : 20_000;
    const installSize = fs.existsSync(host.installDir) ? directorySize(host.installDir, limit) : 0;
    const helperBytes = supportsHardlinks(host.installDir)
      ? 0
      : helperRuntimeBytes(host.installDir);
    const installBytes =
      installSize > 0
        ? installSize + (unpackedBytes ?? installSize) + SPACE_HEADROOM_BYTES
        : SPACE_HEADROOM_BYTES;
    const workspaceBytes = persisted.latest
      ? persisted.latest.archiveSize + SPACE_HEADROOM_BYTES
      : SPACE_HEADROOM_BYTES;
    preflight = runPreflight({
      isPackaged: host.isPackaged,
      installDir: host.installDir,
      userDataDir: host.userDataDir,
      libraryDir: host.libraryDir,
      localAppDataDir: host.localAppDataDir,
      helperBundlePath: host.helperBundlePath,
      currentVersion: host.currentVersion,
      installBytesRequired: installBytes,
      workspaceBytesRequired: workspaceBytes,
      workspaceDir: workspaceReady ? workspace : undefined,
      helperBytesRequired: helperBytes,
      checkDriveType: exact,
    });
    return preflight;
  };

  const conversionsActive = async (): Promise<boolean> => {
    const port = host.backendPort();
    if (!port) return false;
    try {
      const response = await fetchJson(`http://127.0.0.1:${port}/api/jobs`);
      if (response.status !== 200) return true;
      const payload = JSON.parse(response.body) as { jobs?: Array<{ status?: string }> };
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      return jobs.some(job => ACTIVE_JOB_STATES.has(String(job.status)));
    } catch {
      return true;
    }
  };

  const waitForReadiness = async (timeoutMs: number): Promise<boolean> => {
    const port = host.backendPort();
    if (!port) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetchJson(`http://127.0.0.1:${port}/api/health`);
        if (response.status === 200) {
          const payload = JSON.parse(response.body) as {
            readiness?: { ytDlp?: unknown; ffmpeg?: unknown; library?: unknown };
          };
          const readiness = payload.readiness;
          if (
            readiness &&
            readiness.ytDlp !== null &&
            readiness.ytDlp !== undefined &&
            readiness.ffmpeg !== null &&
            readiness.ffmpeg !== undefined
          ) {
            return true;
          }
        }
      } catch {}
      await delay(1000);
    }
    return false;
  };

  const scheduleBootReport = () => {
    if (bootReportTimer || disposed || bootReportWritten || windowFailure) return;
    if (!host.bootReport || Date.now() > bootReportDeadline) return;
    bootReportTimer = setTimeout(() => {
      bootReportTimer = null;
      void writeBootReport();
    }, 5_000);
  };

  const writeBootReport = async (): Promise<void> => {
    const report = host.bootReport;
    if (!report || bootReportWritten || bootReportInFlight || windowFailure) return;
    if (app.getVersion() !== report.version) {
      info(`boot report skipped: running ${app.getVersion()} expected ${report.version}`);
      return;
    }
    const window = host.getWindow();
    if (!window || window.isDestroyed()) {
      scheduleBootReport();
      return;
    }
    const shown = window.isVisible() || window.isMinimized();
    if (!shown) {
      scheduleBootReport();
      return;
    }
    bootReportInFlight = true;
    try {
      if (!(await waitForReadiness(20_000))) {
        bootReportInFlight = false;
        scheduleBootReport();
        return;
      }
      if (
        disposed ||
        windowFailure ||
        window.isDestroyed() ||
        (!window.isVisible() && !window.isMinimized())
      ) {
        bootReportInFlight = false;
        scheduleBootReport();
        return;
      }
      writeJson(report.reportPath, {
        schema: 1,
        updateId: report.updateId,
        version: report.version,
        nonce: report.nonce,
        visible: true,
        at: Date.now(),
      });
      bootReportWritten = true;
      info(`boot report written for ${report.version}`);
    } catch (error) {
      info(`boot report write failed: ${error instanceof Error ? error.message : String(error)}`);
      scheduleBootReport();
    } finally {
      bootReportInFlight = false;
    }
  };

  const cleanup = (dirs: string[], delayMs = CLEANUP_DELAY_MS) => {
    const targets = dirs.filter(dir => typeof dir === 'string' && dir.length > 0);
    if (targets.length === 0) return;
    setTimeout(() => {
      persisted.pendingCleanup = Array.from(new Set([...persisted.pendingCleanup, ...targets]));
      savePersisted();
      const remove = async () => {
        const remaining: string[] = [];
        for (const dir of targets) {
          const removed = await removeDirectoryWithRetries(dir);
          if (!removed) remaining.push(dir);
        }
        persisted.pendingCleanup = persisted.pendingCleanup.filter(
          dir => !targets.includes(dir) || remaining.includes(dir)
        );
        savePersisted();
      };
      void remove();
    }, delayMs);
  };

  const reconcile = () => {
    if (!workspaceReady) return;
    const journal = readJson<JournalRecord>(journalPath);
    const lock = readJson<ApplyLock>(lockPath);
    if (lock && typeof lock.pid === 'number' && lock.pid !== process.pid) {
      const age = typeof lock.at === 'number' ? Date.now() - lock.at : Number.POSITIVE_INFINITY;
      if (age < 60 * 60 * 1000 && isProcessAlive(lock.pid)) {
        info(`update helper is still running pid=${lock.pid}`);
        if (!reconcileTimer && reconcileAttempts < 12) {
          reconcileAttempts += 1;
          reconcileTimer = setTimeout(() => {
            reconcileTimer = null;
            if (!disposed) reconcile();
          }, 5_000);
        }
        return;
      }
      fs.rmSync(lockPath, { force: true });
    }
    const installExe = path.join(host.installDir, path.basename(process.execPath));
    const installIntact = fs.existsSync(installExe);
    const needsRepair = Boolean(journal && !installIntact);
    if (!needsRepair) {
      for (const markerPath of staleUpdateMarkers(host.installDir)) {
        const marker = readJson<{ pid?: number; installDir?: string }>(markerPath);
        const matches =
          typeof marker?.installDir === 'string' &&
          path.resolve(marker.installDir) === path.resolve(host.installDir);
        if (matches && typeof marker?.pid === 'number' && isProcessAlive(marker.pid)) continue;
        fs.rmSync(markerPath, { force: true });
      }
    }
    if (journal) {
      if (needsRepair) {
        recoveryBlocked = true;
        const reason = journal.reason ?? (installIntact ? 'rollback-failed' : 'swap-failed');
        const detail = journal.detail;
        persisted.lastApply = {
          ok: false,
          reason,
          toVersion: journal.toVersion ?? '',
          at: Date.now(),
          ...(detail ? { detail } : {}),
          restored: false,
        };
        savePersisted();
        setState({
          phase: 'error',
          canApply: false,
          canDownload: false,
          errorCode: 'repair-needed',
          errorMessage:
            'The previous update was interrupted. The repair runs automatically; if it does not finish, restart the app.',
          lastApply: persisted.lastApply,
        });
        info(`recovery pending: ${reason}${detail ? ` (${detail})` : ''}`);
        return;
      }
      const applied =
        journal.toVersion === host.currentVersion &&
        (journal.phase === 'boot-ok' ||
          journal.phase === 'launched' ||
          (journal.phase === 'failed' && installIntact));
      const quickCleanup = [journal.newDir, journal.failedDir, journal.helperDir].filter(
        (dir): dir is string => typeof dir === 'string'
      );
      if (applied) {
        persisted.lastApply = {
          ok: true,
          reason: 'applied',
          toVersion: journal.toVersion ?? host.currentVersion,
          at: Date.now(),
        };
        info(`update to ${journal.toVersion} confirmed`);
        setState({ lastApply: persisted.lastApply });
      } else if (journal.phase === 'cancelled') {
        info(`update to ${journal.toVersion ?? ''} cancelled`);
      } else if (journal.phase === 'rolled-back' || journal.phase === 'failed') {
        const reason = journal.reason ?? 'unknown';
        const detail = journal.detail;
        const restored =
          journal.phase === 'rolled-back' ||
          journal.restored === true ||
          installIntact ||
          (reason !== 'swap-failed' && reason !== 'rollback-failed');
        persisted.lastApply = {
          ok: false,
          reason,
          toVersion: journal.toVersion ?? '',
          at: Date.now(),
          ...(detail ? { detail } : {}),
          ...(restored ? { restored } : {}),
        };
        if (journal.toVersion) {
          persisted.failedVersions = Array.from(
            new Set([...persisted.failedVersions, journal.toVersion])
          );
        }
        setState({ lastApply: persisted.lastApply });
        info(`previous update attempt failed: ${reason}${detail ? ` (${detail})` : ''}`);
      } else {
        const intact = fs.existsSync(path.join(host.installDir, path.basename(process.execPath)));
        persisted.lastApply = {
          ok: false,
          reason: 'apply-interrupted',
          toVersion: journal.toVersion ?? '',
          at: Date.now(),
          restored: intact,
        };
        setState({ lastApply: persisted.lastApply });
        info(`previous update to ${journal.toVersion ?? ''} was interrupted at ${journal.phase}`);
      }
      fs.rmSync(journalPath, { force: true });
      fs.rmSync(path.join(workspace, WORKSPACE_FILES.bootOk), { force: true });
      fs.rmSync(path.join(workspace, WORKSPACE_FILES.cancel), { force: true });
      cleanup(quickCleanup, 0);
      if (typeof journal.oldDir === 'string') cleanup([journal.oldDir], OLD_TREE_RETENTION_MS);
    }
    if (persisted.pendingCleanup.length > 0) {
      cleanup([...persisted.pendingCleanup]);
    }
    if (host.isPackaged) {
      const expired: string[] = [];
      const now = Date.now();
      const prefixLength = path.basename(path.resolve(host.installDir)).length + 1;
      for (const dir of staleSiblingTrees(host.installDir)) {
        const suffix = path.basename(dir).slice(prefixLength);
        if (suffix.startsWith('old-')) {
          try {
            if (now - fs.statSync(dir).mtimeMs < OLD_TREE_RETENTION_MS) continue;
          } catch {
            continue;
          }
        }
        expired.push(dir);
      }
      cleanup(expired);
    }
    if (persisted.lastCheckedAt !== null && persisted.lastCheckedAt > Date.now()) {
      persisted.lastCheckedAt = null;
    }
    savePersisted();
  };

  const verifyArchive = async (): Promise<string | null> => {
    if (!fs.existsSync(archivePath) || !fs.existsSync(signaturePath)) return null;
    try {
      const digestHex = await hashFileHex(archivePath);
      const signatureBase64 = fs.readFileSync(signaturePath, 'utf8').trim();
      const signature = verifyDigestSignature(digestHex, signatureBase64);
      if (!signature.ok) return null;
      return persisted.latest !== null && persisted.latest.digestHex === digestHex
        ? digestHex
        : null;
    } catch {
      return null;
    }
  };

  const readApplyProgress = (journal: JournalRecord): ApplyProgress => ({
    phase: journal.phase ?? 'applying',
    percent: typeof journal.percent === 'number' ? journal.percent : null,
    bytes: typeof journal.bytes === 'number' ? journal.bytes : 0,
    totalBytes: typeof journal.totalBytes === 'number' ? journal.totalBytes : null,
    entries: typeof journal.entries === 'number' ? journal.entries : 0,
    totalEntries: typeof journal.totalEntries === 'number' ? journal.totalEntries : null,
  });

  const clearApplyFiles = (journal: JournalRecord | null, preserveRecovery = false) => {
    if (preserveRecovery) return;
    const dirs = [journal?.newDir, journal?.failedDir, journal?.helperDir].filter(
      (dir): dir is string => typeof dir === 'string' && dir.length > 0
    );
    cleanup(dirs);
    fs.rmSync(journalPath, { force: true });
    fs.rmSync(path.join(workspace, WORKSPACE_FILES.bootOk), { force: true });
    fs.rmSync(cancelPath, { force: true });
    fs.rmSync(updateMarkerPath(host.installDir), { force: true });
  };

  const installExecutable = () => path.join(host.installDir, path.basename(process.execPath));

  const applyFailure = (journal: JournalRecord, fallbackVersion: string) => {
    const reason = journal.reason ?? 'apply-failed';
    const detail = journal.detail;
    const intact = fs.existsSync(installExecutable());
    const restored =
      intact &&
      (journal.restored === true || (reason !== 'swap-failed' && reason !== 'rollback-failed'));
    applying = false;
    persisted.lastApply = {
      ok: false,
      reason,
      toVersion: journal.toVersion ?? fallbackVersion,
      at: Date.now(),
      ...(detail ? { detail } : {}),
      ...(restored ? { restored } : {}),
    };
    savePersisted();
    setTaskbarProgress(null);
    setState({
      phase: intact ? 'ready' : 'error',
      canApply: intact,
      canDownload: false,
      applyProgress: null,
      errorCode: reason,
      errorMessage: intact
        ? failureMessage(reason, detail)
        : 'The app folder could not be restored yet. Restart the app to run the repair.',
      lastApply: persisted.lastApply,
    });
    info(`apply failed: ${reason}${detail ? ` (${detail})` : ''}`);
    clearApplyFiles(journal, !intact);
  };

  const applyCancelled = (journal: JournalRecord) => {
    applying = false;
    setTaskbarProgress(null);
    setState({
      phase: 'ready',
      canApply: true,
      canDownload: false,
      applyProgress: null,
      errorCode: 'conversion-active',
      errorMessage: 'Finish the active conversion before restarting to update.',
    });
    info('apply cancelled before restart');
    clearApplyFiles(journal);
  };

  const applyStopped = (
    reason: string,
    detail?: string,
    journal: JournalRecord | null = null,
    helperDir?: string
  ) => {
    const intact = fs.existsSync(installExecutable());
    if (helperDir && helperDir !== journal?.helperDir) cleanup([helperDir]);
    applying = false;
    setTaskbarProgress(null);
    setState({
      phase: intact ? 'ready' : 'error',
      canApply: intact,
      canDownload: false,
      applyProgress: null,
      errorCode: reason,
      errorMessage: intact
        ? failureMessage(reason, detail)
        : 'The app folder could not be restored yet. Restart the app to run the repair.',
    });
    info(`apply stopped: ${reason}${detail ? ` (${detail})` : ''}`);
    clearApplyFiles(journal, !intact);
  };

  const pollApply = async (
    updateId: string,
    helperPid: number,
    helperExecutable: string,
    release: PersistedRelease
  ): Promise<void> => {
    const startedAt = Date.now();
    let lastPublish = 0;
    let preSwapHandled = false;
    let helperDeadAt = 0;
    let helperIdentityCheckedAt = 0;
    try {
      while (applying && !disposed) {
        const journal = readJson<JournalRecord>(journalPath);
        const matching = Boolean(journal && journal.updateId === updateId);
        if (matching && journal) {
          const progress = readApplyProgress(journal);
          const now = Date.now();
          if (journal.phase !== 'extracting' || now - lastPublish >= PROGRESS_PUBLISH_MS) {
            setState({ applyProgress: progress });
            setTaskbarProgress(progress.percent);
            lastPublish = now;
          }
          if (journal.phase === 'pre-swap' && !preSwapHandled) {
            preSwapHandled = true;
            if (await conversionsActive()) {
              try {
                writeJson(cancelPath, { reason: 'conversion-active', at: Date.now() });
              } catch (error) {
                info(
                  `cancel marker write failed: ${error instanceof Error ? error.message : String(error)}`
                );
              }
              info('apply cancelled at pre-swap: conversion active');
              setState({ applyProgress: { ...progress, phase: 'cancelling' } });
              await delay(APPLY_POLL_MS);
              continue;
            }
            setState({ applyProgress: { ...progress, phase: 'restarting', percent: 100 } });
            setTaskbarProgress(100);
            info('pre-swap reached, restarting');
            app.quit();
            return;
          }
          if (journal.phase === 'failed') {
            applyFailure(journal, release.version);
            return;
          }
          if (journal.phase === 'cancelled') {
            applyCancelled(journal);
            return;
          }
          if (journal.phase === 'rolled-back') {
            applying = false;
            setTaskbarProgress(null);
            setState({
              phase: 'ready',
              canApply: true,
              canDownload: false,
              applyProgress: null,
              errorCode: journal.reason ?? 'rolled-back',
              errorMessage:
                journal.detail ??
                'The update could not be completed. The previous version was restored.',
            });
            clearApplyFiles(journal);
            return;
          }
          if (journal.phase === 'boot-ok') {
            applying = false;
            setTaskbarProgress(null);
            setState({ applyProgress: null });
            clearApplyFiles(journal);
            if (typeof journal.oldDir === 'string') {
              cleanup([journal.oldDir], OLD_TREE_RETENTION_MS);
            }
            return;
          }
        }
        let helperAlive = helperPid > 0 && isProcessAlive(helperPid);
        if (helperAlive && Date.now() - helperIdentityCheckedAt > 5_000) {
          helperIdentityCheckedAt = Date.now();
          const helperImage = await processExecutablePath(helperPid);
          if (helperImage && helperImage.toLowerCase() !== helperExecutable.toLowerCase()) {
            helperAlive = false;
          }
        }
        if (!helperAlive) {
          if (helperDeadAt === 0) helperDeadAt = Date.now();
          if (Date.now() - helperDeadAt > HELPER_DEATH_GRACE_MS) {
            if (matching && journal && journal.phase === 'pre-swap') {
              applyStopped(
                'apply-helper-exited',
                undefined,
                journal,
                path.dirname(helperExecutable)
              );
              return;
            }
            if (Date.now() - startedAt > HELPER_START_GRACE_MS) {
              applyStopped(
                'apply-helper-exited',
                undefined,
                journal ?? null,
                path.dirname(helperExecutable)
              );
              return;
            }
          }
        } else {
          helperDeadAt = 0;
        }
        if (Date.now() - startedAt > MAX_APPLY_MS) {
          if (helperPid > 0) killProcessTree(helperPid, true);
          applyStopped('apply-timeout', undefined, journal ?? null, path.dirname(helperExecutable));
          return;
        }
        await delay(APPLY_POLL_MS);
      }
    } catch (error) {
      applyStopped(
        'apply-failed',
        error instanceof Error ? error.message : String(error),
        readJson<JournalRecord>(journalPath),
        path.dirname(helperExecutable)
      );
    }
  };

  const runCheck = async (manual: boolean): Promise<void> => {
    if (!workspaceReady || !host.isPackaged || recoveryBlocked || checking || applying) return;
    if (manual && Date.now() - checkedAt < MANUAL_COOLDOWN_MS) return;
    if (!manual && persisted.lastCheckedAt !== null) {
      const elapsed = Date.now() - persisted.lastCheckedAt;
      if (elapsed < CHECK_INTERVAL_MS) {
        checkedAt = Date.now();
        return;
      }
    }
    checking = true;
    checkedAt = Date.now();
    setState({ phase: 'checking', errorCode: null, errorMessage: null });
    try {
      const lookup = await scanForRelease({ fetchJson, currentVersion: host.currentVersion });
      persisted.lastCheckedAt = Date.now();
      if (lookup.status === 'available') {
        const release = lookup.release;
        persisted.latest = {
          version: release.version,
          tag: release.tag,
          publishedAt: release.publishedAt,
          archiveSize: release.archive.size,
          digestHex: release.archive.digestHex,
          archiveUrl: release.archive.downloadUrl,
          signatureUrl: release.signature.downloadUrl,
        };
        savePersisted();
        applyReleaseToState(persisted.latest);
        const archiveDigest = await verifyArchive();
        const archivePresent = archiveDigest !== null;
        setState({
          phase: archivePresent ? 'ready' : 'available',
          canDownload: !archivePresent,
          canApply: archivePresent,
        });
      } else if (lookup.status === 'up-to-date') {
        persisted.latest = null;
        savePersisted();
        setState({
          phase: 'up-to-date',
          latestVersion: null,
          releaseUrl: null,
          archiveBytes: null,
          lastCheckedAt: persisted.lastCheckedAt,
          canDownload: false,
          canApply: false,
        });
      } else if (lookup.status === 'invalid-release') {
        persisted.latest = null;
        savePersisted();
        info(`release ${lookup.version} rejected: ${lookup.reason}`);
        setState({
          phase: 'error',
          errorCode: lookup.reason,
          errorMessage: `Release ${lookup.version} is not installable.`,
          canDownload: false,
          canApply: false,
        });
      } else {
        info(`release lookup failed: ${lookup.reason}`);
        setState({
          phase: 'error',
          errorCode: lookup.reason,
          errorMessage: lookup.message,
          canDownload: false,
          canApply: false,
        });
      }
    } catch (error) {
      info(`release check failed: ${error instanceof Error ? error.message : String(error)}`);
      setState({
        phase: 'error',
        errorCode: 'check-failed',
        errorMessage: error instanceof Error ? error.message : 'The release check failed.',
        canDownload: false,
        canApply: false,
      });
    } finally {
      checking = false;
    }
  };

  const startDownload = async (): Promise<void> => {
    const release = persisted.latest;
    if (!workspaceReady || !release || applying || downloadAbort) return;
    if (!refreshPreflight().ok) {
      settlePhase();
      return;
    }
    const controller = new AbortController();
    downloadAbort = controller;
    setState({
      phase: 'downloading',
      receivedBytes: 0,
      progressPercent: 0,
      canDownload: false,
      canApply: false,
      errorCode: null,
      errorMessage: null,
    });
    try {
      const signatureResponse = await fetchJson(release.signatureUrl, {
        headers: { 'User-Agent': 'ytmc-updater', Accept: 'text/plain' },
      });
      const signatureBase64 = signatureResponse.body.trim();
      if (signatureResponse.status !== 200 || signatureBase64.length === 0) {
        setState({
          phase: 'error',
          errorCode: 'signature-unavailable',
          errorMessage: 'The release signature could not be read.',
          canDownload: true,
        });
        return;
      }
      fs.writeFileSync(signaturePath, `${signatureBase64}\n`, 'utf8');
      const plan = {
        url: release.archiveUrl,
        destination: archivePath,
        expectedSize: release.archiveSize,
        expectedDigestHex: release.digestHex,
        signatureBase64,
      };
      let outcome = await downloadUpdate({
        openStream,
        plan,
        signal: controller.signal,
        onProgress: progress => {
          const now = Date.now();
          if (now - lastProgressPublish < PROGRESS_PUBLISH_MS) return;
          lastProgressPublish = now;
          setState({
            receivedBytes: progress.received,
            progressPercent:
              progress.total > 0 ? Math.floor((progress.received / progress.total) * 100) : null,
          });
        },
      });
      if (outcome.status === 'stale-url') {
        info('download url expired, retrying');
        await delay(2000);
        outcome = await downloadUpdate({
          openStream,
          plan,
          signal: controller.signal,
          onProgress: progress => {
            setState({
              receivedBytes: progress.received,
              progressPercent:
                progress.total > 0 ? Math.floor((progress.received / progress.total) * 100) : null,
            });
          },
        });
      }
      if (outcome.status === 'ok') {
        setState({
          phase: 'ready',
          receivedBytes: outcome.bytes,
          progressPercent: 100,
          canDownload: false,
          canApply: true,
        });
        info(`download complete ${release.version} ${outcome.bytes} bytes`);
      } else if (outcome.status === 'aborted') {
        setState({
          phase: 'available',
          receivedBytes: outcome.bytes,
          progressPercent: null,
          canDownload: true,
          canApply: false,
          errorCode: 'download-cancelled',
          errorMessage: 'The download was cancelled. It will resume from where it stopped.',
        });
      } else {
        const reason = outcome.status === 'failed' ? outcome.reason : 'download-url-expired';
        info(`download failed: ${reason}`);
        setState({
          phase: 'error',
          errorCode: reason,
          errorMessage: 'The update download failed.',
          canDownload: true,
          canApply: false,
        });
      }
    } catch (error) {
      setState({
        phase: 'error',
        errorCode: 'download-error',
        errorMessage: error instanceof Error ? error.message : 'The update download failed.',
        canDownload: true,
        canApply: false,
      });
    } finally {
      downloadAbort = null;
    }
  };

  const applyUpdate = async (): Promise<void> => {
    const release = persisted.latest;
    if (!workspaceReady || recoveryBlocked || !release || applying) return;
    if (state.phase !== 'ready') return;
    applying = true;
    let helperDir: string | null = null;
    try {
      const existingLock = readJson<ApplyLock>(lockPath);
      const existingLockAge =
        typeof existingLock?.at === 'number'
          ? Date.now() - existingLock.at
          : Number.POSITIVE_INFINITY;
      if (
        existingLock &&
        typeof existingLock.pid === 'number' &&
        existingLock.pid !== process.pid &&
        existingLockAge < 60 * 60 * 1000 &&
        isProcessAlive(existingLock.pid)
      ) {
        applying = false;
        setState({
          phase: 'ready',
          errorCode: 'update-in-progress',
          errorMessage: failureMessage('update-in-progress'),
          canApply: true,
        });
        return;
      }
      if (await conversionsActive()) {
        applying = false;
        setState({
          phase: 'ready',
          errorCode: 'conversion-active',
          errorMessage: 'Finish the active conversion before restarting to update.',
          canApply: true,
        });
        return;
      }
      const digestHex = await verifyArchive();
      if (!digestHex) {
        fs.rmSync(archivePath, { force: true });
        fs.rmSync(signaturePath, { force: true });
        applying = false;
        setState({
          phase: 'error',
          errorCode: 'archive-invalid',
          errorMessage: 'The downloaded update could not be verified again.',
          canDownload: true,
          canApply: false,
        });
        return;
      }
      const archive = await archiveInfo(archivePath);
      if (!archive) {
        fs.rmSync(archivePath, { force: true });
        fs.rmSync(signaturePath, { force: true });
        applying = false;
        setState({
          phase: 'error',
          errorCode: 'archive-unreadable',
          errorMessage: 'The downloaded update could not be read. Download it again.',
          canDownload: true,
          canApply: false,
        });
        return;
      }
      if (!refreshPreflight(archive.bytes, true).ok) {
        applying = false;
        settlePhase();
        return;
      }
      const signatureBase64 = fs.readFileSync(signaturePath, 'utf8').trim();
      const updateId = newUpdateId(release.version);
      const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      helperDir = helperDirFor(host.installDir, updateId);
      await createHelperRuntime(host.installDir, helperDir);
      const appExecutable = process.execPath;
      const helperExecutable = path.join(helperDir, path.basename(appExecutable));
      if (!fs.existsSync(helperExecutable)) {
        throw new Error('The update helper executable could not be prepared.');
      }
      fs.writeFileSync(helperPath, fs.readFileSync(host.helperBundlePath));
      fs.rmSync(cancelPath, { force: true });
      writeJson(lockPath, { pid: process.pid, updateId, at: Date.now() });
      setState({
        phase: 'applying',
        canApply: false,
        errorCode: null,
        errorMessage: null,
        applyProgress: {
          phase: 'preparing',
          percent: 0,
          bytes: 0,
          totalBytes: archive.bytes,
          entries: 0,
          totalEntries: archive.entries,
        },
      });
      setTaskbarProgress(0);
      const args = [
        helperPath,
        '--install',
        host.installDir,
        '--workspace',
        workspace,
        '--helper-dir',
        helperDir,
        '--archive',
        archivePath,
        '--digest',
        digestHex,
        '--signature',
        signatureBase64,
        '--update-id',
        updateId,
        '--from',
        host.currentVersion,
        '--to',
        release.version,
        '--exe',
        path.basename(appExecutable),
        '--app-pid',
        String(process.pid),
        '--nonce',
        nonce,
      ];
      const backendPid = (globalThis as { __ytmcBackendPid?: number }).__ytmcBackendPid;
      if (typeof backendPid === 'number' && backendPid > 0) {
        args.push('--backend-pid', String(backendPid));
      }
      info(`spawning helper update=${updateId} from=${path.basename(helperDir)}`);
      const child = spawn(helperExecutable, args, {
        cwd: workspace,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: sanitizedEnv({ ELECTRON_RUN_AS_NODE: '1' }),
      });
      child.unref();
      if (!child.pid) throw new Error('The update helper did not start.');
      void pollApply(updateId, child.pid, helperExecutable, release);
    } catch (error) {
      applying = false;
      setTaskbarProgress(null);
      fs.rmSync(lockPath, { force: true });
      if (helperDir) await removeDirectoryWithRetries(helperDir);
      setState({
        phase: 'ready',
        errorCode: 'helper-prepare-failed',
        errorMessage: failureMessage(
          'helper-prepare-failed',
          error instanceof Error ? error.message : undefined
        ),
        applyProgress: null,
        canApply: true,
      });
    }
  };

  const register = (channel: string, handler: () => unknown) => {
    ipcMain.handle(channel, event => {
      if (!isTrustedFrame(event.senderFrame)) throw new Error('Untrusted sender.');
      return handler();
    });
  };

  register('updates:get-state', () => state);
  register('updates:check', () => runCheck(true));
  register('updates:download', () => startDownload());
  register('updates:cancel-download', () => {
    downloadAbort?.abort();
  });
  register('updates:apply', () => applyUpdate());
  register('updates:open-release', () => {
    if (state.releaseUrl?.startsWith(RELEASE_PAGE_BASE)) void shell.openExternal(state.releaseUrl);
  });
  register('updates:release-notes', async () => {
    if (workspaceReady) {
      const cached = readCachedReleaseNotes(notesPath, host.currentVersion);
      if (cached !== null) return { status: 'ok', version: host.currentVersion, notes: cached };
    }
    const result = await fetchReleaseNotes({ fetchJson, currentVersion: host.currentVersion });
    if (result.status === 'ok' && workspaceReady) {
      try {
        writeCachedReleaseNotes(notesPath, result.version, result.notes);
      } catch (error) {
        info(
          `release-notes-cache-write-failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return result;
  });
  register('updates:renderer-ready', () => {
    void writeBootReport();
  });

  if (workspaceReady) {
    try {
      reconcile();
    } catch (error) {
      info(`reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      refreshPreflight();
    } catch (error) {
      info(`preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    settlePhase();
    if (fs.existsSync(archivePath) && persisted.latest) {
      setTimeout(() => {
        void verifyArchive().then(ok => {
          if (!ok) {
            fs.rmSync(archivePath, { force: true });
            fs.rmSync(signaturePath, { force: true });
            settlePhase();
            return;
          }
          if (state.phase === 'available') {
            setState({ phase: 'ready', canDownload: false, canApply: true });
          }
        });
      }, STARTUP_CHECK_DELAY_MS);
    }
    setTimeout(() => {
      void runCheck(false);
    }, STARTUP_CHECK_DELAY_MS);
  } else {
    setState({
      phase: 'blocked',
      errorCode: 'no-localappdata',
      errorMessage: 'The local app data folder is unavailable.',
    });
  }

  return {
    notifyWindowFailure: reason => {
      windowFailure = reason;
      info(`window failure during update boot: ${reason}`);
    },
    reportReady: () => {
      void writeBootReport();
    },
    dispose: () => {
      disposed = true;
      if (bootReportTimer) clearTimeout(bootReportTimer);
      if (reconcileTimer) clearTimeout(reconcileTimer);
      bootReportTimer = null;
      reconcileTimer = null;
      downloadAbort?.abort();
    },
  };
}

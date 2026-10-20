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
  delay,
  directorySize,
  installIdFor,
  isProcessAlive,
  newUpdateId,
  readJson,
  removeDirectoryWithRetries,
  sanitizedEnv,
  staleSiblingTrees,
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
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MANUAL_COOLDOWN_MS = 60_000;
const STARTUP_CHECK_DELAY_MS = 15_000;
const CLEANUP_DELAY_MS = 60_000;
const PROGRESS_PUBLISH_MS = 250;
const APPLY_POLL_MS = 200;
const HELPER_START_GRACE_MS = 10_000;
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
  return {
    lastCheckedAt: typeof raw?.lastCheckedAt === 'number' ? raw.lastCheckedAt : null,
    latest: raw?.latest ?? null,
    lastApply: raw?.lastApply ?? null,
    failedVersions: Array.isArray(raw?.failedVersions) ? raw.failedVersions : [],
    pendingCleanup: Array.isArray(raw?.pendingCleanup) ? raw.pendingCleanup : [],
  };
}

export function initializeUpdater(host: UpdaterHost): UpdaterHandle {
  const workspace = workspaceRoot(host.localAppDataDir ?? '', installIdFor(host.installDir));
  const workspaceReady = Boolean(host.localAppDataDir);
  if (workspaceReady) fs.mkdirSync(workspace, { recursive: true });
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
  let windowFailure: string | null = null;
  let lastProgressPublish = 0;

  const info = (line: string) => {
    appendLog(logPath, line);
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
    if (persisted.lastCheckedAt === null && persisted.pendingCleanup.length === 0) return;
    writeJson(statePath, persisted);
  };

  const settlePhase = () => {
    if (!host.isPackaged) {
      setState({ phase: 'unsupported', canDownload: false, canApply: false });
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

  const refreshPreflight = (unpackedBytes?: number | null): PreflightOutcome => {
    const installSize = fs.existsSync(host.installDir) ? directorySize(host.installDir) : 0;
    const dataSize = fs.existsSync(path.join(host.installDir, 'data'))
      ? directorySize(path.join(host.installDir, 'data'))
      : 0;
    const installBytes =
      installSize > 0
        ? installSize + (unpackedBytes ?? installSize) + dataSize + SPACE_HEADROOM_BYTES
        : SPACE_HEADROOM_BYTES;
    const workspaceBytes = persisted.latest
      ? 3 * persisted.latest.archiveSize + SPACE_HEADROOM_BYTES
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
            readiness.ffmpeg !== undefined &&
            readiness.library === true
          ) {
            return true;
          }
        }
      } catch {}
      await delay(1000);
    }
    return false;
  };

  const writeBootReport = async (): Promise<void> => {
    const report = host.bootReport;
    if (!report || bootReportWritten || windowFailure) return;
    if (app.getVersion() !== report.version) return;
    if (!(await waitForReadiness(60_000))) return;
    if (disposed || windowFailure) return;
    writeJson(report.reportPath, {
      schema: 1,
      updateId: report.updateId,
      version: report.version,
      nonce: report.nonce,
      at: Date.now(),
    });
    bootReportWritten = true;
    info(`boot report written for ${report.version}`);
  };

  const cleanup = (dirs: string[]) => {
    const targets = dirs.filter(dir => typeof dir === 'string' && dir.length > 0);
    if (targets.length === 0) return;
    persisted.pendingCleanup = Array.from(new Set([...persisted.pendingCleanup, ...targets]));
    savePersisted();
    const remove = async () => {
      const remaining: string[] = [];
      for (const dir of targets) {
        const removed = await removeDirectoryWithRetries(dir);
        if (!removed) remaining.push(dir);
      }
      persisted.pendingCleanup = remaining;
      savePersisted();
    };
    setTimeout(() => {
      void remove();
    }, CLEANUP_DELAY_MS);
  };

  const reconcile = () => {
    if (!workspaceReady) return;
    const journal = readJson<JournalRecord>(journalPath);
    const lock = readJson<ApplyLock>(lockPath);
    if (lock && typeof lock.pid === 'number' && lock.pid !== process.pid) {
      if (isProcessAlive(lock.pid)) {
        info(`update helper is still running pid=${lock.pid}`);
        return;
      }
      fs.rmSync(lockPath, { force: true });
    }
    if (journal) {
      const applied =
        journal.toVersion === host.currentVersion &&
        (journal.phase === 'boot-ok' || journal.phase === 'launched');
      const leftovers = [journal.newDir, journal.failedDir].filter(
        (dir): dir is string => typeof dir === 'string'
      );
      if (applied) {
        persisted.lastApply = {
          ok: true,
          reason: 'applied',
          toVersion: journal.toVersion ?? host.currentVersion,
          at: Date.now(),
        };
        if (journal.phase === 'boot-ok' || journal.phase === 'launched') {
          info(`update to ${journal.toVersion} confirmed`);
        }
        if (typeof journal.oldDir === 'string') leftovers.push(journal.oldDir);
        setState({ lastApply: persisted.lastApply });
      } else if (journal.phase === 'cancelled') {
        info(`update to ${journal.toVersion ?? ''} cancelled`);
      } else if (journal.phase === 'rolled-back' || journal.phase === 'failed') {
        const reason = journal.reason ?? 'unknown';
        const detail = journal.detail;
        const restored =
          journal.phase === 'rolled-back' ||
          journal.restored === true ||
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
      cleanup([...leftovers, ...persisted.pendingCleanup]);
    } else if (persisted.pendingCleanup.length > 0) {
      cleanup([...persisted.pendingCleanup]);
    }
    if (host.isPackaged) {
      cleanup(staleSiblingTrees(host.installDir));
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

  const clearApplyFiles = (journal: JournalRecord | null) => {
    const dirs = [journal?.newDir, journal?.failedDir].filter(
      (dir): dir is string => typeof dir === 'string' && dir.length > 0
    );
    cleanup(dirs);
    fs.rmSync(journalPath, { force: true });
    fs.rmSync(path.join(workspace, WORKSPACE_FILES.bootOk), { force: true });
    fs.rmSync(cancelPath, { force: true });
  };

  const applyFailure = (journal: JournalRecord, fallbackVersion: string) => {
    const reason = journal.reason ?? 'apply-failed';
    const detail = journal.detail;
    const restored =
      journal.restored === true || (reason !== 'swap-failed' && reason !== 'rollback-failed');
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
      phase: 'ready',
      canApply: true,
      canDownload: false,
      applyProgress: null,
      errorCode: reason,
      errorMessage: detail ?? 'The update could not be installed.',
      lastApply: persisted.lastApply,
    });
    info(`apply failed: ${reason}${detail ? ` (${detail})` : ''}`);
    clearApplyFiles(journal);
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

  const pollApply = async (
    updateId: string,
    helperPid: number,
    release: PersistedRelease
  ): Promise<void> => {
    const startedAt = Date.now();
    let lastPublish = 0;
    let preSwapHandled = false;
    try {
      while (applying && !disposed) {
        const journal = readJson<JournalRecord>(journalPath);
        if (journal && journal.updateId === updateId) {
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
              writeJson(cancelPath, { reason: 'conversion-active', at: Date.now() });
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
            return;
          }
          if (journal.phase === 'boot-ok') {
            applying = false;
            setTaskbarProgress(null);
            setState({ applyProgress: null });
            return;
          }
        } else if (
          (!journal || journal.updateId !== updateId) &&
          helperPid > 0 &&
          !isProcessAlive(helperPid) &&
          Date.now() - startedAt > HELPER_START_GRACE_MS
        ) {
          applying = false;
          setTaskbarProgress(null);
          setState({
            phase: 'ready',
            errorCode: 'apply-helper-exited',
            errorMessage: 'The update helper stopped before it could start.',
            applyProgress: null,
            canApply: true,
          });
          return;
        }
        await delay(APPLY_POLL_MS);
      }
    } catch (error) {
      applying = false;
      setTaskbarProgress(null);
      setState({
        phase: 'ready',
        errorCode: 'apply-failed',
        errorMessage: error instanceof Error ? error.message : 'The update could not be installed.',
        applyProgress: null,
        canApply: true,
      });
    }
  };

  const runCheck = async (manual: boolean): Promise<void> => {
    if (!host.isPackaged || checking || applying) return;
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
    } finally {
      checking = false;
    }
  };

  const startDownload = async (): Promise<void> => {
    const release = persisted.latest;
    if (!release || applying || downloadAbort) return;
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
    if (!release || applying) return;
    if (state.phase !== 'ready') return;
    applying = true;
    try {
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
      if (!refreshPreflight(archive.bytes).ok) {
        applying = false;
        settlePhase();
        return;
      }
      const signatureBase64 = fs.readFileSync(signaturePath, 'utf8').trim();
      const updateId = newUpdateId(release.version);
      const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      fs.writeFileSync(helperPath, fs.readFileSync(host.helperBundlePath));
      fs.rmSync(cancelPath, { force: true });
      writeJson(lockPath, { pid: process.pid, updateId, at: Date.now() });
      writeJson(path.join(workspace, WORKSPACE_FILES.pending), {
        schema: 1,
        updateId,
        fromVersion: host.currentVersion,
        toVersion: release.version,
        nonce,
        at: Date.now(),
      });
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
      const executable = process.execPath;
      const args = [
        helperPath,
        '--install',
        host.installDir,
        '--workspace',
        workspace,
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
        path.basename(executable),
        '--app-pid',
        String(process.pid),
        '--nonce',
        nonce,
      ];
      const backendPid = (globalThis as { __ytmcBackendPid?: number }).__ytmcBackendPid;
      if (typeof backendPid === 'number' && backendPid > 0) {
        args.push('--backend-pid', String(backendPid));
      }
      info(`spawning helper update=${updateId}`);
      const child = spawn(executable, args, {
        cwd: workspace,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: sanitizedEnv({ ELECTRON_RUN_AS_NODE: '1' }),
      });
      child.unref();
      void pollApply(updateId, child.pid ?? 0, release);
    } catch (error) {
      applying = false;
      setTaskbarProgress(null);
      fs.rmSync(lockPath, { force: true });
      fs.rmSync(path.join(workspace, WORKSPACE_FILES.pending), { force: true });
      setState({
        phase: 'ready',
        errorCode: 'apply-failed',
        errorMessage: error instanceof Error ? error.message : 'The update could not be started.',
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
    reconcile();
    refreshPreflight();
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
    dispose: () => {
      disposed = true;
      downloadAbort?.abort();
    },
  };
}

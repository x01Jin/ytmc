import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseVersion } from './version.cjs';

export type PreflightCode =
  | 'not-packaged'
  | 'version-unparsable'
  | 'install-missing'
  | 'running-from-stale-copy'
  | 'path-too-long'
  | 'drive-root'
  | 'unc-path'
  | 'temp-path'
  | 'reparse-point'
  | 'cloud-sync-path'
  | 'no-localappdata'
  | 'data-outside-install'
  | 'library-inside-install'
  | 'helper-missing'
  | 'install-not-writable'
  | 'parent-not-writable'
  | 'cross-volume'
  | 'insufficient-space'
  | 'insufficient-workspace-space';

export interface PreflightInput {
  isPackaged: boolean;
  installDir: string;
  userDataDir: string;
  libraryDir: string | null;
  localAppDataDir: string | null;
  helperBundlePath: string;
  currentVersion: string;
  installBytesRequired: number;
  workspaceBytesRequired: number;
}

export type PreflightOutcome = { ok: true } | { ok: false; code: PreflightCode; message: string };

const MAX_INSTALL_PATH = 200;
const STALE_SUFFIX = /\.(old|new|failed)-\d+\.\d+\.\d+-[0-9a-f]{8}$/;
const PROBE_BYTES = 256 * 1024;

function lower(value: string): string {
  return value.toLowerCase();
}

function isInside(child: string, parent: string): boolean {
  const childPath = lower(path.resolve(child));
  const parentPath = lower(path.resolve(parent));
  return childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`);
}

function probeWrite(directory: string, fileName: string): boolean {
  const probePath = path.join(directory, fileName);
  try {
    fs.writeFileSync(probePath, Buffer.alloc(PROBE_BYTES));
    fs.unlinkSync(probePath);
    return true;
  } catch {
    try {
      fs.unlinkSync(probePath);
    } catch {}
    return false;
  }
}

function hasReparseAncestor(target: string): boolean {
  let current = path.resolve(target);
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function resolvesCleanly(target: string): boolean {
  try {
    const resolved = fs.realpathSync.native(target);
    return lower(path.resolve(resolved)) === lower(path.resolve(target));
  } catch {
    return false;
  }
}

function cloudRoots(): string[] {
  const names = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial', 'Dropbox'];
  const roots: string[] = [];
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) roots.push(value);
  }
  return roots;
}

function availableBytes(target: string): bigint | null {
  try {
    const stats = fs.statfsSync(target, { bigint: true });
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function blocked(code: PreflightCode, message: string): PreflightOutcome {
  return { ok: false, code, message };
}

export function runPreflight(input: PreflightInput): PreflightOutcome {
  if (!input.isPackaged) {
    return blocked('not-packaged', 'Updates are only available in the installed app.');
  }
  if (!parseVersion(input.currentVersion)) {
    return blocked('version-unparsable', 'The running version cannot be compared with releases.');
  }
  const installDir = path.resolve(input.installDir);
  let installStats: fs.Stats;
  try {
    installStats = fs.statSync(installDir);
  } catch {
    return blocked('install-missing', 'The app folder could not be read.');
  }
  if (!installStats.isDirectory()) {
    return blocked('install-missing', 'The app folder could not be read.');
  }
  if (STALE_SUFFIX.test(path.basename(installDir))) {
    return blocked(
      'running-from-stale-copy',
      'This is not the active app folder. Start the app from its installed location.'
    );
  }
  if (installDir.length > MAX_INSTALL_PATH) {
    return blocked(
      'path-too-long',
      `The app folder path is longer than ${MAX_INSTALL_PATH} characters. Move the app to a shorter path to enable updates.`
    );
  }
  const parentDir = path.dirname(installDir);
  if (parentDir === installDir) {
    return blocked(
      'drive-root',
      'The app cannot be updated from a drive root. Move it into a folder.'
    );
  }
  if (installDir.startsWith('\\\\')) {
    return blocked('unc-path', 'Network locations are not supported for updates.');
  }
  const tempRoots = [os.tmpdir(), process.env.TEMP, process.env.TMP];
  for (const root of tempRoots) {
    if (typeof root === 'string' && root.length > 0 && isInside(installDir, root)) {
      return blocked(
        'temp-path',
        'The app is running from a temporary folder. Extract it to a permanent location to enable updates.'
      );
    }
  }
  if (
    hasReparseAncestor(installDir) ||
    !resolvesCleanly(installDir) ||
    !resolvesCleanly(parentDir)
  ) {
    return blocked(
      'reparse-point',
      'The app folder is a link or junction. Updates need the real folder.'
    );
  }
  for (const root of cloudRoots()) {
    if (isInside(installDir, root)) {
      return blocked(
        'cloud-sync-path',
        'Cloud-synced folders are not supported for updates. Move the app out of OneDrive or Dropbox.'
      );
    }
  }
  if (!input.localAppDataDir || input.localAppDataDir.length === 0) {
    return blocked('no-localappdata', 'The local app data folder is unavailable.');
  }
  if (lower(path.resolve(input.userDataDir)) !== lower(path.join(installDir, 'data'))) {
    return blocked(
      'data-outside-install',
      'App data must live inside the app folder to update safely.'
    );
  }
  if (input.libraryDir && isInside(input.libraryDir, installDir)) {
    return blocked(
      'library-inside-install',
      'The library folder is inside the app folder. Choose a library folder outside it to enable updates.'
    );
  }
  if (!fs.existsSync(input.helperBundlePath)) {
    return blocked('helper-missing', 'The update helper is missing from this build.');
  }
  if (!probeWrite(installDir, '.ytmc-write-probe')) {
    return blocked(
      'install-not-writable',
      'The app folder is not writable. Move the app to a folder you own to enable updates.'
    );
  }
  if (!probeWrite(parentDir, '.ytmc-write-probe')) {
    return blocked(
      'parent-not-writable',
      'The folder above the app is not writable. Updates need to rename the app folder.'
    );
  }
  let parentStats: fs.Stats;
  try {
    parentStats = fs.statSync(parentDir);
  } catch {
    return blocked('parent-not-writable', 'The folder above the app could not be read.');
  }
  if (parentStats.dev !== installStats.dev) {
    return blocked('cross-volume', 'The app folder and its parent are on different volumes.');
  }
  const installFree = availableBytes(installDir);
  if (installFree !== null && installFree < BigInt(Math.ceil(input.installBytesRequired))) {
    return blocked('insufficient-space', 'Not enough free space to unpack the update.');
  }
  const workspaceFree = availableBytes(input.localAppDataDir);
  if (workspaceFree !== null && workspaceFree < BigInt(Math.ceil(input.workspaceBytesRequired))) {
    return blocked('insufficient-workspace-space', 'Not enough free space to download the update.');
  }
  return { ok: true };
}

import type { FetchJson } from './http.cjs';
import { compareVersions, isNewerVersion, parseVersion } from './version.cjs';

export interface ReleaseAsset {
  name: string;
  size: number;
  digestHex: string;
  downloadUrl: string;
}

export interface ReleaseCandidate {
  version: string;
  tag: string;
  publishedAt: string;
  archive: ReleaseAsset;
  signature: ReleaseAsset;
}

export type ReleaseLookup =
  | { status: 'available'; release: ReleaseCandidate }
  | { status: 'up-to-date'; version: string }
  | { status: 'invalid-release'; version: string; reason: string }
  | { status: 'error'; reason: string; message: string };

export type ReleaseNotesLookup =
  | { status: 'ok'; version: string; notes: string }
  | { status: 'missing'; version: string }
  | { status: 'error'; reason: string; message: string };

export interface ReleaseScanOptions {
  fetchJson: FetchJson;
  currentVersion: string;
  apiBase?: string;
  repo?: string;
}

export type ReleaseNotesOptions = ReleaseScanOptions;

const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_REPO = 'x01Jin/ytmc';
const MAX_PAGES = 3;
const PAGE_SIZE = 100;
const NOTES_LIMIT = 20_000;
const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ytmc-updater',
};
const DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;
const NUMERIC_TAG = /^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/;

interface RawAsset {
  name?: unknown;
  size?: unknown;
  digest?: unknown;
  state?: unknown;
  browser_download_url?: unknown;
}

interface RawRelease {
  draft?: unknown;
  prerelease?: unknown;
  tag_name?: unknown;
  body?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readAsset(value: unknown): RawAsset | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as RawAsset;
}

function archiveAssetOf(release: RawRelease, version: string): ReleaseAsset | { reason: string } {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const wanted = `ytmc-${version}-win.zip`;
  const found = assets
    .map(readAsset)
    .filter((asset): asset is RawAsset => asset !== null && asset.name === wanted);
  if (found.length !== 1) return { reason: 'archive-asset-missing' };
  const asset = found[0];
  if (asset.state !== 'uploaded') return { reason: 'archive-asset-not-uploaded' };
  if (typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    return { reason: 'archive-asset-size-invalid' };
  }
  const digest = typeof asset.digest === 'string' ? DIGEST_PATTERN.exec(asset.digest) : null;
  if (!digest) return { reason: 'archive-digest-missing' };
  const downloadUrl = text(asset.browser_download_url);
  if (!downloadUrl.startsWith('https://')) return { reason: 'archive-url-missing' };
  return { name: wanted, size: asset.size, digestHex: digest[1], downloadUrl };
}

function signatureAssetOf(release: RawRelease, version: string): ReleaseAsset | { reason: string } {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const wanted = `ytmc-${version}-win.zip.sig`;
  const found = assets
    .map(readAsset)
    .filter((asset): asset is RawAsset => asset !== null && asset.name === wanted);
  if (found.length !== 1) return { reason: 'signature-asset-missing' };
  const asset = found[0];
  if (asset.state !== 'uploaded') return { reason: 'signature-asset-not-uploaded' };
  if (typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    return { reason: 'signature-asset-size-invalid' };
  }
  const downloadUrl = text(asset.browser_download_url);
  if (!downloadUrl.startsWith('https://')) return { reason: 'signature-url-missing' };
  return { name: wanted, size: asset.size, digestHex: '', downloadUrl };
}

function releaseVersionOf(release: RawRelease): string | null {
  if (release.draft === true || release.prerelease === true) return null;
  const tag = text(release.tag_name);
  if (!NUMERIC_TAG.test(tag)) return null;
  const parsed = parseVersion(tag);
  if (!parsed) return null;
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function notesOf(release: RawRelease): string {
  const body = text(release.body).trim();
  return body.length > NOTES_LIMIT ? `${body.slice(0, NOTES_LIMIT)}…` : body;
}

export async function fetchReleaseNotes(options: ReleaseNotesOptions): Promise<ReleaseNotesLookup> {
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const repo = options.repo ?? DEFAULT_REPO;
  const headers = API_HEADERS;
  const parsed = parseVersion(options.currentVersion);
  if (!parsed) return { status: 'missing', version: options.currentVersion };
  const version = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  for (const tag of [`v${version}`, version]) {
    let response;
    try {
      response = await options.fetchJson(`${apiBase}/repos/${repo}/releases/tags/${tag}`, {
        headers,
      });
    } catch (error) {
      return {
        status: 'error',
        reason: 'network',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (response.status === 404) continue;
    if (response.status !== 200) {
      return {
        status: 'error',
        reason: `http-${response.status}`,
        message: 'Release notes lookup failed.',
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch {
      return {
        status: 'error',
        reason: 'invalid-json',
        message: 'Release notes lookup returned invalid data.',
      };
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return {
        status: 'error',
        reason: 'invalid-payload',
        message: 'Release notes lookup returned invalid data.',
      };
    }
    const release = payload as RawRelease;
    if (releaseVersionOf(release) !== version) return { status: 'missing', version };
    return { status: 'ok', version, notes: notesOf(release) };
  }
  return { status: 'missing', version };
}

export async function scanForRelease(options: ReleaseScanOptions): Promise<ReleaseLookup> {
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const repo = options.repo ?? DEFAULT_REPO;
  const headers = API_HEADERS;
  const releases: Array<{ version: string; release: RawRelease }> = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${apiBase}/repos/${repo}/releases?per_page=${PAGE_SIZE}&page=${page}`;
    let response;
    try {
      response = await options.fetchJson(url, { headers });
    } catch (error) {
      return {
        status: 'error',
        reason: 'network',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (response.status !== 200) {
      return {
        status: 'error',
        reason: `http-${response.status}`,
        message: 'Release lookup failed.',
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch {
      return {
        status: 'error',
        reason: 'invalid-json',
        message: 'Release lookup returned invalid data.',
      };
    }
    if (!Array.isArray(payload)) {
      return {
        status: 'error',
        reason: 'invalid-payload',
        message: 'Release lookup returned invalid data.',
      };
    }
    for (const entry of payload) {
      if (typeof entry !== 'object' || entry === null) continue;
      const raw = entry as RawRelease;
      const version = releaseVersionOf(raw);
      if (version) releases.push({ version, release: raw });
    }
    if (payload.length < PAGE_SIZE) break;
  }
  if (releases.length === 0) {
    return { status: 'error', reason: 'no-releases', message: 'No published release found.' };
  }
  releases.sort((a, b) => {
    const left = parseVersion(a.version);
    const right = parseVersion(b.version);
    if (!left || !right) return 0;
    return compareVersions(right, left);
  });
  const newest = releases[0];
  if (!isNewerVersion(newest.version, options.currentVersion)) {
    return { status: 'up-to-date', version: options.currentVersion };
  }
  const archive = archiveAssetOf(newest.release, newest.version);
  if ('reason' in archive) {
    return { status: 'invalid-release', version: newest.version, reason: archive.reason };
  }
  const signature = signatureAssetOf(newest.release, newest.version);
  if ('reason' in signature) {
    return { status: 'invalid-release', version: newest.version, reason: signature.reason };
  }
  return {
    status: 'available',
    release: {
      version: newest.version,
      tag: text(newest.release.tag_name),
      publishedAt: text(newest.release.published_at),
      archive,
      signature,
    },
  };
}

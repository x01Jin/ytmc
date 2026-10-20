import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, FFMPEG_PATH, PLUGINS_DIR, YTDLP_PATH, YTDLP_SCRIPT_PATH } from '../config.js';

export interface YtDlpLaunch {
  command: string;
  prefixArgs: string[];
  version: string | null;
  error: string | null;
}

interface Candidate {
  command: string;
  prefixArgs: string[];
}

let cached: YtDlpLaunch | null = null;
let cachedAt = 0;
let pending: Promise<YtDlpLaunch> | null = null;

const YTDLP_VERSION_TIMEOUT_MS = 8000;
const YTDLP_FAILURE_RETRY_MS = 30_000;
const FFMPEG_VERSION_TIMEOUT_MS = 5000;

export function ytdlpEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: PLUGINS_DIR,
    XDG_CACHE_HOME: path.join(DATA_DIR, 'cache'),
  };
}

function describe(candidate: Candidate): string {
  return [candidate.command, ...candidate.prefixArgs].join(' ');
}

function serverLog(message: string): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(DATA_DIR, 'server.log'),
      `${new Date().toISOString()} ${message}\n`,
      'utf8'
    );
  } catch (err: unknown) {
    console.warn('Could not write server.log:', err instanceof Error ? err.message : err);
  }
}

function buildCandidates(): Candidate[] {
  const list: Candidate[] = [];
  const seen = new Set<string>();

  const add = (command: string, prefixArgs: string[] = []) => {
    const key = `${command}\0${prefixArgs.join('\0')}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ command, prefixArgs });
  };

  add(YTDLP_PATH);

  const scriptPath = /\.exe$/i.test(YTDLP_PATH) ? YTDLP_SCRIPT_PATH : YTDLP_PATH;
  if (fs.existsSync(scriptPath)) {
    if (process.platform === 'win32') {
      add('py', [scriptPath]);
      add('python', [scriptPath]);
    } else {
      add('python3', [scriptPath]);
    }
    add(scriptPath);
  }

  return list;
}

function probe(candidate: Candidate): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      candidate.command,
      [...candidate.prefixArgs, '--version'],
      { timeout: YTDLP_VERSION_TIMEOUT_MS, env: ytdlpEnv(), windowsHide: true },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const version = String(stdout).trim().split('\n')[0];
        if (!version) {
          reject(new Error(`${describe(candidate)} returned an empty version`));
          return;
        }
        resolve(version);
      }
    );
  });
}

async function probeYtDlp(): Promise<YtDlpLaunch> {
  const candidates = buildCandidates();
  let lastError = '';

  for (const candidate of candidates) {
    try {
      const version = await probe(candidate);
      const launch: YtDlpLaunch = { ...candidate, version, error: null };
      cached = launch;
      cachedAt = Date.now();
      const message = `yt-dlp ready: ${version} via "${describe(candidate)}"`;
      console.log(message);
      serverLog(message);
      return launch;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const launch: YtDlpLaunch = {
    command: YTDLP_PATH,
    prefixArgs: [],
    version: null,
    error: lastError,
  };
  cached = launch;
  cachedAt = Date.now();
  const message =
    `WARNING: yt-dlp is not launchable (tried ${candidates.map(describe).join(', ')}; ` +
    `last error: ${lastError}). Session tests, inspection, and conversion will fail until ` +
    `the bundled yt-dlp or a working Python launcher is available.`;
  console.warn(message);
  serverLog(message);
  return launch;
}

export async function ensureYtDlp(): Promise<YtDlpLaunch> {
  if (cached?.version) return cached;
  if (cached && Date.now() - cachedAt < YTDLP_FAILURE_RETRY_MS) return cached;
  if (pending) return pending;

  pending = probeYtDlp().finally(() => {
    pending = null;
  });
  return pending;
}

export async function ensureFfmpeg(): Promise<string | null> {
  const cmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg';
  try {
    const version: string = await new Promise((resolve, reject) => {
      execFile(
        cmd,
        ['-version'],
        {
          timeout: FFMPEG_VERSION_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(String(stdout).split('\n')[0].trim());
        }
      );
    });
    console.log(`ffmpeg ready: ${version} via "${cmd}"`);
    return version;
  } catch (err: any) {
    console.warn(
      `WARNING: ffmpeg not found ("${cmd}": ${err?.message || err}). Conversions will download but fail at audio extraction. ` +
        `Place ffmpeg(.exe) + ffprobe(.exe) in bin/ or set FFMPEG_PATH.`
    );
    return null;
  }
}

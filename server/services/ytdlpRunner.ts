import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, FFMPEG_PATH, PLUGINS_DIR, YTDLP_PATH } from '../config.js';

export interface YtDlpLaunch {
  command: string;
  prefixArgs: string[];
  version: string | null;
}

let cached: YtDlpLaunch | null = null;

const YTDLP_VERSION_TIMEOUT_MS = 8000;
const FFMPEG_VERSION_TIMEOUT_MS = 5000;

export function ytdlpEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONPATH: PLUGINS_DIR,
    XDG_CACHE_HOME: path.join(DATA_DIR, 'cache'),
  };
}

export async function ensureYtDlp(): Promise<YtDlpLaunch> {
  if (cached) return cached;

  const isExe = /\.exe$/i.test(YTDLP_PATH);
  const candidates: Array<{ command: string; prefixArgs: string[] }> = isExe
    ? [{ command: YTDLP_PATH, prefixArgs: [] }]
    : process.platform === 'win32'
      ? [
          { command: 'py', prefixArgs: [YTDLP_PATH] },
          { command: 'python', prefixArgs: [YTDLP_PATH] },
          { command: YTDLP_PATH, prefixArgs: [] },
        ]
      : [
          { command: YTDLP_PATH, prefixArgs: [] },
          { command: 'python3', prefixArgs: [YTDLP_PATH] },
        ];

  let lastError = '';
  for (const c of candidates) {
    try {
      const version = await new Promise<string>((resolve, reject) => {
        execFile(
          c.command,
          [...c.prefixArgs, '--version'],
          { timeout: YTDLP_VERSION_TIMEOUT_MS, env: ytdlpEnv() },
          (err, stdout) => {
            if (err) reject(err);
            else resolve(String(stdout).trim().split('\n')[0]);
          }
        );
      });
      cached = { ...c, version };
      console.log(`yt-dlp ready: ${version} via "${c.command}"`);
      return cached;
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  console.warn(
    `WARNING: yt-dlp is not launchable (tried ${candidates.map(c => c.command).join(', ')}; last error: ${lastError}). ` +
      `Session tests, inspection, and conversion will fail until a working Python launcher or yt-dlp.exe is available.`
  );
  cached = { command: YTDLP_PATH, prefixArgs: [], version: null };
  return cached;
}

export function ytdlpLaunch(): YtDlpLaunch {
  return cached ?? { command: YTDLP_PATH, prefixArgs: [], version: null };
}

export async function ensureFfmpeg(): Promise<string | null> {
  const cmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg';
  try {
    const version: string = await new Promise((resolve, reject) => {
      execFile(cmd, ['-version'], { timeout: FFMPEG_VERSION_TIMEOUT_MS }, (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout).split('\n')[0].trim());
      });
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

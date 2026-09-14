import { execFile } from 'child_process';
import fs from 'fs';
import { FFMPEG_PATH, PLUGINS_DIR, YTDLP_PATH } from '../config.js';

export interface YtDlpLaunch {
  /** Executable to spawn (yt-dlp itself, or a Python launcher on Windows). */
  command: string;
  /** Args prepended before every yt-dlp invocation (e.g. the zipapp path). */
  prefixArgs: string[];
  /** Resolved yt-dlp version string, when probed successfully. */
  version: string | null;
}

let cached: YtDlpLaunch | null = null;

/**
 * Shared environment for every yt-dlp child process (plugin discovery).
 */
export function ytdlpEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONPATH: PLUGINS_DIR };
}

/**
 * Probe candidate launch commands and cache the first one that reports a
 * version. On Windows the bundled `bin/yt-dlp` is an extensionless Python
 * zipapp that Node cannot CreateProcess directly (`spawn ENOENT`), so it
 * must go through the `py` launcher. A user-supplied `YTDLP_PATH` ending
 * in `.exe` is used directly.
 */
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
        execFile(c.command, [...c.prefixArgs, '--version'], { timeout: 30000, env: ytdlpEnv() }, (err, stdout) => {
          if (err) reject(err);
          else resolve(String(stdout).trim().split('\n')[0]);
        });
      });
      cached = { ...c, version };
      console.log(`yt-dlp ready: ${version} via "${c.command}"`);
      return cached;
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  console.warn(
    `WARNING: yt-dlp is not launchable (tried ${candidates.map((c) => c.command).join(', ')}; last error: ${lastError}). ` +
      `Session tests, inspection, and conversion will fail until a working Python launcher or yt-dlp.exe is available.`
  );
  cached = { command: YTDLP_PATH, prefixArgs: [], version: null };
  return cached;
}

/**
 * Synchronous accessor for already-resolved launch config. Call
 * `ensureYtDlp()` once at boot; this never throws so request paths stay simple.
 */
export function ytdlpLaunch(): YtDlpLaunch {
  return cached ?? { command: YTDLP_PATH, prefixArgs: [], version: null };
}

/**
 * Boot probe for the bundled ffmpeg (extraction, thumbnail embedding, and
 * file tagging all require it). Warns loudly instead of failing conversions
 * at 75%+ with a cryptic postprocessor error.
 */
export async function ensureFfmpeg(): Promise<string | null> {
  const cmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg';
  try {
    const version: string = await new Promise((resolve, reject) => {
      execFile(cmd, ['-version'], { timeout: 15000 }, (err, stdout) => {
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

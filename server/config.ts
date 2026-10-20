import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config();

const MAX_PORT = 65535;
const DEV_PORT = 3000;
const DEFAULT_POT_PORT = 4416;

function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_PORT) {
      return parsed;
    }
    console.warn(`Invalid PORT="${raw}", falling back to default`);
  }
  return process.env.NODE_ENV === 'production' ? 0 : DEV_PORT;
}

export const PORT = resolvePort();
export const HOST = process.env.HOST || '127.0.0.1';

export const ROOT_DIR = process.cwd();
export const BIN_DIR = path.join(ROOT_DIR, 'bin');
export const PLUGINS_DIR = path.join(ROOT_DIR, 'plugins');
export const YTDLP_SCRIPT_PATH = path.join(BIN_DIR, 'yt-dlp');
export const YTDLP_PATH =
  process.env.YTDLP_PATH ||
  path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
export const FFMPEG_PATH =
  process.env.FFMPEG_PATH ||
  path.join(BIN_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
export const FFPROBE_PATH =
  process.env.FFPROBE_PATH ||
  path.join(BIN_DIR, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

function resolveBgutilPath(): string {
  if (process.env.BGUTIL_PATH) return process.env.BGUTIL_PATH;
  const names = process.platform === 'win32' ? ['bgutil-pot.exe', 'bgutil-pot'] : ['bgutil-pot'];
  return (
    names.map(name => path.join(BIN_DIR, name)).find(candidate => fs.existsSync(candidate)) ??
    path.join(BIN_DIR, names[0])
  );
}

export const BGUTIL_PATH = resolveBgutilPath();
function resolvePotPort(): number {
  const raw = process.env.POT_PORT;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_PORT) {
      return parsed;
    }
    console.warn(`Invalid POT_PORT="${raw}", falling back to default`);
  }
  return DEFAULT_POT_PORT;
}

export const POT_PORT = resolvePotPort();
export const DATA_DIR = process.env.APP_DATA_DIR || path.join(ROOT_DIR, 'data');
export const DOWNLOADS_DIR = process.env.APP_DOWNLOADS_DIR || path.join(ROOT_DIR, 'downloads');
export const STATIC_DIR = process.env.APP_STATIC_DIR || path.join(ROOT_DIR, 'dist');
export const COOKIES_FILE = path.join(DATA_DIR, 'cookies.txt');
export const GUEST_COOKIES_FILE = path.join(DATA_DIR, 'guest_cookies.txt');

export const SUPPORTED_FORMATS = ['best', 'opus', 'm4a', 'mp3', 'flac', 'wav'] as const;

export const SUPPORTED_BITRATES = ['native', '160k', '128k', '192k', '256k', '320k'] as const;

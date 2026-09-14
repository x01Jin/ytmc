import path from 'path';

function resolvePort(): number {
  const raw = process.env.PORT;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
      return parsed;
    }
    console.warn(`Invalid PORT="${raw}", falling back to default`);
  }
  // Production (incl. desktop app) defaults to a random free port (0);
  // development defaults to 3000 for a stable local URL.
  return process.env.NODE_ENV === 'production' ? 0 : 3000;
}

export const PORT = resolvePort();
export const HOST = process.env.HOST || '127.0.0.1';

export const ROOT_DIR = process.cwd();
export const BIN_DIR = path.join(ROOT_DIR, 'bin');
export const PLUGINS_DIR = path.join(ROOT_DIR, 'plugins');
export const YTDLP_PATH = process.env.YTDLP_PATH || path.join(BIN_DIR, 'yt-dlp');
export const FFMPEG_PATH = process.env.FFMPEG_PATH || path.join(BIN_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
export const FFPROBE_PATH = process.env.FFPROBE_PATH || path.join(BIN_DIR, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
export const BGUTIL_PATH = path.join(BIN_DIR, 'bgutil-pot');
export const POT_PORT = process.env.POT_PORT ? Number(process.env.POT_PORT) || 4416 : 4416;
// Packaged desktop builds override these so the app writes outside ASAR.
export const DATA_DIR = process.env.APP_DATA_DIR || path.join(ROOT_DIR, 'data');
export const DOWNLOADS_DIR = process.env.APP_DOWNLOADS_DIR || path.join(ROOT_DIR, 'downloads');
export const STATIC_DIR = process.env.APP_STATIC_DIR || path.join(ROOT_DIR, 'dist');
export const COOKIES_FILE = path.join(DATA_DIR, 'cookies.txt');
export const GUEST_COOKIES_FILE = path.join(DATA_DIR, 'guest_cookies.txt');

export const SUPPORTED_FORMATS = ['best', 'opus', 'm4a', 'mp3', 'flac', 'wav'] as const;
export type AudioFormat = typeof SUPPORTED_FORMATS[number];

export const SUPPORTED_BITRATES = ['native', '160k', '128k', '192k', '256k', '320k'] as const;
export type AudioBitrate = typeof SUPPORTED_BITRATES[number];

export const DEFAULT_DEMO_TRACKS = [
  {
    id: 'dQw4w9WgXcQ',
    title: 'Rick Astley - Never Gonna Give You Up',
    author: 'Rick Astley',
    duration: '3:33',
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    genre: 'Pop / Dance',
    tag: 'Direct Conversion Verified'
  }
];

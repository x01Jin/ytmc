import { execFile } from 'child_process';
import { CookieService } from './cookieService.js';
import { cookiesAllowed, extractorArgsFor, resolveStrategy } from './potService.js';
import { ytdlpEnv, ytdlpLaunch } from './ytdlpRunner.js';

export interface YouTubeSearchResult {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration?: string;
  durationSeconds?: number;
  viewCount?: number;
}

const SEARCH_TIMEOUT_MS = 30000;
const MAX_QUERY_LENGTH = 120;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const BOT_PATTERN =
  /sign in to confirm|not a bot|login[ _]required|cookies-from-browser|HTTP Error 403/i;

function isBotOutput(text: string): boolean {
  return BOT_PATTERN.test(text);
}

function pickThumbnail(entry: any, videoId: string): string {
  if (typeof entry.thumbnail === 'string' && entry.thumbnail) return entry.thumbnail;
  const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  let best: string | null = null;
  let bestWidth = -1;
  for (const t of thumbs) {
    if (t && typeof t.url === 'string' && typeof t.width === 'number' && t.width > bestWidth) {
      bestWidth = t.width;
      best = t.url;
    }
  }
  if (best) return best;
  const last = thumbs.length > 0 ? thumbs[thumbs.length - 1] : null;
  if (last && typeof last.url === 'string') return last.url;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function toSearchResult(entry: any): YouTubeSearchResult | null {
  const id = typeof entry.id === 'string' ? entry.id : null;
  if (!id || !VIDEO_ID_PATTERN.test(id)) return null;
  const title =
    typeof entry.title === 'string' && entry.title ? entry.title : `YouTube Video (${id})`;
  const author =
    (typeof entry.channel === 'string' && entry.channel) ||
    (typeof entry.uploader === 'string' && entry.uploader) ||
    'YouTube';
  const result: YouTubeSearchResult = {
    id,
    title,
    author,
    thumbnail: pickThumbnail(entry, id),
  };
  if (typeof entry.duration_string === 'string' && entry.duration_string) {
    result.duration = entry.duration_string;
  }
  if (typeof entry.duration === 'number' && Number.isFinite(entry.duration)) {
    result.durationSeconds = entry.duration;
  }
  if (typeof entry.view_count === 'number' && Number.isFinite(entry.view_count)) {
    result.viewCount = entry.view_count;
  }
  return result;
}

function botError(): Error {
  return new Error(
    'YouTube is asking for session verification for this right now. Open Session & Cookie Settings to import browser cookies or auto-fetch a fresh session, then try again.'
  );
}

export namespace YouTubeService {
  export function clampLimit(raw: unknown, fallback = 12): number {
    const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(25, Math.max(1, Math.floor(n)));
  }

  export function sanitizeQuery(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.trim().slice(0, MAX_QUERY_LENGTH);
  }

  export function isBotBlockedMessage(text: unknown): boolean {
    if (typeof text !== 'string') return false;
    return /session|verification|sign in to confirm|not a bot|login[ _]required|cookies-from-browser|HTTP Error 403/i.test(
      text
    );
  }

  export async function searchVideos(query: string, limit: number): Promise<YouTubeSearchResult[]> {
    const clean = sanitizeQuery(query);
    if (!clean) throw new Error('Search text is required');
    const count = clampLimit(limit);
    const { strategy } = await resolveStrategy();
    const launch = ytdlpLaunch();
    const cookiesPath = CookieService.getCookiesPath();
    const useCookies = cookiesAllowed(strategy, !!cookiesPath);
    const args = [
      ...launch.prefixArgs,
      '--js-runtimes',
      `node:${process.execPath}`,
      ...extractorArgsFor(strategy),
      '--dump-json',
      '--flat-playlist',
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
    ];
    if (useCookies && cookiesPath) args.push('--cookies', cookiesPath);
    args.push(`ytsearch${count}:${clean}`);

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        launch.command,
        args,
        {
          timeout: SEARCH_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
          env: ytdlpEnv(),
        },
        (error, out, stderr) => {
          if (error) {
            const detail = String(stderr || error.message);
            reject(
              isBotOutput(detail)
                ? botError()
                : new Error(
                    `YouTube search failed: ${detail.split('\n').filter(l => l.includes('ERROR:'))[0] || error.message}`
                  )
            );
            return;
          }
          resolve(String(out));
        }
      );
    });

    const results: YouTubeSearchResult[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        const item = toSearchResult(entry);
        if (item) results.push(item);
      } catch {}
      if (results.length >= count) break;
    }
    return results.slice(0, count);
  }
}

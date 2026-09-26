import type {
  AppSettings,
  ConversionJob,
  ConversionOptions,
  CookieStatus,
  DemoTrack,
  HistoryEntry,
  LibraryData,
  MusicTagCandidate,
  MusicTags,
  TagSource,
  VideoMetadata,
  YouTubeSearchResult,
} from '../types';

let loopbackTokenPromise: Promise<string> | null = null;

const getDedup = new Map<string, { at: number; promise: Promise<unknown> }>();
const GET_DEDUP_TTL_MS = 2000;

function dedupedGet<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = getDedup.get(key);
  if (cached && now - cached.at < GET_DEDUP_TTL_MS) return cached.promise as Promise<T>;
  const promise = loader().finally(() => {
    const entry = getDedup.get(key);
    if (entry?.promise === promise) getDedup.delete(key);
  });
  getDedup.set(key, { at: now, promise });
  return promise;
}

async function getLoopbackToken(): Promise<string> {
  if (!loopbackTokenPromise) {
    loopbackTokenPromise = fetch('/api/health')
      .then(res => res.json())
      .then(json => (typeof json.loopbackToken === 'string' ? json.loopbackToken : ''))
      .catch(() => '');
  }
  return loopbackTokenPromise;
}

async function mutatingHeaders(): Promise<Record<string, string>> {
  const token = await getLoopbackToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'x-loopback-token': token } : {}),
  };
}

export namespace ApiClient {
  export async function fetchVideoInfo(url: string): Promise<VideoMetadata> {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to fetch video details');
    }
    return json.data;
  }

  export async function startConversion(
    url: string,
    options: ConversionOptions
  ): Promise<ConversionJob> {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: await mutatingHeaders(),
      body: JSON.stringify({
        url,
        format: options.format,
        bitrate: options.bitrate,
        trimStart: options.trimStart.trim() || undefined,
        trimEnd: options.trimEnd.trim() || undefined,
        volumeBoost: options.volumeBoost,
        normalizeMode: options.normalizeMode,
        normalizeAudio: options.normalizeMode === 'loudness',
        embedThumbnail: options.embedThumbnail,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to initiate audio conversion');
    }
    return json.job;
  }

  export async function searchTags(
    query: string,
    source: TagSource = 'all'
  ): Promise<MusicTagCandidate[]> {
    if (!query || !query.trim()) return [];
    try {
      const res = await fetch(
        `/api/tags/search?q=${encodeURIComponent(query.trim())}&source=${source}`
      );
      const json = await res.json();
      if (res.ok && json.success) {
        return json.data || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  export async function applyTags(jobId: string, tags: MusicTags): Promise<ConversionJob> {
    const res = await fetch(`/api/tags/apply/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      headers: await mutatingHeaders(),
      body: JSON.stringify({ tags }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to apply tags to audio');
    }
    return json.job;
  }

  export async function getJobStatus(jobId: string): Promise<ConversionJob> {
    const res = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to check conversion status');
    }
    return json.job;
  }

  export async function getRecentJobs(): Promise<ConversionJob[]> {
    return dedupedGet('jobs', async () => {
      const res = await fetch('/api/jobs');
      const json = await res.json();
      if (!res.ok || !json.success) {
        return [];
      }
      return json.jobs || [];
    });
  }

  export async function getHistory(): Promise<HistoryEntry[]> {
    return dedupedGet('history', async () => {
      const res = await fetch('/api/history');
      const json = await res.json();
      if (!res.ok || !json.success) {
        return [];
      }
      return json.data || [];
    });
  }

  export async function searchYouTube(
    query: string,
    limit = 12,
    signal?: AbortSignal
  ): Promise<YouTubeSearchResult[]> {
    let res: Response;
    try {
      res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
        signal,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new Error('Cannot reach the local server. Start it with `npm run dev` and reload.', {
        cause: err,
      });
    }
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'YouTube search failed');
    }
    return json.data || [];
  }

  export function youTubeWatchUrl(videoId: string): string {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  export function openExternalLink(url: string): void {
    const desktop = (
      window as unknown as {
        desktop?: { openExternal?: (target: string) => void };
      }
    ).desktop;
    if (desktop?.openExternal) {
      desktop.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  export async function deleteHistoryItem(jobId: string): Promise<void> {
    const res = await fetch(`/api/history/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to remove history entry');
    }
  }

  export async function clearHistory(): Promise<void> {
    const res = await fetch('/api/history', {
      method: 'DELETE',
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to clear history');
    }
  }

  export async function getCookieStatus(): Promise<CookieStatus> {
    return dedupedGet('cookies', async () => {
      const res = await fetch('/api/cookies');
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          configured: false,
          sizeBytes: 0,
          lineCount: 0,
          lastModified: null,
          sampleDomains: [],
        };
      }
      return json.data;
    });
  }

  export async function saveCookies(
    cookies: string
  ): Promise<{ success: boolean; message: string; count: number }> {
    const res = await fetch('/api/cookies', {
      method: 'POST',
      headers: await mutatingHeaders(),
      body: JSON.stringify({ cookies }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to save cookies');
    }
    return json;
  }

  export async function autoFetchCookies(): Promise<{
    success: boolean;
    message: string;
    count: number;
    status: CookieStatus;
  }> {
    const res = await fetch('/api/cookies/auto-fetch', {
      method: 'POST',
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to auto-fetch guest session');
    }
    return json;
  }

  export async function testSession(): Promise<{
    success: boolean;
    message: string;
    isAccountSession: boolean;
    title?: string;
    duration?: string;
    errorDetails?: string;
    strategy?: 'pot' | 'fallback';
    potReachable?: boolean;
    cookiesUsed?: boolean;
  }> {
    const res = await fetch('/api/cookies/test', {
      method: 'POST',
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to test session');
    }
    return json.data;
  }

  export async function clearCookies(): Promise<boolean> {
    const res = await fetch('/api/cookies', {
      method: 'DELETE',
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    return json.success === true;
  }

  export async function getDemoTracks(): Promise<DemoTrack[]> {
    try {
      const res = await fetch('/api/demo-tracks');
      const json = await res.json();
      if (res.ok && json.success) {
        return json.data;
      }
      return [];
    } catch {
      return [];
    }
  }

  export async function getSettings(): Promise<AppSettings> {
    return dedupedGet('settings', async () => {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load settings');
      }
      return json.data;
    });
  }

  export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: await mutatingHeaders(),
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to save settings');
    }
    return json.data;
  }

  export async function resetSettings(): Promise<AppSettings> {
    const res = await fetch('/api/settings/reset', {
      method: 'POST',
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to reset settings');
    }
    return json.data;
  }

  export async function getLibrary(): Promise<LibraryData> {
    return dedupedGet('library', async () => {
      const res = await fetch('/api/library');
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load library');
      }
      return json.data;
    });
  }

  export async function importLibraryFile(file: File): Promise<void> {
    const res = await fetch('/api/library/import', {
      method: 'POST',
      headers: {
        ...(await mutatingHeaders()),
        'Content-Type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
      body: await file.arrayBuffer(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not copy audio into the library');
    }
  }

  export async function probeLibraryFile(jobId: string): Promise<{
    durationSeconds: number | null;
    format: string;
    sizeBytes: number;
  }> {
    const res = await fetch(`/api/library/${encodeURIComponent(jobId)}/probe`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not read audio duration');
    }
    return json.data;
  }

  export async function trimLibraryFile(jobId: string, start: string, end: string): Promise<void> {
    const res = await fetch(`/api/library/${encodeURIComponent(jobId)}/trim`, {
      method: 'POST',
      headers: await mutatingHeaders(),
      body: JSON.stringify({ start, end }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not trim the audio file');
    }
  }

  export async function editLibraryFile(
    jobId: string,
    patch: {
      format?: string;
      bitrate?: string;
      normalizeMode?: string;
      normalizeAudio?: boolean;
      volumeBoost?: number;
      title?: string;
      artist?: string;
    }
  ): Promise<{ coverDropped?: boolean } | void> {
    const res = await fetch(`/api/library/${encodeURIComponent(jobId)}/edit`, {
      method: 'POST',
      headers: await mutatingHeaders(),
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not update the audio file');
    }
    return json.data ?? undefined;
  }

  export async function deleteLibraryFile(jobId: string): Promise<void> {
    const res = await fetch(`/api/library/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to delete file');
    }
  }

  export async function revealFile(jobId: string): Promise<void> {
    const res = await fetch('/api/files/reveal', {
      method: 'POST',
      headers: await mutatingHeaders(),
      body: JSON.stringify({ jobId }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not reveal the file');
    }
  }
}

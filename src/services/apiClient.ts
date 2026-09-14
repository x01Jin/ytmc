import { ConversionJob, ConversionOptions, CookieStatus, DemoTrack, MusicTagCandidate, MusicTags, TagSource, VideoMetadata } from '../types';

export class ApiClient {
  public static async fetchVideoInfo(url: string): Promise<VideoMetadata> {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to fetch video details');
    }
    return json.data;
  }

  public static async startConversion(url: string, options: ConversionOptions): Promise<ConversionJob> {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        format: options.format,
        bitrate: options.bitrate,
        trimStart: options.trimStart.trim() || undefined,
        trimEnd: options.trimEnd.trim() || undefined,
        volumeBoost: options.volumeBoost,
        normalizeAudio: options.normalizeAudio,
        embedThumbnail: options.embedThumbnail,
        tags: options.tags
      })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to initiate audio conversion');
    }
    return json.job;
  }

  public static async searchTags(query: string, source: TagSource = 'all'): Promise<MusicTagCandidate[]> {
    if (!query || !query.trim()) return [];
    try {
      const res = await fetch(`/api/tags/search?q=${encodeURIComponent(query.trim())}&source=${source}`);
      const json = await res.json();
      if (res.ok && json.success) {
        return json.data || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  public static async applyTags(jobId: string, tags: MusicTags): Promise<ConversionJob> {
    const res = await fetch(`/api/tags/apply/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to apply tags to audio');
    }
    return json.job;
  }

  public static async getJobStatus(jobId: string): Promise<ConversionJob> {
    const res = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to check conversion status');
    }
    return json.job;
  }

  public static async getRecentJobs(): Promise<ConversionJob[]> {
    const res = await fetch('/api/jobs');
    const json = await res.json();
    if (!res.ok || !json.success) {
      return [];
    }
    return json.jobs || [];
  }

  public static async getCookieStatus(): Promise<CookieStatus> {
    const res = await fetch('/api/cookies');
    const json = await res.json();
    if (!res.ok || !json.success) {
      return {
        configured: false,
        sizeBytes: 0,
        lineCount: 0,
        lastModified: null,
        sampleDomains: []
      };
    }
    return json.data;
  }

  public static async saveCookies(cookies: string): Promise<{ success: boolean; message: string; count: number }> {
    const res = await fetch('/api/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies })
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to save cookies');
    }
    return json;
  }

  public static async autoFetchCookies(): Promise<{ success: boolean; message: string; count: number; status: CookieStatus }> {
    const res = await fetch('/api/cookies/auto-fetch', { method: 'POST' });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to auto-fetch guest session');
    }
    return json;
  }

  public static async testSession(): Promise<{ success: boolean; message: string; isAccountSession: boolean; title?: string; duration?: string; errorDetails?: string }> {
    const res = await fetch('/api/cookies/test', { method: 'POST' });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Failed to test session');
    }
    return json.data;
  }

  public static async clearCookies(): Promise<boolean> {
    const res = await fetch('/api/cookies', { method: 'DELETE' });
    const json = await res.json();
    return json.success === true;
  }

  public static async getDemoTracks(): Promise<DemoTrack[]> {
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
}

import {
  AppSettings,
  ConversionJob,
  ConversionOptions,
  CookieStatus,
  DemoTrack,
  LibraryData,
  MusicTagCandidate,
  MusicTags,
  TagSource,
  VideoMetadata,
} from "../types";

let loopbackTokenPromise: Promise<string> | null = null;

async function getLoopbackToken(): Promise<string> {
  if (!loopbackTokenPromise) {
    loopbackTokenPromise = fetch("/api/health")
      .then((res) => res.json())
      .then((json) =>
        typeof json.loopbackToken === "string" ? json.loopbackToken : "",
      )
      .catch(() => "");
  }
  return loopbackTokenPromise;
}

async function mutatingHeaders(): Promise<Record<string, string>> {
  const token = await getLoopbackToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { "x-loopback-token": token } : {}),
  };
}

export class ApiClient {
  public static async fetchVideoInfo(url: string): Promise<VideoMetadata> {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to fetch video details");
    }
    return json.data;
  }

  public static async startConversion(
    url: string,
    options: ConversionOptions,
  ): Promise<ConversionJob> {
    const res = await fetch("/api/convert", {
      method: "POST",
      headers: await mutatingHeaders(),
      body: JSON.stringify({
        url,
        format: options.format,
        bitrate: options.bitrate,
        trimStart: options.trimStart.trim() || undefined,
        trimEnd: options.trimEnd.trim() || undefined,
        volumeBoost: options.volumeBoost,
        normalizeMode: options.normalizeMode,
        // Legacy compat for older servers.
        normalizeAudio: options.normalizeMode === "loudness",
        embedThumbnail: options.embedThumbnail,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to initiate audio conversion");
    }
    return json.job;
  }

  public static async searchTags(
    query: string,
    source: TagSource = "all",
  ): Promise<MusicTagCandidate[]> {
    if (!query || !query.trim()) return [];
    try {
      const res = await fetch(
        `/api/tags/search?q=${encodeURIComponent(query.trim())}&source=${source}`,
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

  public static async applyTags(
    jobId: string,
    tags: MusicTags,
  ): Promise<ConversionJob> {
    const res = await fetch(`/api/tags/apply/${encodeURIComponent(jobId)}`, {
      method: "POST",
      headers: await mutatingHeaders(),
      body: JSON.stringify({ tags }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to apply tags to audio");
    }
    return json.job;
  }

  public static async getJobStatus(jobId: string): Promise<ConversionJob> {
    const res = await fetch(`/api/status/${encodeURIComponent(jobId)}`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to check conversion status");
    }
    return json.job;
  }

  public static async getRecentJobs(): Promise<ConversionJob[]> {
    const res = await fetch("/api/jobs");
    const json = await res.json();
    if (!res.ok || !json.success) {
      return [];
    }
    return json.jobs || [];
  }

  public static async getCookieStatus(): Promise<CookieStatus> {
    const res = await fetch("/api/cookies");
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
  }

  public static async saveCookies(
    cookies: string,
  ): Promise<{ success: boolean; message: string; count: number }> {
    const res = await fetch("/api/cookies", {
      method: "POST",
      headers: await mutatingHeaders(),
      body: JSON.stringify({ cookies }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to save cookies");
    }
    return json;
  }

  public static async autoFetchCookies(): Promise<{
    success: boolean;
    message: string;
    count: number;
    status: CookieStatus;
  }> {
    const res = await fetch("/api/cookies/auto-fetch", {
      method: "POST",
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to auto-fetch guest session");
    }
    return json;
  }

  public static async testSession(): Promise<{
    success: boolean;
    message: string;
    isAccountSession: boolean;
    title?: string;
    duration?: string;
    errorDetails?: string;
    strategy?: "pot" | "fallback";
    potReachable?: boolean;
    cookiesUsed?: boolean;
  }> {
    const res = await fetch("/api/cookies/test", {
      method: "POST",
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to test session");
    }
    return json.data;
  }

  public static async clearCookies(): Promise<boolean> {
    const res = await fetch("/api/cookies", {
      method: "DELETE",
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    return json.success === true;
  }

  public static async getDemoTracks(): Promise<DemoTrack[]> {
    try {
      const res = await fetch("/api/demo-tracks");
      const json = await res.json();
      if (res.ok && json.success) {
        return json.data;
      }
      return [];
    } catch {
      return [];
    }
  }

  public static async getSettings(): Promise<AppSettings> {
    const res = await fetch("/api/settings");
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to load settings");
    }
    return json.data;
  }

  public static async updateSettings(
    patch: Partial<AppSettings>,
  ): Promise<AppSettings> {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: await mutatingHeaders(),
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to save settings");
    }
    return json.data;
  }

  public static async resetSettings(): Promise<AppSettings> {
    const res = await fetch("/api/settings/reset", {
      method: "POST",
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to reset settings");
    }
    return json.data;
  }

  public static async getLibrary(): Promise<LibraryData> {
    const res = await fetch("/api/library");
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to load library");
    }
    return json.data;
  }

  public static async importLibraryFile(file: File): Promise<void> {
    const res = await fetch("/api/library/import", {
      method: "POST",
      headers: {
        ...(await mutatingHeaders()),
        "Content-Type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
      },
      body: await file.arrayBuffer(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Could not copy audio into the library");
    }
  }

  public static async probeLibraryFile(jobId: string): Promise<{
    durationSeconds: number | null;
    format: string;
    sizeBytes: number;
  }> {
    const res = await fetch(`/api/library/${encodeURIComponent(jobId)}/probe`);
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Could not read audio duration");
    }
    return json.data;
  }

  public static async trimLibraryFile(
    jobId: string,
    start: string,
    end: string,
  ): Promise<void> {
    const res = await fetch(`/api/library/${encodeURIComponent(jobId)}/trim`, {
      method: "POST",
      headers: await mutatingHeaders(),
      body: JSON.stringify({ start, end }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Could not trim the audio file");
    }
  }

  public static async editLibraryFile(
    jobId: string,
    patch: {
      format?: string;
      bitrate?: string;
      normalizeMode?: string;
      normalizeAudio?: boolean;
      volumeBoost?: number;
      title?: string;
      artist?: string;
    },
  ): Promise<{ coverDropped?: boolean } | void> {
    const res = await fetch(`/api/library/${encodeURIComponent(jobId)}/edit`, {
      method: "POST",
      headers: await mutatingHeaders(),
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Could not update the audio file");
    }
    return json.data ?? undefined;
  }

  public static async deleteLibraryFile(jobId: string): Promise<void> {
    const res = await fetch(`/api/library/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: await mutatingHeaders(),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to delete file");
    }
  }

  public static async revealFile(jobId: string): Promise<void> {
    const res = await fetch("/api/files/reveal", {
      method: "POST",
      headers: await mutatingHeaders(),
      body: JSON.stringify({ jobId }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Could not reveal the file");
    }
  }
}

/**
 * Preview-stream routing for in-app playback.
 *
 * Opus and M4A files are stored natively on disk, but browsers cannot
 * decode those containers reliably. The player streams a cached 320k MP3
 * preview for those two formats only; every other format streams natively.
 * Downloads always serve the original file.
 */

const PREVIEW_FORMATS = new Set(["opus", "m4a"]);

export function needsPreviewPlayback(format?: string | null): boolean {
  if (!format) return false;
  return PREVIEW_FORMATS.has(format.replace(/^\./, "").toLowerCase());
}

export function previewStreamUrl(
  jobId: string,
  format?: string | null,
): string {
  const base = `/api/stream/${encodeURIComponent(jobId)}`;
  return needsPreviewPlayback(format) ? `${base}?preview=mp3` : base;
}

/** Upgrade a stored/plain stream URL to the preview variant when needed. */
export function withPreviewForFormat(
  streamUrl: string | undefined,
  jobId: string,
  format?: string | null,
): string {
  if (streamUrl && streamUrl.includes("preview=mp3")) return streamUrl;
  if (!needsPreviewPlayback(format)) {
    return streamUrl || `/api/stream/${encodeURIComponent(jobId)}`;
  }
  return previewStreamUrl(jobId, format);
}

/**
 * Single-purpose service for parsing, extracting, and validating YouTube URLs and IDs.
 */

export interface ParsedYouTubeInfo {
  isValid: boolean;
  videoId: string | null;
  canonicalUrl: string | null;
  timestampSeconds?: number;
}

export function extractYouTubeId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // If already a clean 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Common YouTube URL regex patterns
  const patterns = [
    // Standard watch URL: youtube.com/watch?v=ID or music.youtube.com/watch?v=ID
    /(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:[^&]+&)*v=([a-zA-Z0-9_-]{11})/,
    // Short URL: youtu.be/ID
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    // Embed URL: youtube.com/embed/ID
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    // Shorts URL: youtube.com/shorts/ID
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    // Live URL: youtube.com/live/ID
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

export function parseTimestamp(input: string): number | undefined {
  if (!input) return undefined;
  // Match t=120 or t=2m0s
  const tMatch = input.match(/[?&]t=([0-9mhseconds]+)/i);
  if (!tMatch) return undefined;

  const raw = tMatch[1];
  if (/^\d+$/.test(raw)) {
    return parseInt(raw, 10);
  }

  let totalSeconds = 0;
  const hours = raw.match(/(\d+)h/i);
  const minutes = raw.match(/(\d+)m/i);
  const seconds = raw.match(/(\d+)s/i);

  if (hours) totalSeconds += parseInt(hours[1], 10) * 3600;
  if (minutes) totalSeconds += parseInt(minutes[1], 10) * 60;
  if (seconds) totalSeconds += parseInt(seconds[1], 10);

  return totalSeconds > 0 ? totalSeconds : undefined;
}

export function parseYouTubeInput(input: string): ParsedYouTubeInfo {
  const videoId = extractYouTubeId(input);
  if (!videoId) {
    return {
      isValid: false,
      videoId: null,
      canonicalUrl: null
    };
  }

  const timestampSeconds = parseTimestamp(input);

  return {
    isValid: true,
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    timestampSeconds
  };
}

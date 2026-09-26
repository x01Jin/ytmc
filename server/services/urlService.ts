export interface ParsedYouTubeInfo {
  isValid: boolean;
  videoId: string | null;
  canonicalUrl: string | null;
  timestampSeconds?: number;
}

export function extractYouTubeId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  const patterns = [
    /(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:[^&]+&)*v=([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
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
  const tMatch = input.match(/[?&]t=([0-9hms]+)/i);
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
      canonicalUrl: null,
    };
  }

  const timestampSeconds = parseTimestamp(input);

  return {
    isValid: true,
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    timestampSeconds,
  };
}

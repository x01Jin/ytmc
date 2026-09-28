export const AUDIO_DSP = {
  VOLUME: {
    ALLOWED: [100, 125, 150] as const,
  },
} as const;

export interface NormalizeInput {
  volumeBoost?: number;
}

export function codecForTarget(
  format: string,
  bitrate?: string
): { codec: string; bitrate: string } {
  switch (format) {
    case 'mp3':
      return {
        codec: 'libmp3lame',
        bitrate: bitrate && bitrate !== 'native' ? bitrate : '160k',
      };
    case 'm4a':
      return { codec: 'aac', bitrate: '128k' };
    case 'opus':
      return { codec: 'libopus', bitrate: '160k' };
    case 'flac':
      return { codec: 'flac', bitrate: '0' };
    case 'wav':
      return { codec: 'pcm_s16le', bitrate: '' };
    default:
      throw new Error(`Unsupported target format: ${format}`);
  }
}

function volumeFactor(volumeBoost?: number): string | null {
  if (!volumeBoost || volumeBoost === 100) return null;
  return (volumeBoost / 100).toFixed(2);
}

export function buildAudioFilters(input: NormalizeInput): string[] {
  const vol = volumeFactor(input.volumeBoost);
  if (vol) return [`volume=${vol}`];
  return [];
}

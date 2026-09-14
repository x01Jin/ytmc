const MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  wav: 'audio/wav',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  aac: 'audio/aac'
};

export function getAudioMimeType(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase();
  return MIME_MAP[clean] || 'audio/mpeg';
}

export type AudioFormat = 'best' | 'opus' | 'm4a' | 'mp3' | 'flac' | 'wav';
export type AudioBitrate = 'native' | '160k' | '128k' | '192k' | '256k' | '320k';

export type TagSource = 'all' | 'itunes' | 'deezer' | 'musicbrainz';

export interface NativeAudioStreamInfo {
  formatId: string;
  codec: string;
  bitrateKbps: number;
  container: string;
  sampleRateHz?: number;
  channels?: number;
  note: string;
}

export interface MusicTags {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  trackNumber?: string;
  coverUrl?: string;
  comment?: string;
  cleanDescription?: boolean;
}

export interface MusicTagCandidate {
  id: string;
  source: 'itunes' | 'deezer' | 'musicbrainz';
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  trackNumber?: string;
  coverUrl?: string;
  previewUrl?: string;
}

export interface VideoMetadata {
  id: string;
  title: string;
  author: string;
  authorUrl?: string;
  thumbnail: string;
  duration?: string;
  durationSeconds?: number;
  viewCount?: number;
  uploadDate?: string;
  isAvailable: boolean;
  botVerificationRequired: boolean;
  hasCookiesConfigured: boolean;
  description?: string;
  defaultTags?: MusicTags;
  nativeStreams?: NativeAudioStreamInfo[];
  bestNativeStream?: NativeAudioStreamInfo;
}

export interface ConversionOptions {
  format: AudioFormat;
  bitrate: AudioBitrate;
  trimStart: string;
  trimEnd: string;
  volumeBoost: number;
  normalizeAudio: boolean;
  embedThumbnail: boolean;
  tags?: MusicTags;
}

export type JobStatus = 'queued' | 'downloading' | 'converting' | 'completed' | 'error';

export interface ConversionJob {
  id: string;
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  format: string;
  bitrate: string;
  status: JobStatus;
  progress: number;
  stageMessage: string;
  error?: string;
  isBotBlocked?: boolean;
  outputFileName?: string;
  fileSizeBytes?: number;
  downloadUrl?: string;
  streamUrl?: string;
  createdAt: number;
  completedAt?: number;
  tags?: MusicTags;
}

export interface CookieStatus {
  configured: boolean;
  isAccountSession?: boolean;
  isGuestSession?: boolean;
  sizeBytes: number;
  lineCount: number;
  lastModified: string | null;
  sampleDomains: string[];
}

export interface DemoTrack {
  id: string;
  title: string;
  author: string;
  duration: string;
  thumbnail: string;
  genre: string;
  tag: string;
}

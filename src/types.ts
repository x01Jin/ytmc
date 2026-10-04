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
  coverData?: string;
  removeCover?: boolean;
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
  nativeStreams?: NativeAudioStreamInfo[];
  bestNativeStream?: NativeAudioStreamInfo;
  probeError?: string;
}

export interface ConversionOptions {
  format: AudioFormat;
  bitrate: AudioBitrate;
  trimStart: string;
  trimEnd: string;
  volumeBoost: number;
  embedThumbnail: boolean;
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
  errorDetails?: string;
  tagWarning?: string;
  exitCode?: number | null;
  isBotBlocked?: boolean;
  outputFilePath?: string;
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

export interface AppSettings {
  downloadsDir: string;
  filenameTemplate: string;
  revealAfterConvert: boolean;
  defaultDownloadsDir?: string;
  isCustom?: boolean;
}

export interface LibraryRecord {
  jobId: string;
  source?: 'conversion' | 'import';
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  sourceThumbnail?: string;
  format: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  completedAt: number;
  tags?: MusicTags;
  hasCover?: boolean;
}

export interface LooseLibraryFile {
  id: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  mtimeMs: number;
  ext: string;
}

export interface LibraryData {
  downloadsDir: string;
  records: LibraryRecord[];
  looseFiles: LooseLibraryFile[];
  totalSizeBytes: number;
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface HistoryEntry {
  jobId: string;
  videoId: string;
  canonicalUrl: string;
  title: string;
  author: string;
  thumbnail: string;
  createdAt: number;
  completedAt: number;
}

export interface YouTubeSearchResult {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration?: string;
  durationSeconds?: number;
  viewCount?: number;
}

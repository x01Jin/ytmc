import fs from 'fs';
import { parseFile, selectCover } from 'music-metadata';

export const COVER_MAX_BYTES = 8 * 1024 * 1024;
const COVER_FETCH_TIMEOUT_MS = 6000;

export interface MusicTags {
  title: string;
  artist: string;
  album?: string;
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

export interface EmbeddedCover {
  data: Buffer;
  mimeType: string;
}

export interface AudioMetadata {
  tags: MusicTags;
  cover: EmbeddedCover | null;
}

export type CoverResolveStatus = 'absent' | 'ok' | 'invalid-data' | 'fetch-failed' | 'too-large';

export function detectImageMime(buffer: Buffer): string {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg';
  if (
    buffer.length > 4 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  )
    return 'image/png';
  if (
    buffer.length > 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return 'image/webp';
  return 'image/jpeg';
}

export function isFetchableArtworkUrl(value: string | undefined): boolean {
  return !!value && /^https?:\/\//i.test(value);
}

function toCover(buffer: Buffer): EmbeddedCover | null {
  if (buffer.length === 0 || buffer.length > COVER_MAX_BYTES) return null;
  return { data: buffer, mimeType: detectImageMime(buffer) };
}

export async function readAudioMetadata(filePath: string): Promise<AudioMetadata> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Target audio file does not exist: ${filePath}`);
  }
  const empty: AudioMetadata = {
    tags: { title: '', artist: '', cleanDescription: false },
    cover: null,
  };
  let meta: Awaited<ReturnType<typeof parseFile>>;
  try {
    meta = await parseFile(filePath, { duration: false });
  } catch {
    return empty;
  }
  const common = meta.common;
  const commentEntry = common.comment?.[0];
  const picture = selectCover(common.picture) ?? common.picture?.[0];
  let cover: EmbeddedCover | null = null;
  if (picture && picture.data.length > 0 && picture.data.length <= COVER_MAX_BYTES) {
    cover = { data: Buffer.from(picture.data), mimeType: picture.format };
  }
  return {
    tags: {
      title: common.title ?? '',
      artist: common.artist ?? common.albumartist ?? '',
      album: common.album,
      albumArtist: common.albumartist,
      year: common.date ?? (common.year !== undefined ? String(common.year) : ''),
      genre: common.genre?.[0] ?? '',
      trackNumber:
        common.track.no !== undefined && common.track.no !== null ? String(common.track.no) : '',
      comment: typeof commentEntry === 'string' ? commentEntry : (commentEntry?.text ?? ''),
      cleanDescription: false,
    },
    cover,
  };
}

export async function resolveCoverInput(input: {
  coverData?: string;
  coverUrl?: string;
}): Promise<{ cover: EmbeddedCover | null; status: CoverResolveStatus }> {
  if (input.coverData) {
    const match = input.coverData.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (!match) return { cover: null, status: 'invalid-data' };
    const buffer = Buffer.from(match[1], 'base64');
    const cover = toCover(buffer);
    return cover ? { cover, status: 'ok' } : { cover: null, status: 'too-large' };
  }
  if (input.coverUrl && isFetchableArtworkUrl(input.coverUrl)) {
    try {
      const res = await fetch(input.coverUrl, {
        signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      if (!res.ok) return { cover: null, status: 'fetch-failed' };
      const cover = toCover(Buffer.from(await res.arrayBuffer()));
      return cover ? { cover, status: 'ok' } : { cover: null, status: 'too-large' };
    } catch {
      return { cover: null, status: 'fetch-failed' };
    }
  }
  return { cover: null, status: 'absent' };
}

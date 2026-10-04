import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { FFMPEG_PATH } from '../config.js';
import {
  COVER_MAX_BYTES,
  detectImageMime,
  isFetchableArtworkUrl,
  readAudioMetadata,
  resolveCoverInput,
  type CoverResolveStatus,
  type MusicTags,
} from './audioMetadata.js';

export class CoverUnsupportedError extends Error {}

export interface WriteResult {
  success: boolean;
  filePath: string;
  fileSizeBytes: number;
  coverDropped?: boolean;
  coverDropReason?: string;
  tags: MusicTags;
}

type TextField =
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'year'
  | 'genre'
  | 'trackNumber'
  | 'comment';

const TEXT_FIELDS: TextField[] = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'year',
  'genre',
  'trackNumber',
  'comment',
];

type CoverPlan = { mode: 'replace'; buffer: Buffer } | { mode: 'keep' } | { mode: 'remove' };

interface ResolvedPatch {
  tags: MusicTags;
  cleared: Set<TextField>;
  cover: CoverPlan;
  coverStatus: CoverResolveStatus;
  existingCover: Buffer | null;
}

async function resolveEffectiveTags(filePath: string, patch: MusicTags): Promise<ResolvedPatch> {
  const current = await readAudioMetadata(filePath).catch(() => ({
    tags: { title: '', artist: '', cleanDescription: false } as MusicTags,
    cover: null,
  }));
  const pick = (field: TextField): string | undefined => {
    if (patch[field] !== undefined) {
      return defined(patch[field]) ? (patch[field] as string) : undefined;
    }
    const existing = current.tags[field];
    return defined(existing) ? (existing as string) : undefined;
  };
  const cleared = new Set<TextField>();
  for (const field of TEXT_FIELDS) {
    if (patch[field] !== undefined && !defined(patch[field])) cleared.add(field);
  }
  const tags: MusicTags = {
    title: pick('title') ?? '',
    artist: pick('artist') ?? '',
    album: pick('album'),
    albumArtist: pick('albumArtist'),
    year: pick('year'),
    genre: pick('genre'),
    trackNumber: pick('trackNumber'),
    comment: patch.comment !== undefined ? patch.comment : current.tags.comment,
    cleanDescription: patch.cleanDescription !== false,
  };
  const removeCover = patch.removeCover === true;
  let cover: CoverPlan = { mode: 'keep' };
  let coverStatus: CoverResolveStatus = 'absent';
  if (removeCover) {
    cover = { mode: 'remove' };
  } else if (patch.coverData || isFetchableArtworkUrl(patch.coverUrl)) {
    const resolved = await resolveCoverInput(patch);
    if (resolved.cover) {
      cover = { mode: 'replace', buffer: Buffer.from(resolved.cover.data) };
      coverStatus = 'ok';
    } else {
      coverStatus = resolved.status;
    }
  }
  return { tags, cleared, cover, coverStatus, existingCover: current.cover?.data ?? null };
}

function defined(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function escapeFFMetadata(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\\n')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/#/g, '\\#');
}

function buildFlacPictureBlock(image: Buffer, mime: string): Buffer {
  const mimeBuf = Buffer.from(mime, 'ascii');
  const headerLen = 4 + 4 + mimeBuf.length + 4 + 4 + 4 + 4 + 4 + 4;
  const out = Buffer.alloc(headerLen + image.length);
  let o = 0;
  out.writeUInt32BE(3, o);
  o += 4;
  out.writeUInt32BE(mimeBuf.length, o);
  o += 4;
  mimeBuf.copy(out, o);
  o += mimeBuf.length;
  out.writeUInt32BE(0, o);
  o += 4;
  out.writeUInt32BE(0, o);
  o += 4;
  out.writeUInt32BE(0, o);
  o += 4;
  out.writeUInt32BE(0, o);
  o += 4;
  out.writeUInt32BE(0, o);
  o += 4;
  out.writeUInt32BE(image.length, o);
  o += 4;
  image.copy(out, o);
  return out;
}

function writeOpusMetadataFile(
  dir: string,
  tempId: string,
  tags: MusicTags,
  coverBuffer: Buffer | null
): string {
  const lines = [';FFMETADATA1'];
  const push = (k: string, v?: string) => {
    if (v !== undefined && v !== null && String(v).length > 0)
      lines.push(`${k}=${escapeFFMetadata(String(v))}`);
  };
  push('TITLE', tags.title);
  push('ARTIST', tags.artist);
  push('ALBUM', tags.album);
  push('ALBUMARTIST', tags.albumArtist);
  push('DATE', tags.year);
  push('GENRE', tags.genre);
  push('TRACKNUMBER', tags.trackNumber);
  push('COMMENT', tags.comment);
  if (tags.cleanDescription !== false) {
    lines.push('DESCRIPTION=');
    lines.push('SYNOPSIS=');
    lines.push('PURL=');
  }
  if (coverBuffer && coverBuffer.length > 0) {
    const block = buildFlacPictureBlock(coverBuffer, detectImageMime(coverBuffer));
    lines.push(`METADATA_BLOCK_PICTURE=${block.toString('base64')}`);
  }
  const metaPath = path.join(dir, `temp_opusmeta_${tempId}.txt`);
  fs.writeFileSync(metaPath, lines.join('\n') + '\n', 'utf8');
  return metaPath;
}

function runFfmpeg(ffmpegArgs: string[]): Promise<void> {
  const cmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg';
  return new Promise<void>((resolve, reject) => {
    execFile(cmd, ffmpegArgs, { timeout: 60000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`FFmpeg tagging failed: ${stderr || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

function textTagArgs(tags: MusicTags, cleared: Set<TextField>): string[] {
  const args: string[] = [];
  const emit = (keys: string[], value: string | undefined, field: TextField) => {
    if (defined(value)) {
      for (const key of keys) args.push('-metadata', `${key}=${value as string}`);
    } else if (cleared.has(field)) {
      for (const key of keys) args.push('-metadata', `${key}=`);
    }
  };
  emit(['title'], tags.title, 'title');
  emit(['artist'], tags.artist, 'artist');
  emit(['album'], tags.album, 'album');
  emit(['album_artist'], tags.albumArtist, 'albumArtist');
  emit(['date', 'year'], tags.year, 'year');
  emit(['genre'], tags.genre, 'genre');
  emit(['track'], tags.trackNumber, 'trackNumber');
  if (tags.comment !== undefined) args.push('-metadata', `comment=${tags.comment}`);
  else if (cleared.has('comment')) args.push('-metadata', 'comment=');
  if (tags.cleanDescription !== false) {
    args.push('-metadata', 'description=');
    args.push('-metadata', 'synopsis=');
    args.push('-metadata', 'purl=');
  }
  return args;
}

function attachedArgs(ext: string, withCover: boolean, removeCover: boolean): string[] {
  if (withCover) return ['-map', '0:a', '-map', '1:0', '-map_metadata', '0', '-c', 'copy'];
  if (removeCover) return ['-map', '0:a:0', '-map_metadata', '0', '-c', 'copy'];
  return ['-map', '0:a:0', '-map', '0:v?', '-map_metadata', '0', '-c', 'copy'];
}

function coverStreamArgs(ext: string): string[] {
  if (ext === 'mp3')
    return [
      '-id3v2_version',
      '3',
      '-metadata:s:v',
      'title=Album cover',
      '-metadata:s:v',
      'comment=Cover (front)',
    ];
  if (ext === 'm4a') return ['-disposition:v:0', 'attached_pic'];
  if (ext === 'flac')
    return ['-disposition:v:0', 'attached_pic', '-metadata:s:v', 'title=Album cover'];
  return [];
}

async function writeAttached(
  filePath: string,
  ext: string,
  tags: MusicTags,
  cleared: Set<TextField>,
  cover: CoverPlan,
  coverStatus: CoverResolveStatus,
  ctx: { tempCoverFile: string | null; tempOutputFile: string }
): Promise<{ dropped: boolean; reason?: string }> {
  const replacing = cover.mode === 'replace';
  const removing = cover.mode === 'remove';
  if (replacing) {
    fs.writeFileSync(ctx.tempCoverFile as string, cover.buffer);
  }
  const args: string[] = ['-y', '-i', filePath];
  if (replacing) args.push('-i', ctx.tempCoverFile as string);
  args.push(...attachedArgs(ext, replacing, removing));
  if (replacing) args.push(...coverStreamArgs(ext));
  args.push(...textTagArgs(tags, cleared));
  args.push(ctx.tempOutputFile);
  try {
    await runFfmpeg(args);
    return cover.mode === 'keep' && coverStatus !== 'absent'
      ? { dropped: true, reason: coverStatus }
      : { dropped: false };
  } catch {
    if (replacing) {
      const fallback: string[] = ['-y', '-i', filePath];
      fallback.push(...attachedArgs(ext, false, false));
      fallback.push(...textTagArgs(tags, cleared));
      fallback.push(ctx.tempOutputFile);
      await runFfmpeg(fallback);
      return { dropped: true, reason: 'embed-failed' };
    }
    throw new Error('FFmpeg tagging failed');
  }
}

async function writeOpus(
  filePath: string,
  tags: MusicTags,
  cover: CoverPlan,
  coverStatus: CoverResolveStatus,
  existingCover: Buffer | null,
  ctx: { tempOutputFile: string; dir: string; tempId: string }
): Promise<{ dropped: boolean; reason?: string }> {
  const coverBuffer =
    cover.mode === 'replace' ? cover.buffer : cover.mode === 'remove' ? null : existingCover;
  let dropped = false;
  let reason: string | undefined;
  if (cover.mode === 'keep' && coverStatus !== 'absent') {
    dropped = true;
    reason = coverStatus;
  }
  const attempt = async (withCover: boolean): Promise<void> => {
    if (fs.existsSync(ctx.tempOutputFile)) fs.rmSync(ctx.tempOutputFile, { force: true });
    const metaPath = writeOpusMetadataFile(
      ctx.dir,
      ctx.tempId,
      tags,
      withCover ? coverBuffer : null
    );
    try {
      await runFfmpeg([
        '-y',
        '-i',
        filePath,
        '-f',
        'ffmetadata',
        '-i',
        metaPath,
        '-map',
        '0:a',
        '-map',
        '1:v?',
        '-map_metadata',
        '1',
        '-map_metadata:s:a',
        '1',
        '-c',
        'copy',
        ctx.tempOutputFile,
      ]);
    } finally {
      fs.rmSync(metaPath, { force: true });
    }
  };
  try {
    await attempt(coverBuffer !== null);
  } catch {
    if (coverBuffer !== null) {
      await attempt(false);
      dropped = true;
      reason = 'embed-failed';
    } else {
      throw new Error('FFmpeg opus tagging failed');
    }
  }
  return { dropped, reason };
}

export async function writeAudioTags(filePath: string, patch: MusicTags): Promise<WriteResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Target audio file does not exist: ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const dir = path.dirname(filePath);
  const tempId = crypto.randomUUID();
  const tempOutputFile = path.join(dir, `temp_tagged_${tempId}.${ext}`);
  const tempCoverFile = path.join(dir, `temp_cover_${tempId}.jpg`);
  const { tags, cleared, cover, coverStatus, existingCover } = await resolveEffectiveTags(
    filePath,
    patch
  );
  const commit = (): WriteResult => {
    if (fs.existsSync(tempOutputFile)) {
      fs.copyFileSync(tempOutputFile, filePath);
      fs.unlinkSync(tempOutputFile);
    }
    return { success: true, filePath, fileSizeBytes: fs.statSync(filePath).size, tags };
  };
  try {
    if (ext === 'opus' || ext === 'ogg' || ext === 'oga') {
      const out = await writeOpus(filePath, tags, cover, coverStatus, existingCover, {
        tempOutputFile,
        dir,
        tempId,
      });
      const tagged = commit();
      return out.dropped ? { ...tagged, coverDropped: true, coverDropReason: out.reason } : tagged;
    }
    if (ext === 'wav' || ext === 'wave') {
      if (cover.mode === 'replace') {
        throw new CoverUnsupportedError(
          'WAV cannot carry embedded cover art. Tags were not written.'
        );
      }
      const args: string[] = ['-y', '-i', filePath];
      args.push(
        ...(cover.mode === 'remove'
          ? ['-map', '0:a:0', '-map_metadata', '0', '-c', 'copy']
          : ['-map', '0:a:0', '-map', '0:v?', '-map_metadata', '0', '-c', 'copy'])
      );
      args.push(...textTagArgs(tags, cleared));
      args.push(tempOutputFile);
      await runFfmpeg(args);
      const tagged = commit();
      return cover.mode === 'keep' && coverStatus !== 'absent'
        ? { ...tagged, coverDropped: true, coverDropReason: coverStatus }
        : tagged;
    }
    if (ext === 'mp3' || ext === 'm4a' || ext === 'flac') {
      const out = await writeAttached(filePath, ext, tags, cleared, cover, coverStatus, {
        tempCoverFile,
        tempOutputFile,
      });
      const tagged = commit();
      return out.dropped ? { ...tagged, coverDropped: true, coverDropReason: out.reason } : tagged;
    }
    throw new Error(`Unsupported target format: ${ext}`);
  } finally {
    for (const tmp of [tempCoverFile, tempOutputFile]) {
      if (fs.existsSync(tmp)) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    }
  }
}

export async function embedOpusPicture(
  opusFilePath: string,
  cover: Buffer | null
): Promise<boolean> {
  if (!cover || cover.length === 0 || cover.length > COVER_MAX_BYTES) return false;
  if (!fs.existsSync(opusFilePath)) return false;
  const dir = path.dirname(opusFilePath);
  const tempId = crypto.randomUUID();
  const ext = path.extname(opusFilePath).toLowerCase().replace('.', '') || 'opus';
  const tmpOut = path.join(dir, `temp_opuspic_${tempId}.${ext}`);
  const current = (await readAudioMetadata(opusFilePath).catch(() => null))?.tags ?? {
    title: '',
    artist: '',
  };
  const metaPath = writeOpusMetadataFile(
    dir,
    tempId,
    { ...current, cleanDescription: false },
    cover
  );
  try {
    await runFfmpeg([
      '-y',
      '-i',
      opusFilePath,
      '-f',
      'ffmetadata',
      '-i',
      metaPath,
      '-map',
      '0:a',
      '-map',
      '1:v?',
      '-map_metadata',
      '1',
      '-map_metadata:s:a',
      '1',
      '-c',
      'copy',
      tmpOut,
    ]);
    fs.copyFileSync(tmpOut, opusFilePath);
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(metaPath, { force: true });
    fs.rmSync(tmpOut, { force: true });
  }
}

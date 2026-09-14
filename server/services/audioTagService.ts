import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { FFMPEG_PATH } from '../config.js';

export interface MusicTags {
  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  year?: string;
  genre?: string;
  trackNumber?: string;
  coverUrl?: string;
  comment?: string;
  cleanDescription?: boolean;
}

export class AudioTagService {
  /**
   * Embeds or updates metadata tags and cover artwork in an audio file on disk.
   */
  public static async applyTagsToFile(
    filePath: string,
    tags: MusicTags
  ): Promise<{ success: boolean; filePath: string; fileSizeBytes: number; error?: string }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Target audio file does not exist: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const dir = path.dirname(filePath);
    const tempId = crypto.randomUUID();
    const tempOutputFile = path.join(dir, `temp_tagged_${tempId}.${ext}`);
    let tempCoverFile: string | null = null;

    try {
      // 1. Download custom cover art if specified and format supports image attachments
      if (tags.coverUrl && (ext === 'mp3' || ext === 'm4a' || ext === 'flac')) {
        try {
          const imgRes = await fetch(tags.coverUrl, {
            signal: AbortSignal.timeout(6000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });

          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            if (buffer.length > 500) {
              tempCoverFile = path.join(dir, `temp_cover_${tempId}.jpg`);
              fs.writeFileSync(tempCoverFile, buffer);
            }
          }
        } catch {
          // Artwork fetch failed; continue with audio tagging without custom cover
          tempCoverFile = null;
        }
      }

      // 2. Build FFmpeg arguments for direct metadata injection without re-encoding
      const args: string[] = ['-y', '-i', filePath];

      if (tempCoverFile && fs.existsSync(tempCoverFile)) {
        args.push('-i', tempCoverFile);
        args.push('-map', '0:a', '-map', '1:0', '-c', 'copy');

        if (ext === 'mp3') {
          args.push('-id3v2_version', '3');
          args.push('-metadata:s:v', 'title=Album cover');
          args.push('-metadata:s:v', 'comment=Cover (front)');
        } else if (ext === 'm4a') {
          args.push('-disposition:v:0', 'attached_pic');
        } else if (ext === 'flac') {
          args.push('-metadata:s:v', 'title=Album cover');
        }
      } else {
        args.push('-c', 'copy');
      }

      // Standard tag key-value pairs
      if (tags.title) {
        args.push('-metadata', `title=${tags.title}`);
      }
      if (tags.artist) {
        args.push('-metadata', `artist=${tags.artist}`);
      }
      if (tags.album) {
        args.push('-metadata', `album=${tags.album}`);
      }
      if (tags.albumArtist || tags.artist) {
        args.push('-metadata', `album_artist=${tags.albumArtist || tags.artist}`);
      }
      if (tags.year) {
        args.push('-metadata', `date=${tags.year}`);
        args.push('-metadata', `year=${tags.year}`);
      }
      if (tags.genre) {
        args.push('-metadata', `genre=${tags.genre}`);
      }
      if (tags.trackNumber) {
        args.push('-metadata', `track=${tags.trackNumber}`);
      }
      if (tags.comment !== undefined) {
        args.push('-metadata', `comment=${tags.comment}`);
      }

      // Clean out lengthy YouTube descriptions and dump metadata if requested (default behavior)
      if (tags.cleanDescription !== false) {
        args.push('-metadata', 'description=');
        args.push('-metadata', 'synopsis=');
        args.push('-metadata', 'purl=');
      }

      args.push(tempOutputFile);

      // 3. Execute FFmpeg (bundled binary first, PATH fallback)
      const ffmpegCmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg';
      await new Promise<void>((resolve, reject) => {
        execFile(ffmpegCmd, args, { timeout: 60000 }, (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`FFmpeg tagging failed: ${stderr || err.message}`));
          } else {
            resolve();
          }
        });
      });

      // 4. Overwrite original file with newly tagged audio
      if (fs.existsSync(tempOutputFile)) {
        fs.copyFileSync(tempOutputFile, filePath);
        fs.unlinkSync(tempOutputFile);
      }

      const stat = fs.statSync(filePath);
      return {
        success: true,
        filePath,
        fileSizeBytes: stat.size
      };
    } finally {
      // Clean up temp cover art and output files if left behind
      if (tempCoverFile && fs.existsSync(tempCoverFile)) {
        try { fs.unlinkSync(tempCoverFile); } catch {}
      }
      if (fs.existsSync(tempOutputFile)) {
        try { fs.unlinkSync(tempOutputFile); } catch {}
      }
    }
  }
}

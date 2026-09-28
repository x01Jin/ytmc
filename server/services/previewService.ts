import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, FFMPEG_PATH } from '../config.js';

export const PREVIEW_ELIGIBLE_FORMATS = new Set(['opus', 'm4a']);

const PREVIEW_SUFFIX = '.preview.mp3';
const PREVIEW_TIMEOUT_MS = 120000;
const FFMPEG_ERROR_TAIL = 800;

function ffmpegCmd(): string {
  return fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg';
}

function previewsDir(): string {
  const dir = path.join(DATA_DIR, 'previews');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheKey(jobId: string): string {
  return crypto.createHash('sha1').update(jobId, 'utf8').digest('hex');
}

function previewPath(jobId: string): string {
  return path.join(previewsDir(), `${cacheKey(jobId)}${PREVIEW_SUFFIX}`);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegCmd(), args, { timeout: PREVIEW_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (err) {
        const raw = String(stderr || err.message);
        const tail = raw.length > FFMPEG_ERROR_TAIL ? `…${raw.slice(-FFMPEG_ERROR_TAIL)}` : raw;
        reject(new Error(`Preview transcode failed: ${tail}`));
      } else {
        resolve();
      }
    });
  });
}

const pending = new Map<string, Promise<string>>();

export namespace PreviewService {
  export function isEligible(ext: string): boolean {
    return PREVIEW_ELIGIBLE_FORMATS.has(ext.replace(/^\./, '').toLowerCase());
  }

  export async function getOrCreate(jobId: string, sourcePath: string): Promise<string> {
    const ext = path.extname(sourcePath).replace('.', '').toLowerCase();
    if (!isEligible(ext)) {
      throw new Error(`Preview not supported for .${ext} files.`);
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Audio file not found on disk.');
    }
    const out = previewPath(jobId);
    try {
      const [srcStat, outStat] = [
        fs.statSync(sourcePath),
        fs.existsSync(out) ? fs.statSync(out) : null,
      ];
      if (outStat && outStat.size > 0 && outStat.mtimeMs >= srcStat.mtimeMs) {
        return out;
      }
    } catch {}
    const inFlight = pending.get(jobId);
    if (inFlight) return inFlight;
    const task = (async (): Promise<string> => {
      const tmp = `${out}.${process.pid}.tmp.mp3`;
      try {
        await runFfmpeg([
          '-y',
          '-i',
          sourcePath,
          '-map',
          '0:a',
          '-c:a',
          'libmp3lame',
          '-q:a',
          '0',
          tmp,
        ]);
        fs.renameSync(tmp, out);
        return out;
      } catch (err) {
        try {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch {}
        throw err;
      } finally {
        pending.delete(jobId);
      }
    })();
    pending.set(jobId, task);
    return task;
  }

  export function invalidate(jobId: string): void {
    pending.delete(jobId);
    try {
      const out = previewPath(jobId);
      if (fs.existsSync(out)) fs.unlinkSync(out);
    } catch {}
  }
}

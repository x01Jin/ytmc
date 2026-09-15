import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR, FFMPEG_PATH } from "../config.js";

/**
 * Cached MP3 previews for in-app playback.
 *
 * Opus and M4A ship on disk as untouched native streams. Browsers and the
 * Electron shell cannot decode those reliably, so the player streams a
 * cached MP3 instead. Everything else plays from the stored file directly.
 * Previews are listening copies only. Downloads, tags, and trims always use
 * the original.
 */
export const PREVIEW_ELIGIBLE_FORMATS = new Set(["opus", "m4a"]);

function ffmpegCmd(): string {
  return fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
}

function previewsDir(): string {
  const dir = path.join(DATA_DIR, "previews");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Job ids can contain characters illegal in file names (`:` on Windows), so cache files use a hash. */
function cacheKey(jobId: string): string {
  return crypto.createHash("sha1").update(jobId, "utf8").digest("hex");
}

function previewPath(jobId: string): string {
  return path.join(previewsDir(), `${cacheKey(jobId)}.preview.mp3`);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegCmd(), args, { timeout: 120000 }, (err, _stdout, stderr) => {
      if (err) {
        const raw = String(stderr || err.message);
        const tail = raw.length > 800 ? `…${raw.slice(-800)}` : raw;
        reject(new Error(`Preview transcode failed: ${tail}`));
      } else {
        resolve();
      }
    });
  });
}

/** Single-flight transcodes so concurrent range requests share one FFmpeg run. */
const pending = new Map<string, Promise<string>>();

export class PreviewService {
  public static isEligible(ext: string): boolean {
    return PREVIEW_ELIGIBLE_FORMATS.has(ext.replace(/^\./, "").toLowerCase());
  }

  /**
   * Return the cached MP3 preview, transcoding on first request. The cache
   * validates against source mtime/size, so trims and retags regenerate it.
   */
  public static async getOrCreate(
    jobId: string,
    sourcePath: string,
  ): Promise<string> {
    const ext = path.extname(sourcePath).replace(".", "").toLowerCase();
    if (!this.isEligible(ext)) {
      throw new Error(`Preview not supported for .${ext} files.`);
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error("Audio file not found on disk.");
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
    } catch {
      // Fall through to (re)transcode.
    }
    const inFlight = pending.get(jobId);
    if (inFlight) return inFlight;
    const task = (async (): Promise<string> => {
      const tmp = `${out}.${process.pid}.tmp.mp3`;
      try {
        // Raw audio only. No filters, no loudness, no volume. LAME VBR 0 is
        // the encoder's highest quality mode.
        await runFfmpeg([
          "-y",
          "-i",
          sourcePath,
          "-map",
          "0:a",
          "-c:a",
          "libmp3lame",
          "-q:a",
          "0",
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

  /** Drop the cached preview (trim, retag, format change, delete). */
  public static invalidate(jobId: string): void {
    pending.delete(jobId);
    try {
      const out = previewPath(jobId);
      if (fs.existsSync(out)) fs.unlinkSync(out);
    } catch {}
  }

  /** Remove previews whose job id is no longer in the library/job index. */
  public static sweepOrphans(validIds: Set<string>): number {
    const validKeys = new Set([...validIds].map((id) => cacheKey(id)));
    let removed = 0;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(previewsDir());
    } catch {
      return 0;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".preview.mp3")) continue;
      const key = entry.slice(0, -".preview.mp3".length);
      if (validKeys.has(key)) continue;
      try {
        fs.unlinkSync(path.join(previewsDir(), entry));
        removed += 1;
      } catch {}
    }
    return removed;
  }
}

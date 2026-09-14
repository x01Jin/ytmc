import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { FFPROBE_PATH, FFMPEG_PATH } from "../config.js";

export const EDITABLE_FORMATS = ["mp3", "m4a", "opus", "flac", "wav"] as const;
export type EditableFormat = (typeof EDITABLE_FORMATS)[number];

export interface LibraryEditPatch {
  format?: string;
  bitrate?: string;
  normalizeAudio?: boolean;
  volumeBoost?: number;
  title?: string;
  artist?: string;
}

export interface EditResult {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  format: string;
}

export function parseTimeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const parts = trimmed.split(":").map((p) => p.trim());
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((p) => !/^\d+(\.\d+)?$/.test(p))
  )
    return null;
  const nums = parts.map(Number);
  const secs = nums[nums.length - 1];
  const mins = nums[nums.length - 2];
  const hours = nums.length === 3 ? nums[0] : 0;
  if (mins >= 60 || secs >= 60) return null;
  return hours * 3600 + mins * 60 + secs;
}

function ffmpegCmd(): string {
  return fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
}

function ffprobeCmd(): string {
  return fs.existsSync(FFPROBE_PATH) ? FFPROBE_PATH : "ffprobe";
}

const COVER_CAPABLE_FORMATS = new Set(["mp3", "m4a", "flac", "wav"]);

function runTool(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const raw = String(stderr || err.message);
        const tail = raw.length > 800 ? `…${raw.slice(-800)}` : raw;
        reject(new Error(`${path.basename(cmd)} failed: ${tail}`));
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
}

function audioCodecFor(
  format: string,
  bitrate?: string,
): { codec: string; bitrate: string } {
  switch (format) {
    case "mp3":
      return {
        codec: "libmp3lame",
        bitrate: bitrate && bitrate !== "native" ? bitrate : "160k",
      };
    case "m4a":
      return { codec: "aac", bitrate: "128k" };
    case "opus":
      return { codec: "libopus", bitrate: "160k" };
    case "flac":
      return { codec: "flac", bitrate: "0" };
    case "wav":
      return { codec: "pcm_s16le", bitrate: "" };
    default:
      throw new Error(`Unsupported target format: ${format}`);
  }
}

function audioFilters(patch: {
  normalizeAudio?: boolean;
  volumeBoost?: number;
}): string[] {
  if (patch.normalizeAudio) return ["loudnorm,aresample=48000"];
  if (patch.volumeBoost && patch.volumeBoost !== 100) {
    return [`volume=${(patch.volumeBoost / 100).toFixed(2)}`];
  }
  return [];
}

export class AudioEditService {
  public static async probe(filePath: string): Promise<{
    durationSeconds: number | null;
    format: string;
    sizeBytes: number;
  }> {
    if (!fs.existsSync(filePath))
      throw new Error("Audio file not found on disk.");
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).replace(".", "").toLowerCase();
    try {
      const { stdout } = await runTool(
        ffprobeCmd(),
        ["-v", "quiet", "-print_format", "json", "-show_format", filePath],
        15000,
      );
      const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
      const duration = parsed.format?.duration
        ? Number(parsed.format.duration)
        : NaN;
      return {
        durationSeconds:
          Number.isFinite(duration) && duration >= 0 ? duration : null,
        format: ext,
        sizeBytes: stat.size,
      };
    } catch {
      return { durationSeconds: null, format: ext, sizeBytes: stat.size };
    }
  }

  public static async trim(
    filePath: string,
    startSecs: number,
    endSecs: number | null,
  ): Promise<EditResult> {
    if (!fs.existsSync(filePath))
      throw new Error("Audio file not found on disk.");
    const ext = path.extname(filePath).replace(".", "").toLowerCase();
    let audioArgs: string[];
    try {
      const { codec } = audioCodecFor(ext === "best" ? "opus" : ext);
      audioArgs = ["-c:a", codec];
    } catch {
      audioArgs = ["-c:a", "copy"];
    }
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `temp_trim_${crypto.randomUUID()}.${ext}`);
    try {
      const args = ["-y", "-i", filePath, "-ss", String(startSecs)];
      if (endSecs !== null) args.push("-to", String(endSecs));
      if (COVER_CAPABLE_FORMATS.has(ext)) {
        args.push(
          "-map",
          "0:a",
          "-map",
          "0:v?",
          ...audioArgs,
          "-c:v",
          "copy",
          tmp,
        );
      } else {
        args.push("-map", "0:a", ...audioArgs, tmp);
      }
      await runTool(ffmpegCmd(), args, 120000);
      fs.copyFileSync(tmp, filePath);
      const stat = fs.statSync(filePath);
      return {
        filePath,
        fileName: path.basename(filePath),
        fileSizeBytes: stat.size,
        format: ext,
      };
    } finally {
      if (fs.existsSync(tmp)) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    }
  }

  public static async edit(
    filePath: string,
    patch: LibraryEditPatch,
    target: { filePath: string; format: string },
  ): Promise<EditResult> {
    if (!fs.existsSync(filePath))
      throw new Error("Audio file not found on disk.");
    const currentExt = path.extname(filePath).replace(".", "").toLowerCase();
    const needsAudio =
      target.format !== currentExt || audioFilters(patch).length > 0;
    const dir = path.dirname(target.filePath);
    const tmp = path.join(
      dir,
      `temp_edit_${crypto.randomUUID()}.${target.format}`,
    );

    try {
      const args = ["-y", "-i", filePath, "-map", "0:a"];
      if (COVER_CAPABLE_FORMATS.has(target.format)) {
        args.push("-map", "0:v?", "-c:v", "copy");
      }
      if (needsAudio) {
        const { codec, bitrate } = audioCodecFor(target.format, patch.bitrate);
        args.push("-c:a", codec);
        if (bitrate) args.push("-b:a", bitrate);
        const filters = audioFilters(patch);
        if (filters.length > 0) args.push("-af", filters.join(","));
      } else {
        args.push("-c:a", "copy");
      }
      if (patch.title !== undefined)
        args.push("-metadata", `title=${patch.title}`);
      if (patch.artist !== undefined) {
        args.push("-metadata", `artist=${patch.artist}`);
        args.push("-metadata", `album_artist=${patch.artist}`);
      }
      args.push(tmp);
      await runTool(ffmpegCmd(), args, 180000);

      fs.mkdirSync(dir, { recursive: true });
      if (path.resolve(tmp) !== path.resolve(target.filePath)) {
        fs.copyFileSync(tmp, target.filePath);
        if (path.resolve(filePath) !== path.resolve(target.filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
      } else {
        fs.copyFileSync(tmp, filePath);
      }
      const stat = fs.statSync(target.filePath);
      return {
        filePath: target.filePath,
        fileName: path.basename(target.filePath),
        fileSizeBytes: stat.size,
        format: target.format,
      };
    } finally {
      if (fs.existsSync(tmp)) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    }
  }
}

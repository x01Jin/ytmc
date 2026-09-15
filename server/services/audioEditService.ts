import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { FFPROBE_PATH, FFMPEG_PATH } from "../config.js";
import {
  buildAudioFilters,
  codecForTarget,
  linearGainFilter,
  measureLoudness,
  resolveNormalizeMode,
  type NormalizeMode,
} from "./audioFilterService.js";
import {
  AudioTagService,
  embedOpusPicture,
  extractOpusPicture,
} from "./audioTagService.js";

export const EDITABLE_FORMATS = ["mp3", "m4a", "opus", "flac", "wav"] as const;
export type EditableFormat = (typeof EDITABLE_FORMATS)[number];

export interface LibraryEditPatch {
  format?: string;
  bitrate?: string;
  normalizeAudio?: boolean;
  /** New dual-mode selector. Legacy `normalizeAudio: true` maps to "loudness". */
  normalizeMode?: NormalizeMode | string;
  volumeBoost?: number;
  title?: string;
  artist?: string;
}

export interface EditResult {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  format: string;
  /** True when source had cover art but target could not carry it. */
  coverDropped?: boolean;
  /** Uniform loudness gain applied (two-pass linear), if any. */
  loudness?: { gainDb: number; outputI: number };
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

const COVER_CAPABLE_FORMATS = new Set(["mp3", "m4a", "flac", "wav", "opus"]);

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
  // Single shared map (server/services/audioFilterService.ts).
  return codecForTarget(format, bitrate);
}

async function sourceHasCover(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await runTool(
      ffprobeCmd(),
      ["-v", "quiet", "-print_format", "json", "-show_streams", filePath],
      15000,
    );
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; tags?: Record<string, string> }>;
    };
    if ((parsed.streams ?? []).some((s) => s.codec_type === "video"))
      return true;
    // Opus/Ogg artwork lives as METADATA_BLOCK_PICTURE, not a video stream.
    const audioTags =
      parsed.streams?.find((s) => s.codec_type === "audio")?.tags ?? {};
    return Object.keys(audioTags).some(
      (k) => k.toUpperCase() === "METADATA_BLOCK_PICTURE",
    );
  } catch {
    return false;
  }
}

/** Raw cover bytes from any supported source (video stream or opus block). */
async function sourceCoverBytes(
  filePath: string,
  ext: string,
): Promise<Buffer | null> {
  if (ext === "opus" || ext === "ogg" || ext === "oga") {
    return extractOpusPicture(filePath);
  }
  const art = await AudioTagService.extractCoverArt(filePath).catch(() => null);
  return art ? Buffer.from(art.data) : null;
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
    // Opus cannot carry a video stream (muxer rejects it) — capture artwork
    // first and re-embed via METADATA_BLOCK_PICTURE after the trim.
    const isOpusTrim = ext === "opus";
    const trimCover = isOpusTrim
      ? await sourceCoverBytes(filePath, ext).catch(() => null)
      : null;
    try {
      const args = ["-y", "-i", filePath, "-ss", String(startSecs)];
      if (endSecs !== null) args.push("-to", String(endSecs));
      if (COVER_CAPABLE_FORMATS.has(ext) && !isOpusTrim) {
        args.push(
          "-map",
          "0:a",
          "-map",
          "0:v?",
          "-map_metadata",
          "0",
          ...audioArgs,
          "-c:v",
          "copy",
          tmp,
        );
      } else {
        args.push("-map", "0:a", "-map_metadata", "0", ...audioArgs, tmp);
      }
      await runTool(ffmpegCmd(), args, 120000);
      if (isOpusTrim && trimCover) {
        await embedOpusPicture(tmp, trimCover).catch(() => false);
      }
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
    const mode = resolveNormalizeMode(patch);
    let dspFilters: string[];
    let loudness: EditResult["loudness"];
    if (mode === "loudness") {
      const measured = await measureLoudness(filePath);
      if (measured !== null) {
        const linear = linearGainFilter(measured);
        dspFilters = [linear.filter];
        loudness = { gainDb: linear.gainDb, outputI: linear.outputI };
      } else {
        dspFilters = buildAudioFilters(patch);
      }
    } else {
      dspFilters = buildAudioFilters(patch);
    }
    const needsAudio = target.format !== currentExt || dspFilters.length > 0;
    const dir = path.dirname(target.filePath);
    const tmp = path.join(
      dir,
      `temp_edit_${crypto.randomUUID()}.${target.format}`,
    );

    try {
      const existing = await AudioTagService.readTags(filePath).catch(() => ({
        title: "",
        artist: "",
      }));
      const title = patch.title !== undefined ? patch.title : existing.title;
      const artist =
        patch.artist !== undefined ? patch.artist : existing.artist;
      const hadCover = await sourceHasCover(filePath);
      const isOpusTarget = target.format === "opus";

      const buildArgs = (withCover: boolean): string[] => {
        const a = ["-y", "-i", filePath, "-map", "0:a"];
        if (
          withCover &&
          !isOpusTarget &&
          COVER_CAPABLE_FORMATS.has(target.format)
        ) {
          a.push("-map", "0:v?", "-c:v", "copy");
        }
        a.push("-map_metadata", "0");
        if (needsAudio) {
          const { codec, bitrate } = audioCodecFor(
            target.format,
            patch.bitrate,
          );
          a.push("-c:a", codec);
          if (bitrate) a.push("-b:a", bitrate);
          if (dspFilters.length > 0) a.push("-af", dspFilters.join(","));
        } else {
          a.push("-c:a", "copy");
        }
        if (title) a.push("-metadata", `title=${title}`);
        if (artist) {
          a.push("-metadata", `artist=${artist}`);
          a.push("-metadata", `album_artist=${artist}`);
        }
        a.push(tmp);
        return a;
      };

      let coverDropped = false;
      try {
        await runTool(ffmpegCmd(), buildArgs(true), 180000);
      } catch (err) {
        if (hadCover && !isOpusTarget) {
          if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
          await runTool(ffmpegCmd(), buildArgs(false), 180000);
          coverDropped = true;
        } else {
          throw err;
        }
      }

      if (isOpusTarget && hadCover) {
        try {
          const cover = await sourceCoverBytes(filePath, currentExt);
          const ok = await embedOpusPicture(tmp, cover);
          if (!ok) coverDropped = true;
        } catch {
          coverDropped = true;
        }
      }

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
        ...(coverDropped ? { coverDropped: true as const } : {}),
        ...(loudness ? { loudness } : {}),
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

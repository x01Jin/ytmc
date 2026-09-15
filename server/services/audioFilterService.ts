import { execFile } from "child_process";
import fs from "fs";
import { FFMPEG_PATH } from "../config.js";

/** Shared audio DSP helpers — single source of truth for loudness handling.*/

export type NormalizeMode = "off" | "loudness" | "peak";

export const AUDIO_DSP = {
  LOUDNESS: {
    /** Integrated loudness target (LUFS). Spotify/YouTube music norm. */
    I: -14,
    /** Max true peak (dBTP). */
    TP: -1.0,
    /** Loudness range target (single-pass fallback only). */
    LRA: 11,
    RESAMPLE_RATE: 48000,
    /**
     * Peak headroom (dB) reserved below TP when computing the uniform gain,
     * so inter-sample overs never clip after lossy encoding.
     */
    HEADROOM_DB: 1.0,
    /**
     * Maximum upward gain (dB). Physics forbids bringing very dynamic
     * material to target level without compression — instead of squashing
     * dynamics (pumping), the gain is capped and the file lands quieter
     * than target with dynamics 100% intact. Prevents noise-blasting
     * near-silent uploads.
     */
    MAX_BOOST_DB: 12,
  },
  PEAK: {
    /**
     * Limiter ceiling, linear amplitude. 0.891251 ≈ -1 dBTP.
     * alimiter `level` MUST stay disabled — when enabled it auto-levels
     * output back to 0 dB, which re-boosts silence (the reported bug).
     */
    LIMIT: 0.891251,
    /** ms to reach full attenuation. */
    ATTACK: 7,
    /** ms to recover to unity. */
    RELEASE: 100,
    RESAMPLE_RATE: 48000,
  },
  VOLUME: {
    /** Allowed UI gain steps. */
    ALLOWED: [100, 125, 150] as const,
  },
} as const;

export interface NormalizeInput {
  normalizeMode?: NormalizeMode | string;
  /** Legacy boolean flag — true maps to "loudness" when mode is absent. */
  normalizeAudio?: boolean;
  volumeBoost?: number;
}

/**
 * Target codec/bitrate map shared by conversion + edit post-passes.
 * Mirrors the long-standing per-format behavior (mp3 native→160k, m4a 128k,
 * opus 160k, flac lossless, wav PCM).
 */
export function codecForTarget(
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

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  const cmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) {
        const raw = String(stderr || err.message);
        const tail = raw.length > 800 ? `…${raw.slice(-800)}` : raw;
        reject(new Error(`ffmpeg failed: ${tail}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Local two-pass transcode with linear loudness (used by the conversion
 * post-pass). Measures the input, then encodes to `format` with one uniform
 * gain — no pumping. Falls back to the single-pass chain when measurement
 * fails. Cover art rides along for mp3/m4a/flac/wav via stream copy; opus
 * covers are handled by the caller (METADATA_BLOCK_PICTURE post-pass).
 * Returns the applied gain so callers can report honest levels.
 */
export async function transcodeWithLinearLoudness(
  inputPath: string,
  outputPath: string,
  opts: {
    format: string;
    bitrate?: string;
    onPass?: (pass: 1 | 2) => void;
  },
): Promise<{ gainDb: number; outputI: number; measured: boolean }> {
  const { codec, bitrate } = codecForTarget(opts.format, opts.bitrate);
  opts.onPass?.(1);
  const measured = await measureLoudness(inputPath);
  let af: string;
  let gainDb = 0;
  let outputI = NaN;
  if (measured !== null) {
    const linear = linearGainFilter(measured);
    af = linear.filter;
    gainDb = linear.gainDb;
    outputI = linear.outputI;
  } else {
    af = buildAudioFilters({ normalizeMode: "loudness" }).join(",");
  }
  opts.onPass?.(2);
  const coverCapable = new Set(["mp3", "m4a", "flac", "wav"]);
  const args = ["-y", "-i", inputPath, "-map", "0:a"];
  if (coverCapable.has(opts.format)) {
    args.push("-map", "0:v?", "-c:v", "copy");
  }
  args.push("-map_metadata", "0", "-c:a", codec);
  if (bitrate) args.push("-b:a", bitrate);
  args.push("-af", af, outputPath);
  await runFfmpeg(args, 300000);
  return { gainDb, outputI, measured: measured !== null };
}

/** Resolve legacy `normalizeAudio: boolean` + new `normalizeMode` to one mode. */
export function resolveNormalizeMode(input: NormalizeInput): NormalizeMode {
  const raw =
    typeof input.normalizeMode === "string"
      ? input.normalizeMode.toLowerCase()
      : undefined;
  if (raw === "loudness" || raw === "peak" || raw === "off") return raw;
  if (input.normalizeAudio === true) return "loudness";
  return "off";
}

export function isValidNormalizeMode(value: unknown): value is NormalizeMode {
  return value === "off" || value === "loudness" || value === "peak";
}

function volumeFactor(volumeBoost?: number): string | null {
  if (!volumeBoost || volumeBoost === 100) return null;
  return (volumeBoost / 100).toFixed(2);
}

/**
 * Build the `-af` filter chain for conversion + library edit.
 * Returns [] when no DSP is needed (allows streamcopy fast-paths).
 * Peak/loudness chains are returned as a SINGLE comma-joined element so
 * callers can do `args.push("-af", filters.join(","))` unchanged.
 */
export function buildAudioFilters(input: NormalizeInput): string[] {
  const mode = resolveNormalizeMode(input);
  const vol = volumeFactor(input.volumeBoost);

  if (mode === "loudness") {
    const l = AUDIO_DSP.LOUDNESS;
    // Single-pass FALLBACK (used only when measurement fails). Without
    // measured_* ffmpeg runs dynamic scaling, which can pump quiet sections —
    // prefer linearLoudnessFilter() (two-pass) wherever a file path exists.
    // Volume gain is intentionally ignored in loudness mode — loudnorm sets
    // absolute level; pre-gain would just be undone / risk clipping.
    return [
      `loudnorm=I=${l.I}:TP=${l.TP}:LRA=${l.LRA}:linear=true,aresample=${l.RESAMPLE_RATE}`,
    ];
  }

  if (mode === "peak") {
    const p = AUDIO_DSP.PEAK;
    const chain: string[] = [];
    if (vol) chain.push(`volume=${vol}`);
    chain.push(`aresample=${p.RESAMPLE_RATE}`);
    chain.push(
      `alimiter=limit=${p.LIMIT}:attack=${p.ATTACK}:release=${p.RELEASE}:level=disabled:asc=0`,
    );
    return [chain.join(",")];
  }

  // off
  if (vol) return [`volume=${vol}`];
  return [];
}

/** True when any DSP forces a re-encode (vs streamcopy). */
export function needsAudioProcessing(input: NormalizeInput): boolean {
  return buildAudioFilters(input).length > 0;
}

export interface LoudnessMeasurement {
  measuredI: number;
  measuredTP: number;
  measuredLRA: number;
  measuredThresh: number;
  offset: number;
}

/**
 * Pass 1/2 of linear loudness: scan the file and read its EBU R128 stats.
 * Fast (~50x realtime — seconds for a full track). Returns null when the
 * file can't be measured (callers fall back to the single-pass chain).
 */
export function measureLoudness(
  filePath: string,
  timeoutMs = 120000,
): Promise<LoudnessMeasurement | null> {
  const l = AUDIO_DSP.LOUDNESS;
  const cmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : "ffmpeg";
  return new Promise((resolve) => {
    execFile(
      cmd,
      [
        "-hide_banner",
        "-i",
        filePath,
        "-map",
        "0:a",
        "-af",
        `loudnorm=I=${l.I}:TP=${l.TP}:LRA=${l.LRA}:print_format=json`,
        "-f",
        "null",
        "-",
      ],
      { timeout: timeoutMs },
      (_err, _stdout, stderr) => {
        try {
          const raw = String(stderr || "");
          const start = raw.indexOf("{");
          const end = raw.lastIndexOf("}");
          if (start < 0 || end <= start) return resolve(null);
          const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
            string,
            number | string | undefined
          >;
          // ffmpeg ≥7 prints input_i/input_tp/input_lra/input_thresh +
          // target_offset; older builds print measured_I/measured_TP/...
          const num = (v: number | string | undefined): number =>
            typeof v === "number" ? v : Number(v);
          const m: LoudnessMeasurement = {
            measuredI: num(parsed.measured_I ?? parsed.input_i),
            measuredTP: num(parsed.measured_TP ?? parsed.input_tp),
            measuredLRA: num(parsed.measured_LRA ?? parsed.input_lra),
            measuredThresh: num(parsed.measured_thresh ?? parsed.input_thresh),
            offset: num(parsed.offset ?? parsed.target_offset ?? 0),
          };
          if (
            ![m.measuredI, m.measuredTP, m.measuredLRA, m.measuredThresh].every(
              (v) => Number.isFinite(v),
            )
          )
            return resolve(null);
          resolve(m);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/**
 * Pass 2/2: peak-constrained UNIFORM gain from a measurement.
 * gain = min(target − measured, TP − measuredTP − headroom, MAX_BOOST).
 * A single static `volume` multiplier cannot pump, compress, or lift silence
 * relative to the body — LRA is preserved exactly. When the source is more
 * dynamic than target level allows, the file lands quieter than −14 LUFS
 * with dynamics fully intact (the honest trade-off; compression would be
 * the only other way, and that IS the reported bug).
 * A safety alimiter at −1 dBTP follows for freak inter-sample overs only.
 */
export function linearGainFilter(m: LoudnessMeasurement): {
  filter: string;
  gainDb: number;
  outputI: number;
} {
  const l = AUDIO_DSP.LOUDNESS;
  const p = AUDIO_DSP.PEAK;
  const wanted = l.I - m.measuredI;
  const peakLimited = l.TP - m.measuredTP - l.HEADROOM_DB;
  const gainDb = Math.min(wanted, peakLimited, l.MAX_BOOST_DB);
  const linear = Math.pow(10, gainDb / 20);
  return {
    filter: [
      `volume=${linear.toFixed(4)}`,
      `aresample=${l.RESAMPLE_RATE}`,
      `alimiter=limit=${p.LIMIT}:attack=${p.ATTACK}:release=${p.RELEASE}:level=disabled:asc=0`,
    ].join(","),
    gainDb,
    outputI: m.measuredI + gainDb,
  };
}

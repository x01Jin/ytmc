import { execFile } from 'child_process';
import fs from 'fs';
import { FFMPEG_PATH } from '../config.js';

export type NormalizeMode = 'off' | 'loudness' | 'peak';

export const AUDIO_DSP = {
  LOUDNESS: {
    I: -14,
    TP: -1.0,
    LRA: 11,
    RESAMPLE_RATE: 48000,
    HEADROOM_DB: 1.0,
    MAX_BOOST_DB: 12,
  },
  PEAK: {
    LIMIT: 0.891251,
    ATTACK: 7,
    RELEASE: 100,
    RESAMPLE_RATE: 48000,
  },
  VOLUME: {
    ALLOWED: [100, 125, 150] as const,
  },
} as const;

export interface NormalizeInput {
  normalizeMode?: NormalizeMode | string;
  normalizeAudio?: boolean;
  volumeBoost?: number;
}

export function codecForTarget(
  format: string,
  bitrate?: string
): { codec: string; bitrate: string } {
  switch (format) {
    case 'mp3':
      return {
        codec: 'libmp3lame',
        bitrate: bitrate && bitrate !== 'native' ? bitrate : '160k',
      };
    case 'm4a':
      return { codec: 'aac', bitrate: '128k' };
    case 'opus':
      return { codec: 'libopus', bitrate: '160k' };
    case 'flac':
      return { codec: 'flac', bitrate: '0' };
    case 'wav':
      return { codec: 'pcm_s16le', bitrate: '' };
    default:
      throw new Error(`Unsupported target format: ${format}`);
  }
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  const cmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg';
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

export async function transcodeWithLinearLoudness(
  inputPath: string,
  outputPath: string,
  opts: {
    format: string;
    bitrate?: string;
    onPass?: (pass: 1 | 2) => void;
  }
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
    af = buildAudioFilters({ normalizeMode: 'loudness' }).join(',');
  }
  opts.onPass?.(2);
  const coverCapable = new Set(['mp3', 'm4a', 'flac', 'wav']);
  const args = ['-y', '-i', inputPath, '-map', '0:a'];
  if (coverCapable.has(opts.format)) {
    args.push('-map', '0:v?', '-c:v', 'copy');
  }
  args.push('-map_metadata', '0', '-c:a', codec);
  if (bitrate) args.push('-b:a', bitrate);
  args.push('-af', af, outputPath);
  await runFfmpeg(args, 300000);
  return { gainDb, outputI, measured: measured !== null };
}

export function resolveNormalizeMode(input: NormalizeInput): NormalizeMode {
  const raw =
    typeof input.normalizeMode === 'string' ? input.normalizeMode.toLowerCase() : undefined;
  if (raw === 'loudness' || raw === 'peak' || raw === 'off') return raw;
  if (input.normalizeAudio === true) return 'loudness';
  return 'off';
}

export function isValidNormalizeMode(value: unknown): value is NormalizeMode {
  return value === 'off' || value === 'loudness' || value === 'peak';
}

function volumeFactor(volumeBoost?: number): string | null {
  if (!volumeBoost || volumeBoost === 100) return null;
  return (volumeBoost / 100).toFixed(2);
}

export function buildAudioFilters(input: NormalizeInput): string[] {
  const mode = resolveNormalizeMode(input);
  const vol = volumeFactor(input.volumeBoost);

  if (mode === 'loudness') {
    const l = AUDIO_DSP.LOUDNESS;
    return [`loudnorm=I=${l.I}:TP=${l.TP}:LRA=${l.LRA}:linear=true,aresample=${l.RESAMPLE_RATE}`];
  }

  if (mode === 'peak') {
    const p = AUDIO_DSP.PEAK;
    const chain: string[] = [];
    if (vol) chain.push(`volume=${vol}`);
    chain.push(`aresample=${p.RESAMPLE_RATE}`);
    chain.push(
      `alimiter=limit=${p.LIMIT}:attack=${p.ATTACK}:release=${p.RELEASE}:level=disabled:asc=0`
    );
    return [chain.join(',')];
  }

  if (vol) return [`volume=${vol}`];
  return [];
}

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

function num(v: number | string | undefined): number {
  return typeof v === 'number' ? v : Number(v);
}

export function measureLoudness(
  filePath: string,
  timeoutMs = 120000
): Promise<LoudnessMeasurement | null> {
  const l = AUDIO_DSP.LOUDNESS;
  const cmd = fs.existsSync(FFMPEG_PATH) ? FFMPEG_PATH : 'ffmpeg';
  return new Promise(resolve => {
    execFile(
      cmd,
      [
        '-hide_banner',
        '-i',
        filePath,
        '-map',
        '0:a',
        '-af',
        `loudnorm=I=${l.I}:TP=${l.TP}:LRA=${l.LRA}:print_format=json`,
        '-f',
        'null',
        '-',
      ],
      { timeout: timeoutMs },
      (_err, _stdout, stderr) => {
        try {
          const raw = String(stderr || '');
          const start = raw.indexOf('{');
          const end = raw.lastIndexOf('}');
          if (start < 0 || end <= start) return resolve(null);
          const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
            string,
            number | string | undefined
          >;
          const m: LoudnessMeasurement = {
            measuredI: num(parsed.measured_I ?? parsed.input_i),
            measuredTP: num(parsed.measured_TP ?? parsed.input_tp),
            measuredLRA: num(parsed.measured_LRA ?? parsed.input_lra),
            measuredThresh: num(parsed.measured_thresh ?? parsed.input_thresh),
            offset: num(parsed.offset ?? parsed.target_offset ?? 0),
          };
          if (
            ![m.measuredI, m.measuredTP, m.measuredLRA, m.measuredThresh].every(v =>
              Number.isFinite(v)
            )
          )
            return resolve(null);
          resolve(m);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

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
    ].join(','),
    gainDb,
    outputI: m.measuredI + gainDb,
  };
}

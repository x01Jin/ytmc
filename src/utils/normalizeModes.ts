import type { NormalizeMode } from "../types";

/**
 * Frontend mirror of server/services/audioFilterService.ts AUDIO_DSP.
 * Numeric values here are DISPLAY ONLY — the backend owns the actual
 * ffmpeg filter chain. Keep labels in sync when tuning backend constants.
 */
export const NORMALIZE_MODES: {
  id: NormalizeMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "off",
    label: "Off",
    hint: "Original dynamics, no processing",
  },
  {
    id: "loudness",
    label: "Loudness · −14 LUFS",
    hint: "Uniform gain, dynamics + silence preserved (two-pass)",
  },
  {
    id: "peak",
    label: "Peak-safe · −1 dBTP",
    hint: "Never boosts silence",
  },
];

export function normalizeModeLabel(mode: NormalizeMode): string {
  return NORMALIZE_MODES.find((m) => m.id === mode)?.label ?? mode;
}

/** Migrate legacy drafts: normalizeAudio:true → "loudness". */
export function migrateNormalizeMode(options: {
  normalizeMode?: NormalizeMode | string;
  normalizeAudio?: boolean;
}): NormalizeMode {
  const raw =
    typeof options.normalizeMode === "string"
      ? options.normalizeMode.toLowerCase()
      : undefined;
  if (raw === "loudness" || raw === "peak" || raw === "off") return raw;
  if (options.normalizeAudio === true) return "loudness";
  return "off";
}

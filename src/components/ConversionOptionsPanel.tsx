import { Check, Music } from "lucide-react";
import React from "react";
import { AudioFormat, ConversionOptions } from "../types";
import { NORMALIZE_MODES } from "../utils/normalizeModes";

interface ConversionOptionsPanelProps {
  options: ConversionOptions;
  onChange: (options: ConversionOptions) => void;
  onConvert: () => void;
  isConverting: boolean;
}

const FORMAT_DESCRIPTIONS: Record<AudioFormat, string> = {
  best: "Highest native stream with zero transcoding loss",
  opus: "Native YouTube Opus stream (~160 kbps, 48kHz)",
  m4a: "Native Apple AAC stream (~128 kbps, 44.1kHz)",
  mp3: "Universal MP3 for legacy players (transcoded from ~160k source)",
  flac: "Lossless FLAC container (for audiophile players)",
  wav: "Uncompressed PCM waveform audio",
};

const FORMATS = ["best", "opus", "m4a", "mp3", "flac", "wav"] as AudioFormat[];

const CONVERT_LABELS: Record<AudioFormat, string> = {
  best: "Extract Best Native Stream",
  opus: "Extract Native Opus",
  m4a: "Extract Native AAC",
  mp3: "Transcode to MP3",
  flac: "Convert to FLAC",
  wav: "Convert to WAV",
};

export const ConversionOptionsPanel: React.FC<ConversionOptionsPanelProps> = ({
  options,
  onChange,
  onConvert,
  isConverting,
}) => {
  const update = (patch: Partial<ConversionOptions>) =>
    onChange({ ...options, ...patch, bitrate: "native" });

  return (
    <section
      id="conversion-options-panel"
      aria-label="Conversion options"
      className="px-panel w-full space-y-3 p-3"
    >
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        role="radiogroup"
        aria-label="Audio format"
      >
        {FORMATS.map((fmt) => {
          const isSelected = options.format === fmt;
          return (
            <button
              key={fmt}
              id={`format-btn-${fmt}`}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => update({ format: fmt })}
              className={`flex min-w-0 items-center justify-between gap-1 border-2 px-2.5 py-2 text-left transition-colors ${
                isSelected
                  ? "border-px-acc bg-px-panel-2 text-px-acc"
                  : "border-px-line bg-px-bg hover:border-px-dim"
              }`}
            >
              <span
                className="truncate text-sm font-bold uppercase"
                translate="no"
              >
                {fmt === "best" ? "Best" : `.${fmt}`}
              </span>
              {isSelected && (
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-px-dim">
        {FORMAT_DESCRIPTIONS[options.format]}
      </p>

      <div className="space-y-2 border-t border-px-line pt-3">
        <fieldset>
          <legend className="text-xs font-semibold text-px-text">
            Loudness handling{" "}
            <span className="font-normal text-px-dim">
              — peak-safe never boosts silence
            </span>
          </legend>
          <div
            className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3"
            role="radiogroup"
            aria-label="Loudness handling"
          >
            {NORMALIZE_MODES.map((m) => {
              const selected = options.normalizeMode === m.id;
              return (
                <button
                  key={m.id}
                  id={`normalize-${m.id}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={m.hint}
                  onClick={() => update({ normalizeMode: m.id })}
                  className={`border-2 px-2 py-1.5 text-left transition-colors ${
                    selected
                      ? "border-px-acc bg-px-panel-2 text-px-acc"
                      : "border-px-line bg-px-bg hover:border-px-dim"
                  }`}
                >
                  <span className="block text-xs font-bold">{m.label}</span>
                  <span className="block text-[10px] text-px-dim">
                    {m.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex items-center justify-between gap-2 text-xs">
          <label
            className="font-semibold text-px-text"
            htmlFor="volume-boost-select"
          >
            Volume gain{" "}
            <span className="font-normal text-px-dim">
              — boost quiet uploads
            </span>
          </label>
          <select
            id="volume-boost-select"
            value={options.volumeBoost}
            onChange={(e) =>
              update({ volumeBoost: parseInt(e.target.value, 10) })
            }
            disabled={options.normalizeMode === "loudness"}
            className="px-select py-1 text-xs disabled:opacity-50"
          >
            <option value={100}>100%</option>
            <option value={125}>125%</option>
            <option value={150}>150%</option>
          </select>
        </div>
      </div>

      <label
        className="flex cursor-pointer items-center gap-2 border-t border-px-line pt-3 text-xs"
        htmlFor="embed-thumbnail-checkbox"
      >
        <input
          id="embed-thumbnail-checkbox"
          type="checkbox"
          checked={options.embedThumbnail}
          onChange={(e) => update({ embedThumbnail: e.target.checked })}
          className="h-4 w-4 shrink-0 accent-[#7c5cff]"
        />
        <span className="font-semibold text-px-text">
          Embed Album Cover Art & ID3 Tags (Title, Artist)
        </span>
      </label>

      <button
        id="start-conversion-btn"
        type="button"
        onClick={onConvert}
        disabled={isConverting}
        className="px-btn px-btn-primary flex w-full items-center justify-center gap-2 !py-3 text-sm md:text-base"
      >
        <Music className="h-5 w-5" aria-hidden="true" />
        <span aria-live="polite">
          {isConverting ? "Converting…" : CONVERT_LABELS[options.format]}
        </span>
      </button>
    </section>
  );
};

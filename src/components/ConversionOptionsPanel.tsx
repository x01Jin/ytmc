import { Check, ChevronDown, Disc3, Music, Scissors, Settings2, Sliders, Sparkles, Tag, Volume2 } from 'lucide-react';
import React, { useState } from 'react';
import { AudioBitrate, AudioFormat, ConversionOptions, MusicTags } from '../types';
import { TagEditor } from './TagEditor';

interface ConversionOptionsPanelProps {
  options: ConversionOptions;
  onChange: (options: ConversionOptions) => void;
  onConvert: () => void;
  isConverting: boolean;
  defaultVideoTitle?: string;
  defaultArtist?: string;
  defaultThumbnail?: string;
}

const FORMAT_DESCRIPTIONS: Record<AudioFormat, string> = {
  best: 'Extracts YouTube\'s highest native bitrate stream directly (~160k Opus / ~128k AAC) with zero transcoding loss',
  opus: 'Native YouTube Opus stream (Format 251, ~160 kbps, 48kHz) — Bit-for-bit direct streamcopy',
  m4a: 'Native Apple AAC stream (Format 140, ~128 kbps, 44.1kHz) — High fidelity direct streamcopy',
  mp3: 'Universal MP3 format for legacy players. (Note: YouTube audio is capped at ~160k; upsampling to 320k is lossy re-encoding)',
  flac: 'Lossless PCM container wrapper (for FLAC audiophile players)',
  wav: 'Uncompressed PCM waveform audio'
};

const BITRATE_DESCRIPTIONS: Record<AudioBitrate, string> = {
  native: 'Source Match (~160 kbps) — True native fidelity without artificial upsampling or file bloat',
  '160k': 'Native Match (160 kbps Opus/VBR)',
  '192k': 'High Transcode (192 kbps)',
  '128k': 'Compact (128 kbps AAC standard)',
  '256k': '256 kbps (Upsampled Transcode)',
  '320k': '320 kbps (Upsampled Transcode — Placebo upsampling from ~160k source)'
};

export const ConversionOptionsPanel: React.FC<ConversionOptionsPanelProps> = ({
  options,
  onChange,
  onConvert,
  isConverting,
  defaultVideoTitle = '',
  defaultArtist = '',
  defaultThumbnail = ''
}) => {
  const [activeTab, setActiveTab] = useState<'format' | 'tags'>('format');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [enableTrim, setEnableTrim] = useState(Boolean(options.trimStart || options.trimEnd));

  const isLossless = options.format === 'flac' || options.format === 'wav';

  const handleFormatChange = (fmt: AudioFormat) => {
    onChange({ ...options, format: fmt });
  };

  const handleBitrateChange = (rate: AudioBitrate) => {
    onChange({ ...options, bitrate: rate });
  };

  const handleToggleTrim = (checked: boolean) => {
    setEnableTrim(checked);
    if (!checked) {
      onChange({ ...options, trimStart: '', trimEnd: '' });
    }
  };

  const handleTagsChange = (newTags: MusicTags) => {
    onChange({ ...options, tags: newTags });
  };

  return (
    <section id="conversion-options-panel" className="w-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm space-y-5 transition-colors">
      {/* Panel Top Tabs: Format vs Tag Editor */}
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('format')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'format'
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Format & Quality</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tags')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'tags'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Music Tags & Autotagger</span>
            {options.tags?.title && (
              <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
            )}
          </button>
        </div>

        <span className="text-[11px] text-zinc-400 hidden sm:inline">
          FFmpeg High Fidelity Audio Engine
        </span>
      </div>

      {/* TAB 1: Format & Quality */}
      {activeTab === 'format' && (
        <div className="space-y-5">
          {/* Format selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                Target Audio Format
              </label>
              {(options.format === 'best' || options.format === 'opus' || options.format === 'm4a') && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Direct Streamcopy (0% loss)
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {(['best', 'opus', 'm4a', 'mp3', 'flac', 'wav'] as AudioFormat[]).map((fmt) => {
                const isSelected = options.format === fmt;
                const isDirect = fmt === 'best' || fmt === 'opus' || fmt === 'm4a';
                return (
                  <button
                    key={fmt}
                    id={`format-btn-${fmt}`}
                    type="button"
                    onClick={() => handleFormatChange(fmt)}
                    className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between relative ${
                      isSelected
                        ? 'border-rose-600 dark:border-rose-500 bg-rose-50/70 dark:bg-rose-950/30 ring-2 ring-rose-500/20'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-950/60'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={`text-sm font-bold uppercase ${isSelected ? 'text-rose-700 dark:text-rose-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {fmt === 'best' ? 'BEST (NATIVE)' : `.${fmt}`}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />}
                    </div>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-1">
                      {fmt === 'best' ? 'Highest Native' : fmt === 'opus' ? '~160k Opus' : fmt === 'm4a' ? '~128k AAC' : fmt === 'mp3' ? 'Universal' : fmt === 'flac' ? 'Lossless' : 'Uncompressed'}
                    </span>
                    {isDirect && (
                      <span className="mt-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">
                        {fmt === 'best' ? 'Recommended' : 'Direct Copy'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              {FORMAT_DESCRIPTIONS[options.format]}
            </p>
          </div>

          {/* Bitrate Selector for MP3 */}
          {options.format === 'mp3' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  MP3 Bitrate & Transcode Settings
                </label>
                <span className="text-[10px] text-zinc-400">
                  Source stream: ~160k Opus / ~128k AAC
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(['native', '192k', '128k', '256k', '320k'] as AudioBitrate[]).map((rate) => {
                  const isSelected = options.bitrate === rate;
                  return (
                    <button
                      key={rate}
                      id={`bitrate-btn-${rate}`}
                      type="button"
                      onClick={() => handleBitrateChange(rate)}
                      className={`p-2.5 rounded-lg border text-left transition-all flex flex-col ${
                        isSelected
                          ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm'
                          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-950/60 text-zinc-800 dark:text-zinc-200'
                      }`}
                    >
                      <span className="text-sm font-bold">
                        {rate === 'native' ? 'Native (~160k)' : rate.replace('k', ' kbps')}
                      </span>
                      <span className={`text-[10px] mt-0.5 ${isSelected ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>
                        {rate === 'native' ? 'True Match' : rate === '320k' ? 'Upsampled' : rate === '256k' ? 'Upsampled' : rate === '192k' ? 'Standard' : 'Compact'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                {BITRATE_DESCRIPTIONS[options.bitrate]}
              </p>
            </div>
          )}

          {/* Advanced Trimming & Audio Enhancement Toggle */}
          <div className="pt-1">
            <button
              id="toggle-advanced-options-btn"
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 py-1"
            >
              <Settings2 className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
              <span>{showAdvanced ? 'Hide Advanced Options' : 'Show Trimming & Audio Enhancements'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>

            {showAdvanced && (
              <div className="mt-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 space-y-4">
                {/* Trim segment */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        id="enable-trim-checkbox"
                        type="checkbox"
                        checked={enableTrim}
                        onChange={(e) => handleToggleTrim(e.target.checked)}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      />
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1">
                        <Scissors className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
                        Trim Audio Segment (Cut Start / End)
                      </span>
                    </label>
                    <span className="text-[11px] text-zinc-400">Optional</span>
                  </div>

                  {enableTrim && (
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                          Start Time (e.g. 00:15 or 15)
                        </label>
                        <input
                          id="trim-start-input"
                          type="text"
                          value={options.trimStart}
                          onChange={(e) => onChange({ ...options, trimStart: e.target.value })}
                          placeholder="00:00"
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                          End Time (e.g. 02:45 or 165)
                        </label>
                        <input
                          id="trim-end-input"
                          type="text"
                          value={options.trimEnd}
                          onChange={(e) => onChange({ ...options, trimEnd: e.target.value })}
                          placeholder="Leave blank for full end"
                          className="w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Volume Normalization & Boost */}
                <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3">
                  <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
                    Volume Optimization
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 cursor-pointer">
                      <input
                        id="normalize-audio-checkbox"
                        type="checkbox"
                        checked={options.normalizeAudio}
                        onChange={(e) => onChange({ ...options, normalizeAudio: e.target.checked })}
                        className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      />
                      <div className="text-xs">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">Auto Loudness Normalization</span>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Balances uneven track volume (EBU R128)</p>
                      </div>
                    </label>

                    <div className="p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                      <div className="text-xs">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">Volume Gain</span>
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Boost quiet YouTube uploads</p>
                      </div>
                      <select
                        id="volume-boost-select"
                        value={options.volumeBoost}
                        onChange={(e) => onChange({ ...options, volumeBoost: parseInt(e.target.value, 10) })}
                        disabled={options.normalizeAudio}
                        className="text-xs border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
                      >
                        <option value={100}>100% (Original)</option>
                        <option value={125}>125% (+2 dB)</option>
                        <option value={150}>150% (+3.5 dB)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Embed thumbnail & metadata */}
                <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      id="embed-thumbnail-checkbox"
                      type="checkbox"
                      checked={options.embedThumbnail}
                      onChange={(e) => onChange({ ...options, embedThumbnail: e.target.checked })}
                      className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                    />
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      Embed Album Cover Art & ID3 Tags (Title, Artist)
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Metadata & Tag Editor */}
      {activeTab === 'tags' && (
        <div>
          <TagEditor
            initialTags={options.tags}
            defaultVideoTitle={defaultVideoTitle}
            defaultArtist={defaultArtist}
            defaultThumbnail={defaultThumbnail}
            onChange={handleTagsChange}
            mode="pre-convert"
          />
        </div>
      )}

      {/* Convert action button */}
      <div className="pt-2">
        <button
          id="start-conversion-btn"
          type="button"
          onClick={onConvert}
          disabled={isConverting}
          className="w-full py-3.5 px-6 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-all shadow-md shadow-rose-600/20 flex items-center justify-center gap-2 text-sm md:text-base"
        >
          <Music className="w-5 h-5" />
          <span>
            {isConverting
              ? 'Converting...'
              : options.format === 'best'
              ? 'Extract Best Native Stream (~160k Opus / ~128k AAC Direct)'
              : options.format === 'opus'
              ? 'Extract Native Opus (~160 kbps Direct)'
              : options.format === 'm4a'
              ? 'Extract Native AAC (~128 kbps Direct)'
              : options.format === 'mp3'
              ? `Transcode to MP3 (${options.bitrate === 'native' ? '~160k' : options.bitrate})`
              : `Convert to ${options.format.toUpperCase()} (Lossless Master)`}
          </span>
        </button>
      </div>
    </section>
  );
};

import { ArrowRight, Clipboard, Loader2, Sparkles, X } from 'lucide-react';
import React, { useState } from 'react';
import { DemoTrack } from '../types';

interface UrlInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  demoTracks: DemoTrack[];
  onSelectDemo: (track: DemoTrack) => void;
}

export const UrlInput: React.FC<UrlInputProps> = ({
  value,
  onChange,
  onSubmit,
  isLoading,
  demoTracks,
  onSelectDemo
}) => {
  const [copiedNotification, setCopiedNotification] = useState(false);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onChange(text);
        setCopiedNotification(true);
        setTimeout(() => setCopiedNotification(false), 2000);
      }
    } catch {
      // Clipboard permissions may not be granted in iframe
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim() && !isLoading) {
      onSubmit();
    }
  };

  return (
    <section id="url-input-section" className="w-full space-y-3">
      <div className="relative flex items-center shadow-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/20 transition-all">
        <input
          id="youtube-url-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste YouTube URL or video ID (e.g. https://youtu.be/dQw4w9WgXcQ)"
          disabled={isLoading}
          className="w-full py-3.5 pl-4 pr-28 text-sm md:text-base text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 bg-transparent rounded-xl focus:outline-none"
        />

        <div className="absolute right-2 flex items-center gap-1.5">
          {value && (
            <button
              id="clear-url-btn"
              type="button"
              onClick={() => onChange('')}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Clear input"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <button
            id="paste-clipboard-btn"
            type="button"
            onClick={handlePaste}
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200/80 dark:hover:bg-zinc-700 rounded-lg transition-colors"
            title="Paste from clipboard"
          >
            <Clipboard className="w-3.5 h-3.5" />
            <span>{copiedNotification ? 'Pasted!' : 'Paste'}</span>
          </button>

          <button
            id="submit-url-btn"
            type="button"
            onClick={onSubmit}
            disabled={!value.trim() || isLoading}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs md:text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 rounded-lg transition-colors shadow-sm disabled:shadow-none"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Loading...</span>
              </>
            ) : (
              <>
                <span>Load</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {demoTracks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1 font-medium text-zinc-600 dark:text-zinc-400">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Quick Demo:
          </span>
          {demoTracks.map((track) => (
            <button
              key={track.id}
              id={`demo-track-${track.id}`}
              type="button"
              onClick={() => onSelectDemo(track)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-zinc-700 dark:text-zinc-300 hover:text-rose-700 dark:hover:text-rose-300 border border-zinc-200 dark:border-zinc-800 hover:border-rose-200 dark:hover:border-rose-800 transition-colors text-xs font-medium"
            >
              <span>{track.title}</span>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">({track.duration})</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

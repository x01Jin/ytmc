import { Check, Download, ExternalLink, Link2, Play, Search, X } from 'lucide-react';
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ApiClient } from '../services/apiClient';
import { useConvertDraft } from '../store/appStore';
import type { YouTubeSearchResult } from '../types';

const YouTubePreviewModal = lazy(() =>
  import('../components/YouTubePreviewModal').then(m => ({
    default: m.YouTubePreviewModal,
  }))
);

const COPY_CONFIRM_TIMEOUT_MS = 2000;
const SEARCH_LIMIT = 12;

export function YouTubeRoute({ onDownload, active }: { onDownload: () => void; active: boolean }) {
  const { actions: draftActions } = useConvertDraft();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [preview, setPreview] = useState<YouTubeSearchResult | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    []
  );

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = query.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    setSearchError(null);
    try {
      const data = await ApiClient.searchYouTube(text, SEARCH_LIMIT, controller.signal);
      if (abortRef.current !== controller) return;
      setResults(data);
      setHasSearched(true);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResults([]);
      setHasSearched(true);
      setSearchError(err instanceof Error ? err.message : 'YouTube search failed. Try again.');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsSearching(false);
      }
    }
  };

  const handleCopyLink = async (videoId: string) => {
    try {
      await navigator.clipboard.writeText(ApiClient.youTubeWatchUrl(videoId));
      setCopiedId(videoId);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedId(null), COPY_CONFIRM_TIMEOUT_MS);
    } catch {
      setCopiedId(null);
    }
  };

  const handleDownload = (videoId: string) => {
    const target = ApiClient.youTubeWatchUrl(videoId);
    draftActions.setUrl(target);
    draftActions.queueInspectUrl(target);
    onDownload();
  };

  return (
    <div className="flex min-h-full flex-col gap-3">
      <section className="px-panel sticky top-0 z-10 p-3" aria-label="Search YouTube">
        <form onSubmit={event => void handleSearch(event)} className="flex gap-2">
          <label htmlFor="youtube-search" className="sr-only">
            Search YouTube
          </label>
          <input
            id="youtube-search"
            name="youtube-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search YouTube — artist, title, topic…"
            className="px-input h-11 min-w-0 flex-1 text-sm"
          />
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="px-btn h-11 shrink-0 items-center gap-1.5 text-sm"
            aria-label={isSearching ? 'Searching YouTube' : 'Search YouTube'}
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {isSearching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {searchError && (
          <p role="alert" className="mt-2 text-xs text-px-err sm:text-sm">
            {searchError}
          </p>
        )}
      </section>

      {!hasSearched ? (
        <section className="px-panel p-6 text-center" aria-label="YouTube">
          <p className="font-display text-xs">SEARCH YOUTUBE</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-px-dim">
            Find a video above, preview the full video, then copy the link, open it in your browser,
            or send it to Convert.
          </p>
        </section>
      ) : results.length === 0 && !isSearching && !searchError ? (
        <section className="px-panel p-6 text-center" aria-label="YouTube results">
          <p className="font-display text-xs">NO RESULTS</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-px-dim">
            Nothing matched that search. Try different words.
          </p>
        </section>
      ) : results.length > 0 ? (
        <section className="px-panel divide-y divide-px-line" aria-label="YouTube results">
          <p className="sr-only" role="status">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </p>
          {results.map(result => (
            <div key={result.id} className="px-row flex items-center gap-3 p-2.5">
              <span className="h-10 w-10 shrink-0 overflow-hidden border-2 border-px-line bg-px-bg">
                <img
                  src={result.thumbnail}
                  alt=""
                  width={40}
                  height={40}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="px-pixelated h-full w-full object-cover"
                />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{result.title}</span>
                <span className="px-tabular block truncate text-xs text-px-dim">
                  {result.author}
                  {result.duration ? ` • ${result.duration}` : ''}
                </span>
              </span>

              <button
                type="button"
                className="px-btn shrink-0 !p-2"
                onClick={() => setPreview(current => (current?.id === result.id ? null : result))}
                title={preview?.id === result.id ? 'Close preview' : 'Preview video'}
                aria-label={
                  preview?.id === result.id
                    ? `Close preview of ${result.title}`
                    : `Preview video of ${result.title}`
                }
                aria-expanded={preview?.id === result.id}
                aria-controls="youtube-preview-modal"
              >
                {preview?.id === result.id ? (
                  <X className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Play className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="px-btn shrink-0 !p-2"
                onClick={() => void handleCopyLink(result.id)}
                title="Copy YouTube link"
                aria-label={
                  copiedId === result.id ? 'Link copied' : `Copy YouTube link for ${result.title}`
                }
              >
                {copiedId === result.id ? (
                  <Check className="h-4 w-4 text-px-ok" aria-hidden="true" />
                ) : (
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="px-btn shrink-0 !p-2"
                onClick={() => handleDownload(result.id)}
                title="Send to Convert"
                aria-label={`Download ${result.title} via Convert`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="px-btn shrink-0 !p-2"
                onClick={() => ApiClient.openExternalLink(ApiClient.youTubeWatchUrl(result.id))}
                title="Open in browser"
                aria-label={`Open ${result.title} in browser`}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {preview && active && (
        <Suspense fallback={null}>
          <YouTubePreviewModal result={preview} onClose={() => setPreview(null)} />
        </Suspense>
      )}
    </div>
  );
}

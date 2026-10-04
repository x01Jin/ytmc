import { FolderSearch, Import, Pencil, Play, Square, Trash2 } from 'lucide-react';
import React, { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { AudioPlayer } from '../components/AudioPlayer';
import { CoverArtPreview } from '../components/CoverArtPreview';
import { TrackArtwork } from '../components/TrackArtwork';
import { useLibrary } from '../store/appStore';
import type { ConversionJob, LibraryRecord } from '../types';
import { previewStreamUrl } from '../utils/audioSupport';
import { formatFileSize } from '../utils/format';

const LibraryEditPanel = lazy(() =>
  import('../components/library/LibraryEditPanel').then(m => ({
    default: m.LibraryEditPanel,
  }))
);

type SortKey = 'recent' | 'name' | 'size';

function recordToJob(record: LibraryRecord, mediaVersion = 0): ConversionJob {
  const base = previewStreamUrl(record.jobId, record.format);
  return {
    id: record.jobId,
    videoId: record.videoId,
    title: record.title,
    author: record.author,
    thumbnail: record.thumbnail,
    format: record.format,
    bitrate: 'native',
    status: 'completed',
    progress: 100,
    stageMessage: 'Finished',
    outputFileName: record.fileName,
    outputFilePath: record.filePath,
    fileSizeBytes: record.fileSizeBytes,
    downloadUrl: `/api/download/${encodeURIComponent(record.jobId)}`,
    streamUrl: `${base}${base.includes('?') ? '&' : '?'}v=${mediaVersion}`,
    createdAt: record.completedAt,
    completedAt: record.completedAt,
  };
}

export function LibraryRoute() {
  const { state, actions } = useLibrary();
  const { library, isLoading, error } = state;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playNonce, setPlayNonce] = useState(0);
  const [artPreviewId, setArtPreviewId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [mediaVersions, setMediaVersions] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const records = useMemo(() => {
    const list = library?.records ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          r =>
            r.title.toLowerCase().includes(q) ||
            r.author.toLowerCase().includes(q) ||
            r.fileName.toLowerCase().includes(q)
        )
      : [...list];
    switch (sort) {
      case 'name':
        return filtered.toSorted((a, b) => a.title.localeCompare(b.title));
      case 'size':
        return filtered.toSorted((a, b) => b.fileSizeBytes - a.fileSizeBytes);
      default:
        return filtered.toSorted((a, b) => b.completedAt - a.completedAt);
    }
  }, [library, query, sort]);

  const handleReveal = async (jobId: string) => {
    setActionError(null);
    try {
      await actions.revealFile(jobId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not reveal the file.');
    }
  };

  const handleDelete = async (jobId: string) => {
    setActionError(null);
    setConfirmDeleteId(null);
    try {
      await actions.deleteFile(jobId);
      if (playingId === jobId) setPlayingId(null);
      if (artPreviewId === jobId) setArtPreviewId(null);
      if (editingId === jobId) setEditingId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete the file.');
    }
  };

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setActionError(null);
    setIsImporting(true);
    try {
      await Promise.all(files.map(file => actions.importFile(file)));
      await actions.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not copy audio into the library.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleEdited = (jobId: string) => {
    setMediaVersions(prev => ({ ...prev, [jobId]: (prev[jobId] ?? 0) + 1 }));
    void actions.refresh();
  };

  if (isLoading && !library) {
    return (
      <section className="px-panel p-2" aria-label="Library">
        <p className="text-sm text-px-dim">Loading your library…</p>
      </section>
    );
  }

  if (error && !library) {
    return (
      <section className="px-panel border-px-err p-2" role="alert" aria-label="Library">
        <p className="text-sm font-semibold">Library did not load</p>
        <p className="mt-1 text-sm text-px-dim">{error}</p>
        <button
          type="button"
          className="px-btn mt-3 text-sm"
          onClick={() => void actions.refresh()}
        >
          Retry
        </button>
      </section>
    );
  }

  const playingRecord = playingId ? (records.find(r => r.jobId === playingId) ?? null) : null;
  const artPreviewRecord = artPreviewId
    ? (records.find(r => r.jobId === artPreviewId) ?? null)
    : null;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 overflow-hidden"
      onDragOver={event => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={event => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={event => {
        event.preventDefault();
        setIsDragging(false);
        void importFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <section
        className={`px-panel flex shrink-0 flex-col gap-2 p-2 sm:flex-row sm:items-end ${
          isDragging ? 'border-px-acc' : ''
        }`}
        aria-label="Library controls"
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="library-search" className="mb-1 block text-xs text-px-dim">
            Search your library
          </label>
          <input
            id="library-search"
            name="library-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Artist, title, filename…"
            className="px-input h-11 w-full text-sm"
          />
        </div>

        <div className="flex flex-wrap items-end justify-end gap-2 sm:justify-start">
          <div className="flex min-w-0 flex-col">
            <label htmlFor="library-sort" className="mb-1 block text-xs text-px-dim">
              Sort
            </label>
            <select
              id="library-sort"
              name="library-sort"
              value={sort}
              onChange={e => setSort(e.target.value as SortKey)}
              className="px-select h-11 min-w-[9rem] text-sm"
            >
              <option value="recent">Most recent</option>
              <option value="name">Title A to Z</option>
              <option value="size">Largest first</option>
            </select>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.m4a,.flac,.wav,.opus,.ogg,.aac,audio/*"
            multiple
            className="sr-only"
            onChange={event => {
              void importFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="px-btn h-11 items-center gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            title="Copy audio into the library"
          >
            <Import className="h-3.5 w-3.5" aria-hidden="true" />
            {isImporting ? 'Copying…' : 'Add audio'}
          </button>
        </div>
      </section>

      {isDragging && (
        <div className="px-panel border-px-acc p-2 text-center text-sm text-px-acc">
          Drop audio files to copy them into your library
        </div>
      )}

      {actionError && (
        <div role="alert" className="px-panel border-px-err p-2 text-sm">
          <span className="font-semibold">Action failed: </span>
          <span className="text-px-dim">{actionError}</span>
        </div>
      )}

      {records.length === 0 ? (
        <section className="px-panel flex-1 p-2 text-center" aria-label="Library">
          <p className="font-display text-xs">EMPTY SHELF</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-px-dim">
            {query
              ? 'Nothing matches that search. Clear the search to see everything.'
              : 'Finished tracks land here. Convert your first track to fill the shelf.'}
          </p>
        </section>
      ) : (
        <section
          className="px-panel min-h-0 flex-1 divide-y divide-px-line overflow-y-auto overscroll-contain"
          aria-label="Library files"
        >
          {records.map(record => {
            const isEditing = editingId === record.jobId;
            const isPlaying = playingId === record.jobId;
            return (
              <div key={record.jobId} className="px-row min-w-0">
                <div className="flex min-w-0 items-center gap-2 p-2">
                  <button
                    type="button"
                    onClick={() => setArtPreviewId(record.jobId)}
                    aria-label={`View cover art for ${record.title}`}
                    title="View cover art"
                    className="shrink-0 cursor-zoom-in border-2 border-px-line transition-colors hover:border-px-acc"
                  >
                    <TrackArtwork
                      src={record.thumbnail}
                      className="px-pixelated block h-10 w-10 bg-px-bg object-cover"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{record.title}</p>
                    <p className="px-tabular truncate text-xs text-px-dim">
                      {record.author} • {record.format.toUpperCase()} •{' '}
                      {formatFileSize(record.fileSizeBytes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <button
                      type="button"
                      className={`px-btn !px-2 !py-1 text-xs ${isPlaying ? '!border-px-acc !bg-px-acc !text-[#0b0b12]' : ''}`}
                      onClick={() => {
                        if (isPlaying) {
                          setPlayingId(null);
                        } else {
                          setPlayingId(record.jobId);
                          setPlayNonce(n => n + 1);
                        }
                      }}
                      aria-label={isPlaying ? `Stop ${record.title}` : `Play ${record.title}`}
                      aria-pressed={isPlaying}
                      title={isPlaying ? 'Stop and close player' : 'Play in player'}
                    >
                      {isPlaying ? (
                        <Square className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Play className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="px-btn !px-2 !py-1 text-xs"
                      onClick={() => void handleReveal(record.jobId)}
                      aria-label={`Show ${record.fileName} in Explorer`}
                      title="Show in Explorer"
                    >
                      <FolderSearch className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`px-btn !px-2 !py-1 text-xs ${isEditing ? '!border-px-acc !bg-px-acc !text-[#0b0b12]' : ''}`}
                      onClick={() =>
                        setEditingId(cur => (cur === record.jobId ? null : record.jobId))
                      }
                      aria-expanded={isEditing}
                      aria-controls={`library-edit-${record.jobId}`}
                      aria-label={
                        isEditing ? `Close editor for ${record.title}` : `Edit ${record.title}`
                      }
                      title="Edit trim, tags and advanced options"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="px-btn !border-px-err !px-2 !py-1 text-xs"
                      onClick={() => setConfirmDeleteId(record.jobId)}
                      aria-label={`Delete ${record.fileName}`}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <div id={`library-edit-${record.jobId}`}>
                    <Suspense fallback={null}>
                      <LibraryEditPanel
                        key={`${record.jobId}:${record.fileName}:${record.fileSizeBytes}`}
                        record={record}
                        onEdited={() => handleEdited(record.jobId)}
                      />
                    </Suspense>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {playingRecord && (
        <section className="shrink-0" aria-label="Preview player">
          <AudioPlayer
            job={recordToJob(playingRecord, mediaVersions[playingRecord.jobId] ?? 0)}
            autoPlayNonce={playNonce}
          />
        </section>
      )}

      {artPreviewRecord && (
        <CoverArtPreview
          src={artPreviewRecord.thumbnail}
          title={artPreviewRecord.title}
          subtitle={artPreviewRecord.author}
          onClose={() => setArtPreviewId(null)}
        />
      )}

      {confirmDeleteId && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirm delete"
          className="px-panel border-px-err fixed inset-x-4 bottom-4 z-50 p-4 sm:left-auto sm:right-4 sm:w-96"
        >
          <p className="text-sm font-semibold">Delete this file?</p>
          <p className="mt-1 text-sm text-px-dim">
            The audio file leaves your library folder for good. You cannot undo this.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="px-btn !border-px-err flex-1 text-sm"
              onClick={() => void handleDelete(confirmDeleteId)}
            >
              Delete file
            </button>
            <button
              type="button"
              className="px-btn flex-1 text-sm"
              onClick={() => setConfirmDeleteId(null)}
            >
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

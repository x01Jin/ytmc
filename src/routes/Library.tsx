import { Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AudioPlayer } from "../components/AudioPlayer";
import { LibraryEditPanel } from "../components/library/LibraryEditPanel";
import { useLibrary } from "../store/appStore";
import type { ConversionJob, LibraryRecord } from "../types";
import { previewStreamUrl } from "../utils/audioSupport";

type SortKey = "recent" | "name" | "size";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function recordToJob(record: LibraryRecord): ConversionJob {
  return {
    id: record.jobId,
    videoId: record.videoId,
    title: record.title,
    author: record.author,
    thumbnail: record.thumbnail,
    format: record.format,
    bitrate: "native",
    status: "completed",
    progress: 100,
    stageMessage: "Finished",
    outputFileName: record.fileName,
    outputFilePath: record.filePath,
    fileSizeBytes: record.fileSizeBytes,
    downloadUrl: `/api/download/${encodeURIComponent(record.jobId)}`,
    streamUrl: previewStreamUrl(record.jobId, record.format),
    createdAt: record.completedAt,
    completedAt: record.completedAt,
  };
}

export function LibraryRoute() {
  const { state, actions } = useLibrary();
  const { library, isLoading, error } = state;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const records = useMemo(() => {
    const list = library?.records ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.author.toLowerCase().includes(q) ||
            r.fileName.toLowerCase().includes(q),
        )
      : [...list];
    switch (sort) {
      case "name":
        return filtered.sort((a, b) => a.title.localeCompare(b.title));
      case "size":
        return filtered.sort((a, b) => b.fileSizeBytes - a.fileSizeBytes);
      default:
        return filtered.sort((a, b) => b.completedAt - a.completedAt);
    }
  }, [library, query, sort]);

  const handleReveal = async (jobId: string) => {
    setActionError(null);
    try {
      await actions.revealFile(jobId);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not reveal the file.",
      );
    }
  };

  const handleDelete = async (jobId: string) => {
    setActionError(null);
    setConfirmDeleteId(null);
    try {
      await actions.deleteFile(jobId);
      if (playingId === jobId) setPlayingId(null);
      if (editingId === jobId) setEditingId(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not delete the file.",
      );
    }
  };

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setActionError(null);
    setIsImporting(true);
    try {
      await Promise.all(files.map((file) => actions.importFile(file)));
      await actions.refresh();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : "Could not copy audio into the library.",
      );
    } finally {
      setIsImporting(false);
    }
  };

  if (isLoading && !library) {
    return (
      <section className="px-panel p-4" aria-label="Library">
        <p className="text-sm text-px-dim">Loading your library…</p>
      </section>
    );
  }

  if (error && !library) {
    return (
      <section
        className="px-panel border-px-err p-4"
        role="alert"
        aria-label="Library"
      >
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

  const playingRecord = playingId
    ? (records.find((r) => r.jobId === playingId) ?? null)
    : null;

  return (
    <div
      className="flex min-h-full flex-col gap-3"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        void importFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <section
        className={`px-panel flex flex-col gap-2 p-3 sm:flex-row sm:items-center ${
          isDragging ? "border-px-acc" : ""
        }`}
        aria-label="Library controls"
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor="library-search"
            className="mb-1 block text-xs text-px-dim"
          >
            Search your library
          </label>
          <input
            id="library-search"
            name="library-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Artist, title, filename…"
            className="px-input w-full text-sm"
          />
        </div>
        <div className="flex items-end gap-2">
          <label
            htmlFor="library-sort"
            className="mb-1 block text-xs text-px-dim"
          >
            Sort
          </label>
          <select
            id="library-sort"
            name="library-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="px-select text-sm"
          >
            <option value="recent">Most recent</option>
            <option value="name">Title A to Z</option>
            <option value="size">Largest first</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.m4a,.flac,.wav,.opus,.ogg,.aac,audio/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              void importFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="px-btn flex items-center gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            title="Copy audio into the library"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {isImporting ? "Copying…" : "Add audio"}
          </button>
        </div>
      </section>

      {isDragging && (
        <div className="px-panel border-px-acc p-4 text-center text-sm text-px-acc">
          Drop audio files to copy them into your library
        </div>
      )}

      {actionError && (
        <div role="alert" className="px-panel border-px-err p-3 text-sm">
          <span className="font-semibold">Action failed: </span>
          <span className="text-px-dim">{actionError}</span>
        </div>
      )}

      {records.length === 0 ? (
        <section className="px-panel p-6 text-center" aria-label="Library">
          <p className="font-display text-xs">EMPTY SHELF</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-px-dim">
            {query
              ? "Nothing matches that search. Clear the search to see everything."
              : "Finished tracks land here. Convert your first track to fill the shelf."}
          </p>
        </section>
      ) : (
        <section
          className="px-panel divide-y divide-px-line"
          aria-label="Library files"
        >
          {records.map((record) => {
            const isEditing = editingId === record.jobId;
            return (
              <div key={record.jobId} className="px-row min-w-0">
                <div className="flex min-w-0 items-center gap-3 p-2.5">
                  <img
                    src={record.thumbnail}
                    alt=""
                    width={40}
                    height={40}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="px-pixelated h-10 w-10 shrink-0 border-2 border-px-line object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {record.title}
                    </p>
                    <p className="px-tabular truncate text-xs text-px-dim">
                      {record.author} • {record.format.toUpperCase()} •{" "}
                      {formatBytes(record.fileSizeBytes)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <button
                      type="button"
                      className="px-btn !px-2 !py-1 text-xs"
                      onClick={() => setPlayingId(record.jobId)}
                      aria-label={`Load ${record.title} in the player`}
                      title="Load in player"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className="px-btn !px-2 !py-1 text-xs"
                      onClick={() => void handleReveal(record.jobId)}
                      aria-label={`Show ${record.fileName} in Explorer`}
                      title="Show in Explorer"
                    >
                      ⌕
                    </button>
                    <button
                      type="button"
                      className="px-btn !px-2 !py-1 text-xs"
                      onClick={() =>
                        setEditingId((cur) =>
                          cur === record.jobId ? null : record.jobId,
                        )
                      }
                      aria-expanded={editingId === record.jobId}
                      aria-controls={`library-edit-${record.jobId}`}
                      aria-label={
                        editingId === record.jobId
                          ? `Close editor for ${record.title}`
                          : `Edit ${record.title}`
                      }
                      title="Edit trim, tags and advanced options"
                    >
                      {editingId === record.jobId ? "▾ Edit" : "▸ Edit"}
                    </button>
                    <button
                      type="button"
                      className="px-btn !border-px-err !px-2 !py-1 text-xs"
                      onClick={() => setConfirmDeleteId(record.jobId)}
                      aria-label={`Delete ${record.fileName}`}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {isEditing && (
                  <div id={`library-edit-${record.jobId}`}>
                    <LibraryEditPanel
                      record={record}
                      onEdited={() => void actions.refresh()}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section
        className="sticky bottom-0 z-10 mt-auto"
        aria-label="Preview player"
      >
        <AudioPlayer
          job={playingRecord ? recordToJob(playingRecord) : undefined}
        />
      </section>

      {confirmDeleteId && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirm delete"
          className="px-panel border-px-err fixed inset-x-4 bottom-4 z-50 p-4 sm:left-auto sm:right-4 sm:w-96"
        >
          <p className="text-sm font-semibold">Delete this file?</p>
          <p className="mt-1 text-sm text-px-dim">
            The audio file leaves your library folder for good. You cannot undo
            this.
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

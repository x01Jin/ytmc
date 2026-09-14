import {
  Check,
  Disc3,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { ApiClient } from "../services/apiClient";
import { MusicTagCandidate, MusicTags, TagSource } from "../types";

interface TagEditorProps {
  initialTags?: MusicTags;
  defaultVideoTitle?: string;
  defaultArtist?: string;
  defaultThumbnail?: string;
  onChange: (tags: MusicTags) => void;
  onSaveToFile?: (tags: MusicTags) => Promise<void>;
  isSavingToFile?: boolean;
  mode?: "pre-convert" | "post-convert";
}

export const TagEditor: React.FC<TagEditorProps> = ({
  initialTags,
  defaultVideoTitle = "",
  defaultArtist = "",
  defaultThumbnail = "",
  onChange,
  onSaveToFile,
  isSavingToFile = false,
  mode = "pre-convert",
}) => {
  // Current active tags
  const [tags, setTags] = useState<MusicTags>(() => {
    return (
      initialTags || {
        title: defaultVideoTitle,
        artist: defaultArtist,
        album: defaultVideoTitle,
        albumArtist: defaultArtist,
        year: "",
        genre: "Music",
        trackNumber: "1",
        coverUrl: defaultThumbnail,
        cleanDescription: true,
        comment: "YouTube to Music Converter",
      }
    );
  });

  // Autotag search and detection state
  const [selectedSource, setSelectedSource] = useState<TagSource>("all");
  const [candidates, setCandidates] = useState<MusicTagCandidate[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  const [appliedSource, setAppliedSource] = useState<string | null>(null);
  const [hasUserEdited, setHasUserEdited] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const debounceTimeoutRef = useRef<any>(null);

  // Synchronize internal tags when initialTags change from outside
  useEffect(() => {
    if (initialTags && !hasUserEdited) {
      setTags(initialTags);
    }
  }, [initialTags]);

  // Execute tag detection based on track name input
  const performSearch = async (query: string, source: TagSource) => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setCandidates([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const results = await ApiClient.searchTags(trimmed, source);
      setCandidates(results);
      setLastSearchedQuery(trimmed);
    } catch {
      setCandidates([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Live detection whenever the Name / Title input changes
  const handleNameInputChange = (newName: string) => {
    setHasUserEdited(true);
    const updated = { ...tags, title: newName };
    setTags(updated);
    onChange(updated);

    // Debounce autotagger query
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      performSearch(newName, selectedSource);
    }, 400);
  };

  // Initial detection on mount or when default title is loaded
  useEffect(() => {
    if (tags.title && tags.title.trim().length >= 2 && !lastSearchedQuery) {
      performSearch(tags.title, selectedSource);
    }
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [tags.title]);

  const handleSourceChange = (newSource: TagSource) => {
    setSelectedSource(newSource);
    if (tags.title.trim()) {
      performSearch(tags.title, newSource);
    }
  };

  const handleApplyCandidate = (candidate: MusicTagCandidate) => {
    setHasUserEdited(true);
    const updated: MusicTags = {
      ...tags,
      title: candidate.title,
      artist: candidate.artist,
      album: candidate.album || candidate.title,
      albumArtist: candidate.albumArtist || candidate.artist,
      year: candidate.year || tags.year,
      genre: candidate.genre || tags.genre,
      trackNumber: candidate.trackNumber || tags.trackNumber || "1",
      coverUrl: candidate.coverUrl || tags.coverUrl,
      coverData: undefined,
    };

    setTags(updated);
    onChange(updated);
    setAppliedSource(
      `${candidate.source.toUpperCase()} (${candidate.artist} - ${candidate.title})`,
    );
    setTimeout(() => setAppliedSource(null), 4000);
  };

  const handleApplyCandidateCover = (candidate: MusicTagCandidate) => {
    if (!candidate.coverUrl) return;
    handleFieldChange("coverUrl", candidate.coverUrl);
    setAppliedSource(`${candidate.source.toUpperCase()} artwork selected`);
    setTimeout(() => setAppliedSource(null), 4000);
  };

  const handleFieldChange = (field: keyof MusicTags, value: any) => {
    setHasUserEdited(true);
    const updated = {
      ...tags,
      [field]: value,
      ...(field === "coverUrl" ? { coverData: undefined } : {}),
    };
    setTags(updated);
    onChange(updated);
  };

  const handleResetToDefaults = () => {
    const reset: MusicTags = {
      title: defaultVideoTitle,
      artist: defaultArtist,
      album: defaultVideoTitle,
      albumArtist: defaultArtist,
      year: "",
      genre: "Music",
      trackNumber: "1",
      coverUrl: defaultThumbnail,
      cleanDescription: true,
      comment: "YouTube to Music Converter",
    };
    setTags(reset);
    onChange(reset);
    setHasUserEdited(false);
    performSearch(defaultVideoTitle, selectedSource);
  };

  return (
    <div className="min-w-0 space-y-3 text-px-text">
      {/* PRIMARY INPUT: Track Name / Music Name (Autotag Detector) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="tag-track-name"
            className="flex items-center gap-1.5 text-xs font-semibold text-px-text"
          >
            <span>Music Name / Track Title</span>
            <span className="border border-px-line bg-px-panel-2 px-1.5 py-0.5 text-[10px] font-normal text-px-warn">
              Search query
            </span>
          </label>
          <div className="flex items-center gap-2 text-[11px] text-px-dim">
            <span>Used to find matching tags</span>
            <button
              type="button"
              onClick={handleResetToDefaults}
              className="px-btn !border-0 !bg-transparent !px-1 !py-0.5 text-xs text-px-dim hover:!bg-px-panel-2 hover:text-px-text"
              title="Reset to initial video information"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <div className="relative">
          <input
            id="tag-track-name"
            type="text"
            value={tags.title}
            onChange={(e) => handleNameInputChange(e.target.value)}
            placeholder="Type song title (e.g. Never Gonna Give You Up)..."
            className="px-input w-full pr-24 text-sm"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isSearching ? (
              <span className="flex items-center gap-1 bg-px-panel-2 px-2 py-1 text-[11px] text-px-acc">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Detecting</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => performSearch(tags.title, selectedSource)}
                className="px-btn !px-2 !py-1 text-xs"
                title="Search tag matches"
              >
                <Search className="h-3 w-3 text-px-dim" />
                <span>Search</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AUTOTAGGER MATCHES / SOURCE SELECTOR */}
      <div className="space-y-2 border border-px-line bg-px-bg p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-px-text">
            <Sparkles className="h-3.5 w-3.5 text-px-warn" />
            <span>Matching Tags Detected</span>
            {candidates.length > 0 && (
              <span className="border border-px-line bg-px-panel-2 px-1.5 py-0.5 text-[10px] text-px-dim">
                {candidates.length} found
              </span>
            )}
          </div>

          {/* Sources Filter */}
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="mr-1 text-px-dim">Source:</span>
            {(["all", "itunes", "deezer", "musicbrainz"] as TagSource[]).map(
              (src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => handleSourceChange(src)}
                  className={`border border-transparent px-2 py-0.5 capitalize transition-colors ${
                    selectedSource === src
                      ? "bg-px-acc text-[#0b0b12] font-medium"
                      : "border border-px-line bg-px-panel-2 text-px-dim hover:border-px-acc hover:text-px-text"
                  }`}
                >
                  {src === "musicbrainz" ? "MusicBrainz" : src}
                </button>
              ),
            )}
          </div>
        </div>

        {/* Applied Feedback Notification */}
        {appliedSource && (
          <div className="flex items-center gap-1.5 border border-px-ok bg-px-bg p-2 text-xs text-px-ok">
            <Check className="h-3.5 w-3.5" />
            <span>Tags and artwork auto-populated from {appliedSource}</span>
          </div>
        )}

        {/* Detected Candidates Scroll List */}
        {isSearching ? (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-px-dim">
            <Loader2 className="h-4 w-4 animate-spin text-px-acc" />
            <span>Scanning all music sources for "{tags.title}"...</span>
          </div>
        ) : candidates.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
            {candidates.map((c) => (
              <div
                key={c.id}
                onClick={() => handleApplyCandidate(c)}
                className="group flex cursor-pointer items-start gap-2.5 border border-px-line bg-px-panel p-2.5 transition-colors hover:border-px-acc hover:bg-px-panel-2"
                title="Click to apply these tags"
              >
                {c.coverUrl ? (
                  <img
                    src={c.coverUrl}
                    alt={c.title}
                    referrerPolicy="no-referrer"
                    className="h-11 w-11 shrink-0 border border-px-line bg-px-bg object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-px-line bg-px-panel-2 text-px-dim">
                    <Music className="h-5 w-5" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="truncate text-xs font-semibold text-px-text group-hover:text-px-acc">
                      {c.title}
                    </p>
                    <span
                      className={`border px-1 text-[9px] font-bold uppercase tracking-wider ${
                        c.source === "itunes"
                          ? "border border-px-line bg-px-panel-2 text-px-acc"
                          : c.source === "deezer"
                            ? "border border-px-line bg-px-panel-2 text-px-acc"
                            : "border border-px-line bg-px-panel-2 text-px-warn"
                      }`}
                    >
                      {c.source}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-px-dim">{c.artist}</p>
                  <p className="truncate text-[10px] text-px-dim">
                    {c.album || "Single"} {c.year ? `• ${c.year}` : ""}{" "}
                    {c.genre ? `• ${c.genre}` : ""}
                  </p>
                  {c.coverUrl && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleApplyCandidateCover(c);
                      }}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-px-acc hover:text-px-text"
                    >
                      <ImageIcon className="h-3 w-3" />
                      Use cover only
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-2.5 text-center text-xs text-px-dim">
            {tags.title.trim()
              ? `No exact matches found for "${tags.title}". You can refine the title above or fill out the tags manually below.`
              : "Enter a track title above to detect tags from iTunes, Deezer, and MusicBrainz."}
          </div>
        )}
      </div>

      {/* DETAILED TAG FIELDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {/* Artist Field */}
        <div className="space-y-1">
          <label
            htmlFor="tag-artist"
            className="text-xs font-semibold text-px-text"
          >
            Artist / Performer
          </label>
          <input
            id="tag-artist"
            type="text"
            value={tags.artist}
            onChange={(e) => handleFieldChange("artist", e.target.value)}
            placeholder="Artist name..."
            className="px-input w-full py-1.5 text-xs"
          />
        </div>

        {/* Album Field */}
        <div className="space-y-1">
          <label
            htmlFor="tag-album"
            className="text-xs font-semibold text-px-text"
          >
            Album
          </label>
          <input
            id="tag-album"
            type="text"
            value={tags.album}
            onChange={(e) => handleFieldChange("album", e.target.value)}
            placeholder="Album title..."
            className="px-input w-full py-1.5 text-xs"
          />
        </div>

        {/* Year / Release Date */}
        <div className="space-y-1">
          <label
            htmlFor="tag-year"
            className="text-xs font-semibold text-px-text"
          >
            Release Year
          </label>
          <input
            id="tag-year"
            type="text"
            value={tags.year || ""}
            onChange={(e) => handleFieldChange("year", e.target.value)}
            placeholder="e.g. 1987, 2024"
            className="px-input w-full py-1.5 text-xs"
          />
        </div>

        {/* Genre */}
        <div className="space-y-1">
          <label
            htmlFor="tag-genre"
            className="text-xs font-semibold text-px-text"
          >
            Genre
          </label>
          <input
            id="tag-genre"
            type="text"
            value={tags.genre || ""}
            onChange={(e) => handleFieldChange("genre", e.target.value)}
            placeholder="e.g. Pop, Synthwave, Rock"
            className="px-input w-full py-1.5 text-xs"
          />
        </div>

        {/* Track Number */}
        <div className="space-y-1">
          <label
            htmlFor="tag-track-number"
            className="text-xs font-semibold text-px-text"
          >
            Track #
          </label>
          <input
            id="tag-track-number"
            type="text"
            value={tags.trackNumber || ""}
            onChange={(e) => handleFieldChange("trackNumber", e.target.value)}
            placeholder="e.g. 1 or 1/12"
            className="px-input w-full py-1.5 text-xs"
          />
        </div>

        {/* Album Artist */}
        <div className="space-y-1">
          <label
            htmlFor="tag-album-artist"
            className="text-xs font-semibold text-px-text"
          >
            Album Artist (Optional)
          </label>
          <input
            id="tag-album-artist"
            type="text"
            value={tags.albumArtist || ""}
            onChange={(e) => handleFieldChange("albumArtist", e.target.value)}
            placeholder="Defaults to Artist..."
            className="px-input w-full py-1.5 text-xs"
          />
        </div>
      </div>

      {/* COVER ARTWORK MANAGEMENT */}
      <div className="space-y-2 border-t border-px-line pt-2">
        <label className="flex items-center justify-between text-xs font-semibold text-px-text">
          <span>Album Cover Artwork</span>
          {tags.coverUrl && (
            <button
              type="button"
              onClick={() => handleFieldChange("coverUrl", "")}
              className="flex items-center gap-1 text-[11px] text-px-acc hover:text-px-text"
            >
              <Trash2 className="w-3 h-3" /> Remove Cover
            </button>
          )}
        </label>

        <div className="flex items-center gap-3">
          {tags.coverUrl ? (
            <img
              src={tags.coverUrl}
              alt="Album Artwork"
              referrerPolicy="no-referrer"
              className="h-14 w-14 shrink-0 border border-px-line bg-px-bg object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-dashed border-px-line bg-px-bg text-px-dim">
              <ImageIcon className="h-6 w-6" />
            </div>
          )}

          <div className="flex-1 space-y-1">
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file || file.size > 8 * 1024 * 1024) return;
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result !== "string") return;
                  setHasUserEdited(true);
                  const updated = {
                    ...tags,
                    coverUrl: URL.createObjectURL(file),
                    coverData: reader.result,
                  };
                  setTags(updated);
                  onChange(updated);
                };
                reader.readAsDataURL(file);
              }}
            />
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs text-px-acc hover:text-px-text"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Choose picture locally
            </button>
            <input
              type="text"
              value={tags.coverUrl || ""}
              onChange={(e) => handleFieldChange("coverUrl", e.target.value)}
              placeholder="Cover Art URL (paste image link or use autotagger above)..."
              className="px-input w-full py-1.5 text-xs"
            />
            {defaultThumbnail && tags.coverUrl !== defaultThumbnail && (
              <button
                type="button"
                onClick={() => handleFieldChange("coverUrl", defaultThumbnail)}
                className="text-[11px] text-px-dim underline hover:text-px-text"
              >
                Use original YouTube thumbnail
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CLEAN OPTIONS & POST-CONVERT ACTIONS */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-px-line pt-2">
        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-px-dim hover:text-px-text">
          <input
            type="checkbox"
            checked={tags.cleanDescription !== false}
            onChange={(e) =>
              handleFieldChange("cleanDescription", e.target.checked)
            }
            className="h-3.5 w-3.5 accent-[#7c5cff]"
          />
          <span>Strip lengthy YouTube video descriptions from audio tags</span>
        </label>

        {/* If in post-convert mode, offer explicit "Apply Tags to Audio File" action */}
        {mode === "post-convert" && onSaveToFile && (
          <button
            type="button"
            disabled={isSavingToFile}
            onClick={() => onSaveToFile(tags)}
            className="px-btn px-btn-primary inline-flex items-center gap-1.5 !px-3 !py-1.5 text-xs disabled:opacity-50"
          >
            {isSavingToFile ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Writing Tags...</span>
              </>
            ) : (
              <>
                <Disc3 className="w-3.5 h-3.5" />
                <span>Update Audio File Tags</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

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
  Tag,
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
    <div className="min-w-0 space-y-4 rounded-[2px] border border-zinc-800 bg-zinc-900/90 p-4 sm:p-5 text-zinc-100 shadow-sm">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-[2px] bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <Tag className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              Music Metadata & Tag Editor
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                ID3 v2.3
              </span>
            </h3>
            <p className="text-xs text-zinc-400">
              Edit track info or autotag matching metadata from iTunes, Deezer &
              MusicBrainz
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleResetToDefaults}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Reset to initial video information"
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>

      {/* PRIMARY INPUT: Track Name / Music Name (Autotag Detector) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="tag-track-name"
            className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
          >
            <span>Music Name / Track Title</span>
            <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
              Autotag Detector Query
            </span>
          </label>
          <span className="text-[11px] text-zinc-400">
            Drives matching tag detection
          </span>
        </div>

        <div className="relative">
          <input
            id="tag-track-name"
            type="text"
            value={tags.title}
            onChange={(e) => handleNameInputChange(e.target.value)}
            placeholder="Type song title (e.g. Never Gonna Give You Up)..."
            className="w-full rounded-[2px] bg-zinc-950 border border-zinc-700/80 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 focus:outline-none pr-24"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isSearching ? (
              <span className="flex items-center gap-1 text-[11px] text-rose-400 bg-zinc-900 px-2 py-1 rounded">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Detecting</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => performSearch(tags.title, selectedSource)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                title="Search tag matches"
              >
                <Search className="w-3 h-3 text-zinc-400" />
                <span>Search</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AUTOTAGGER MATCHES / SOURCE SELECTOR */}
      <div className="space-y-2 rounded-[2px] bg-zinc-950/60 border border-zinc-800/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Matching Tags Detected</span>
            {candidates.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-400">
                {candidates.length} found
              </span>
            )}
          </div>

          {/* Sources Filter */}
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-zinc-500 mr-1">Source:</span>
            {(["all", "itunes", "deezer", "musicbrainz"] as TagSource[]).map(
              (src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => handleSourceChange(src)}
                  className={`px-2 py-0.5 rounded capitalize transition-colors ${
                    selectedSource === src
                      ? "bg-rose-600 text-white font-medium"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
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
          <div className="p-2 rounded bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tags and artwork auto-populated from {appliedSource}</span>
          </div>
        )}

        {/* Detected Candidates Scroll List */}
        {isSearching ? (
          <div className="py-4 flex items-center justify-center gap-2 text-xs text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
            <span>Scanning all music sources for "{tags.title}"...</span>
          </div>
        ) : candidates.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
            {candidates.map((c) => (
              <div
                key={c.id}
                onClick={() => handleApplyCandidate(c)}
                className="group p-2.5 rounded-[2px] border border-zinc-800 bg-zinc-900 hover:bg-zinc-850 hover:border-zinc-700 cursor-pointer transition-colors flex items-start gap-2.5"
                title="Click to apply these tags"
              >
                {c.coverUrl ? (
                  <img
                    src={c.coverUrl}
                    alt={c.title}
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded object-cover shrink-0 bg-zinc-950 border border-zinc-800"
                  />
                ) : (
                  <div className="w-11 h-11 rounded bg-zinc-800 flex items-center justify-center shrink-0 text-zinc-500">
                    <Music className="w-5 h-5" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-semibold text-zinc-200 truncate group-hover:text-rose-400">
                      {c.title}
                    </p>
                    <span
                      className={`text-[9px] uppercase tracking-wider font-bold px-1 rounded ${
                        c.source === "itunes"
                          ? "bg-pink-900/40 text-pink-400 border border-pink-700/50"
                          : c.source === "deezer"
                            ? "bg-purple-900/40 text-purple-400 border border-purple-700/50"
                            : "bg-amber-900/40 text-amber-400 border border-amber-700/50"
                      }`}
                    >
                      {c.source}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {c.artist}
                  </p>
                  <p className="text-[10px] text-zinc-500 truncate">
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
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-rose-400 hover:text-rose-300"
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
          <div className="py-2.5 text-center text-xs text-zinc-500">
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
            className="text-xs font-medium text-zinc-300"
          >
            Artist / Performer
          </label>
          <input
            id="tag-artist"
            type="text"
            value={tags.artist}
            onChange={(e) => handleFieldChange("artist", e.target.value)}
            placeholder="Artist name..."
            className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
          />
        </div>

        {/* Album Field */}
        <div className="space-y-1">
          <label
            htmlFor="tag-album"
            className="text-xs font-medium text-zinc-300"
          >
            Album
          </label>
          <input
            id="tag-album"
            type="text"
            value={tags.album}
            onChange={(e) => handleFieldChange("album", e.target.value)}
            placeholder="Album title..."
            className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
          />
        </div>

        {/* Year / Release Date */}
        <div className="space-y-1">
          <label
            htmlFor="tag-year"
            className="text-xs font-medium text-zinc-300"
          >
            Release Year
          </label>
          <input
            id="tag-year"
            type="text"
            value={tags.year || ""}
            onChange={(e) => handleFieldChange("year", e.target.value)}
            placeholder="e.g. 1987, 2024"
            className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
          />
        </div>

        {/* Genre */}
        <div className="space-y-1">
          <label
            htmlFor="tag-genre"
            className="text-xs font-medium text-zinc-300"
          >
            Genre
          </label>
          <input
            id="tag-genre"
            type="text"
            value={tags.genre || ""}
            onChange={(e) => handleFieldChange("genre", e.target.value)}
            placeholder="e.g. Pop, Synthwave, Rock"
            className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
          />
        </div>

        {/* Track Number */}
        <div className="space-y-1">
          <label
            htmlFor="tag-track-number"
            className="text-xs font-medium text-zinc-300"
          >
            Track #
          </label>
          <input
            id="tag-track-number"
            type="text"
            value={tags.trackNumber || ""}
            onChange={(e) => handleFieldChange("trackNumber", e.target.value)}
            placeholder="e.g. 1 or 1/12"
            className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
          />
        </div>

        {/* Album Artist */}
        <div className="space-y-1">
          <label
            htmlFor="tag-album-artist"
            className="text-xs font-medium text-zinc-300"
          >
            Album Artist (Optional)
          </label>
          <input
            id="tag-album-artist"
            type="text"
            value={tags.albumArtist || ""}
            onChange={(e) => handleFieldChange("albumArtist", e.target.value)}
            placeholder="Defaults to Artist..."
            className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
          />
        </div>
      </div>

      {/* COVER ARTWORK MANAGEMENT */}
      <div className="pt-2 border-t border-zinc-800 space-y-2">
        <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
          <span>Album Cover Artwork</span>
          {tags.coverUrl && (
            <button
              type="button"
              onClick={() => handleFieldChange("coverUrl", "")}
              className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
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
              className="w-14 h-14 rounded-[2px] object-cover bg-zinc-950 border border-zinc-700 shrink-0 shadow"
            />
          ) : (
            <div className="w-14 h-14 rounded-[2px] bg-zinc-950 border border-dashed border-zinc-800 flex items-center justify-center shrink-0 text-zinc-600">
              <ImageIcon className="w-6 h-6" />
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
              className="inline-flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Choose picture locally
            </button>
            <input
              type="text"
              value={tags.coverUrl || ""}
              onChange={(e) => handleFieldChange("coverUrl", e.target.value)}
              placeholder="Cover Art URL (paste image link or use autotagger above)..."
              className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
            />
            {defaultThumbnail && tags.coverUrl !== defaultThumbnail && (
              <button
                type="button"
                onClick={() => handleFieldChange("coverUrl", defaultThumbnail)}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 underline"
              >
                Use original YouTube thumbnail
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CLEAN OPTIONS & POST-CONVERT ACTIONS */}
      <div className="pt-2 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-400 hover:text-zinc-300 select-none">
          <input
            type="checkbox"
            checked={tags.cleanDescription !== false}
            onChange={(e) =>
              handleFieldChange("cleanDescription", e.target.checked)
            }
            className="rounded border-zinc-700 bg-zinc-950 text-rose-600 focus:ring-rose-500 w-3.5 h-3.5"
          />
          <span>Strip lengthy YouTube video descriptions from audio tags</span>
        </label>

        {/* If in post-convert mode, offer explicit "Apply Tags to Audio File" action */}
        {mode === "post-convert" && onSaveToFile && (
          <button
            type="button"
            disabled={isSavingToFile}
            onClick={() => onSaveToFile(tags)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
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

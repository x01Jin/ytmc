import { useState } from "react";
import { ApiClient } from "../../services/apiClient";
import type { MusicTags } from "../../types";
import { TagEditor } from "../TagEditor";
import { useEditPanel } from "./LibraryEditPanel";

/** Tagger pane: retag a finished file (metadata rewritten in place, file renamed to match). */
export function TagPane() {
  const { record, onEdited } = useEditPanel();
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (tags: MusicTags) => {
    setIsSaving(true);
    setNotice(null);
    setError(null);
    try {
      await ApiClient.applyTags(record.jobId, tags);
      setNotice("Tags saved and file renamed to match.");
      onEdited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save tags.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-w-0 space-y-2">
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="border-2 border-px-ok bg-px-bg p-2 text-xs text-px-ok"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="border-2 border-px-err bg-px-bg p-2 text-xs text-px-err"
        >
          {error}
        </p>
      )}
      <TagEditor
        initialTags={{
          title: record.title,
          artist: record.author,
          album: record.title,
          albumArtist: record.author,
          year: "",
          genre: "Music",
          trackNumber: "1",
          coverUrl: record.thumbnail,
          cleanDescription: true,
          comment: "YouTube to Music Converter",
        }}
        defaultVideoTitle={record.title}
        defaultArtist={record.author}
        defaultThumbnail={record.thumbnail}
        onChange={() => {}}
        onSaveToFile={handleSave}
        isSavingToFile={isSaving}
        mode="post-convert"
      />
    </div>
  );
}

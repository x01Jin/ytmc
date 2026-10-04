import React, { useState } from 'react';
import { ApiClient } from '../../services/apiClient';
import type { MusicTags } from '../../types';
import { TagEditor } from '../TagEditor';
import { useEditPanel } from './LibraryEditPanel';

function remoteArtwork(value: string | undefined): string {
  return value && /^https?:\/\//i.test(value) ? value : '';
}

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
      const result = await ApiClient.applyTags(record.jobId, tags);
      setNotice(result.message);
      onEdited();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save tags.');
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
        <p role="alert" className="border-2 border-px-err bg-px-bg p-2 text-xs text-px-err">
          {error}
        </p>
      )}
      <TagEditor
        initialTags={{
          title: record.tags?.title || record.title,
          artist: record.tags?.artist || record.author,
          album: record.tags?.album || '',
          albumArtist: record.tags?.albumArtist || '',
          year: record.tags?.year || '',
          genre: record.tags?.genre || '',
          trackNumber: record.tags?.trackNumber || '',
          coverUrl: remoteArtwork(record.tags?.coverUrl),
          cleanDescription: record.tags?.cleanDescription ?? true,
          comment: record.tags?.comment || '',
        }}
        defaultVideoTitle={record.title}
        defaultArtist={record.author}
        defaultThumbnail={record.thumbnail}
        sourceThumbnail={record.sourceThumbnail}
        existingArtworkSrc={record.thumbnail}
        onChange={() => {}}
        onSaveToFile={handleSave}
        isSavingToFile={isSaving}
        mode="post-convert"
      />
    </div>
  );
}

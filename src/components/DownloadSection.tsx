import { ArrowLeft, Check, ChevronDown, Download, FileAudio, Music2, Share2, Sparkles, Tag } from 'lucide-react';
import React, { useState } from 'react';
import { ApiClient } from '../services/apiClient';
import { ConversionJob, MusicTags } from '../types';
import { AudioPlayer } from './AudioPlayer';
import { TagEditor } from './TagEditor';

interface DownloadSectionProps {
  job: ConversionJob;
  onReset: () => void;
  onJobUpdated?: (updatedJob: ConversionJob) => void;
}

export const DownloadSection: React.FC<DownloadSectionProps> = ({ job: initialJob, onReset, onJobUpdated }) => {
  const [job, setJob] = useState<ConversionJob>(initialJob);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [tagSaveSuccess, setTagSaveSuccess] = useState<string | null>(null);

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const handleCopyStreamLink = () => {
    const url = `${window.location.origin}/api/download/${job.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleApplyTagsToFile = async (tags: MusicTags) => {
    setIsSavingTags(true);
    setTagSaveSuccess(null);
    try {
      const updatedJob = await ApiClient.applyTags(job.id, tags);
      setJob(updatedJob);
      if (onJobUpdated) onJobUpdated(updatedJob);
      setTagSaveSuccess(`Tags applied to ${updatedJob.outputFileName}!`);
      setTimeout(() => setTagSaveSuccess(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Failed to update tags');
    } finally {
      setIsSavingTags(false);
    }
  };

  return (
    <section id="download-ready-section" className="w-full space-y-4">
      {/* Primary Success & Action Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm space-y-4 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Check className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Music File Ready to Download</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Encoded with high-fidelity audio stream & ID3 metadata</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 uppercase">
              {job.format} • {job.bitrate}
            </span>
            {job.fileSizeBytes && (
              <span className="text-xs font-medium px-2 py-1 rounded-md bg-zinc-50 dark:bg-zinc-950 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800">
                {formatFileSize(job.fileSizeBytes)}
              </span>
            )}
          </div>
        </div>

        {/* Big direct download button */}
        <a
          id="direct-download-action-btn"
          href={job.downloadUrl || `/api/download/${job.id}`}
          download={job.outputFileName || `${job.title}.${job.format}`}
          className="w-full py-4 px-6 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 text-base"
        >
          <Download className="w-5 h-5" />
          <span>Download {job.format.toUpperCase()} ({job.outputFileName || 'Audio Track'})</span>
        </a>

        {/* Post-convert Actions & Tag Editor Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
          <button
            id="convert-another-btn"
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 py-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Convert Another Video</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowTagEditor(!showTagEditor)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 py-1"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>{showTagEditor ? 'Hide Tag Editor' : 'Edit Tags & Metadata'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTagEditor ? 'rotate-180' : ''}`} />
            </button>

            <button
              id="copy-download-link-btn"
              type="button"
              onClick={handleCopyStreamLink}
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>{copiedLink ? 'Link Copied!' : 'Copy Direct Link'}</span>
            </button>
          </div>
        </div>

        {/* Tag save feedback alert */}
        {tagSaveSuccess && (
          <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{tagSaveSuccess}</span>
          </div>
        )}

        {/* Expandable Post-Conversion Tag Editor */}
        {showTagEditor && (
          <div className="pt-2">
            <TagEditor
              initialTags={job.tags || {
                title: job.title,
                artist: job.author,
                album: job.title,
                albumArtist: job.author,
                year: '',
                genre: 'Music',
                trackNumber: '1',
                coverUrl: job.thumbnail,
                cleanDescription: true,
                comment: 'YouTube to Music Converter'
              }}
              defaultVideoTitle={job.title}
              defaultArtist={job.author}
              defaultThumbnail={job.thumbnail}
              onChange={() => {}}
              onSaveToFile={handleApplyTagsToFile}
              isSavingToFile={isSavingTags}
              mode="post-convert"
            />
          </div>
        )}
      </div>

      {/* Built-in Audio Preview Player */}
      <AudioPlayer job={job} />
    </section>
  );
};

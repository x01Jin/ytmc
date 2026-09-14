import { AlertTriangle, CheckCircle, Clock, ExternalLink, ShieldCheck, User } from 'lucide-react';
import React from 'react';
import { VideoMetadata } from '../types';

interface VideoCardProps {
  metadata: VideoMetadata;
  onOpenCookiesModal: () => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({ metadata, onOpenCookiesModal }) => {
  return (
    <article id="video-preview-card" className="w-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 shadow-sm transition-colors">
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Thumbnail with overlay duration */}
        <div className="relative shrink-0 w-full sm:w-48 aspect-video rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
          <img
            id="video-thumbnail-img"
            src={metadata.thumbnail}
            alt={metadata.title}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          {metadata.duration && (
            <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-[11px] font-medium tracking-wide flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{metadata.duration}</span>
            </div>
          )}
        </div>

        {/* Video metadata information */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div>
            <h2 id="video-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-2 leading-snug">
              {metadata.title}
            </h2>
            
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              <span className="flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
                <User className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500" />
                {metadata.author}
              </span>

              {metadata.viewCount !== undefined && (
                <span className="text-zinc-500 dark:text-zinc-400">
                  {metadata.viewCount.toLocaleString()} views
                </span>
              )}

              <a
                id="view-on-youtube-link"
                href={`https://www.youtube.com/watch?v=${metadata.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:underline"
              >
                <span>YouTube</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Status indicators and Native Stream Spec */}
          <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
            {metadata.botVerificationRequired ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs w-full">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="flex-1 flex flex-wrap items-center justify-between gap-2">
                  <span>YouTube session authentication recommended for this track.</span>
                  <button
                    id="video-card-cookie-btn"
                    type="button"
                    onClick={onOpenCookiesModal}
                    className="font-semibold underline hover:text-amber-900 dark:hover:text-amber-200"
                  >
                    Configure Session Cookies
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 w-full justify-between">
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 rounded-md">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Native Audio: {metadata.bestNativeStream?.note || 'Opus ~160 kbps (48kHz)'}</span>
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                  Direct streamcopy ready (0% transcoding loss)
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};

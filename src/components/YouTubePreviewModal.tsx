import { X } from 'lucide-react';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { YouTubeSearchResult } from '../types';

interface YouTubePreviewModalProps {
  result: YouTubeSearchResult;
  onClose: () => void;
}

export function YouTubePreviewModal({ result, onClose }: YouTubePreviewModalProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const embedUrl = `https://www.youtube-nocookie.com/embed/${result.id}?autoplay=1&rel=0`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        id="youtube-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Video preview: ${result.title}`}
        className="px-panel w-full max-w-3xl p-2"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{result.title}</p>
            <p className="px-tabular truncate text-xs text-px-dim" translate="no">
              {result.author}
              {result.duration ? ` • ${result.duration}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="px-btn shrink-0 !px-2 !py-1 text-xs"
            onClick={onClose}
            aria-label="Close video preview"
            autoFocus
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-2 aspect-video w-full overflow-hidden bg-px-bg">
          <iframe
            src={embedUrl}
            title={result.title}
            className="h-full w-full"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

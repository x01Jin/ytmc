import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { updateActions } from '../hooks/useUpdater';
import type { ReleaseNotesResult } from '../types/electron';

interface ReleaseNotesModalProps {
  version: string;
  onClose: () => void;
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

export function ReleaseNotesModal({ version, onClose }: ReleaseNotesModalProps) {
  const [result, setResult] = useState<ReleaseNotesResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    void updateActions.getReleaseNotes().then(next => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        id="release-notes-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Release notes for version ${version}`}
        className="px-panel w-full max-w-3xl p-2"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Release notes</p>
            <p className="px-tabular text-xs text-px-dim">Version {version}</p>
          </div>
          <button
            type="button"
            className="px-btn shrink-0 !px-2 !py-1 text-xs"
            onClick={onClose}
            aria-label="Close release notes"
            autoFocus
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div
          className="mt-2 max-h-[70vh] overflow-y-auto overscroll-contain border-2 border-px-line p-2"
          aria-live="polite"
          aria-busy={result === null}
        >
          {result === null && <p className="text-sm text-px-dim">Loading release notes…</p>}
          {result?.status === 'ok' &&
            (result.notes ? (
              <div className="px-markdown">
                <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                  {result.notes}
                </Markdown>
              </div>
            ) : (
              <p className="text-sm text-px-dim">This release has no notes.</p>
            ))}
          {result?.status === 'missing' && (
            <p className="text-sm text-px-dim">
              Release notes for version <span className="px-tabular">{version}</span> are not
              published.
            </p>
          )}
          {result?.status === 'error' && (
            <div className="space-y-2" role="alert">
              <p className="text-sm text-px-err">{result.message}</p>
              <button
                type="button"
                className="px-btn text-sm"
                onClick={() => setAttempt(value => value + 1)}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

import { useState } from 'react';
import { updateActions, useUpdater } from '../hooks/useUpdater';

const DISMISS_KEY = 'ytmc.updateNoticeDismissed';

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function UpdateNotice() {
  const state = useUpdater();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!state) return null;
  if (state.phase !== 'available' && state.phase !== 'ready') return null;
  const version = state.latestVersion ?? '';
  if (dismissed === version) return null;

  const dismiss = () => {
    setDismissed(version);
    try {
      localStorage.setItem(DISMISS_KEY, version);
    } catch {}
  };

  const ready = state.phase === 'ready';

  return (
    <section
      className="px-panel flex flex-wrap items-center gap-2 p-2"
      aria-label="Update available"
    >
      <span className="text-sm text-px-acc" aria-live="polite">
        Version <span className="px-tabular">{version}</span>{' '}
        {ready ? 'is ready to install.' : 'is available.'}
      </span>
      <button
        type="button"
        className="px-btn px-btn-primary text-sm"
        onClick={() => void (ready ? updateActions.apply() : updateActions.download())}
      >
        {ready ? 'Restart and Update' : 'Download'}
      </button>
      <button
        type="button"
        className="px-btn text-sm"
        onClick={() => {
          window.location.hash = '#/settings';
        }}
      >
        Details
      </button>
      <button type="button" className="px-btn text-sm" onClick={dismiss}>
        Dismiss
      </button>
    </section>
  );
}

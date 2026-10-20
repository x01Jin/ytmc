import { useState } from 'react';
import { updateActions, useUpdater } from '../hooks/useUpdater';
import { UpdateProgress } from './UpdateProgress';

const DISMISS_KEY = 'ytmc.updateNoticeDismissed';

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? '';
  } catch {
    return '';
  }
}

function failureText(reason: string): string {
  if (reason === 'swap-failed') {
    return 'The app folder is in use. Close any Explorer window or terminal opened there and retry.';
  }
  if (reason === 'rollback-failed') {
    return 'The previous version could not be restored automatically.';
  }
  return reason.replace(/-/g, ' ');
}

export function UpdateNotice() {
  const state = useUpdater();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!state) return null;

  if (state.phase === 'applying') {
    return (
      <section className="px-panel w-full space-y-1 p-2" aria-label="Installing update">
        <span className="text-sm text-px-acc">
          Installing version <span className="px-tabular">{state.latestVersion ?? ''}</span>
        </span>
        <UpdateProgress progress={state.applyProgress} />
      </section>
    );
  }

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
  const failure =
    state.lastApply && !state.lastApply.ok && state.lastApply.toVersion === version
      ? state.lastApply
      : null;

  return (
    <section
      className="px-panel flex flex-wrap items-center gap-2 p-2"
      aria-label="Update available"
    >
      <span className="text-sm text-px-acc" aria-live="polite">
        Version <span className="px-tabular">{version}</span>{' '}
        {ready ? 'is ready to install.' : 'is available.'}
      </span>
      {failure && (
        <span className="text-sm text-px-warn" role="status">
          The last attempt failed: {failureText(failure.reason)}.
        </span>
      )}
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

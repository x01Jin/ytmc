import { lazy, Suspense, useState } from 'react';
import { useJobs } from '../store/appStore';
import { updateActions, useUpdater } from '../hooks/useUpdater';
import { formatFileSize } from '../utils/format';
import { UpdateProgress } from './UpdateProgress';

const ReleaseNotesModal = lazy(() =>
  import('./ReleaseNotesModal').then(module => ({ default: module.ReleaseNotesModal }))
);

export function UpdatePanel() {
  const state = useUpdater();
  const jobs = useJobs();
  const [notesOpen, setNotesOpen] = useState(false);
  if (!state) return null;

  const converting = jobs.state.isConverting;
  const percent = state.progressPercent ?? 0;
  const busy = state.phase === 'checking' || state.phase === 'applying';

  return (
    <section className="px-panel space-y-2 p-2" aria-label="Updates">
      <h2 className="font-display text-[11px]">UPDATES</h2>
      <p className="text-sm text-px-dim">
        Installed version <span className="px-tabular">{state.currentVersion}</span>
      </p>

      {state.phase === 'unsupported' && (
        <p className="text-sm text-px-dim">
          Automatic updates work in the packaged Windows build only.
        </p>
      )}

      {state.phase === 'checking' && (
        <p className="text-sm text-px-dim" aria-live="polite">
          Checking for updates…
        </p>
      )}

      {state.phase === 'idle' && (
        <p className="text-sm text-px-dim" aria-live="polite">
          No update check has run yet.
        </p>
      )}

      {state.phase === 'up-to-date' && (
        <p className="text-sm text-px-ok" aria-live="polite">
          Up to date
          {state.lastCheckedAt
            ? `, last checked ${new Date(state.lastCheckedAt).toLocaleTimeString()}`
            : ''}
          .
        </p>
      )}

      {state.phase === 'blocked' && (
        <>
          <p className="text-sm text-px-warn" aria-live="polite">
            Automatic updates are unavailable on this setup.
          </p>
          {state.errorMessage && <p className="text-sm text-px-dim">{state.errorMessage}</p>}
        </>
      )}

      {state.phase === 'error' && (
        <p className="text-sm text-px-err" role="alert">
          {state.errorMessage ?? 'The update check failed.'}
        </p>
      )}

      {state.phase === 'available' && (
        <p className="text-sm text-px-acc" aria-live="polite">
          Version <span className="px-tabular">{state.latestVersion}</span> is available
          {state.archiveBytes ? ` (${formatFileSize(state.archiveBytes)})` : ''}.
        </p>
      )}

      {state.phase === 'downloading' && (
        <>
          <p className="text-sm text-px-dim" aria-live="polite">
            Downloading version <span className="px-tabular">{state.latestVersion}</span>,{' '}
            {formatFileSize(state.receivedBytes)}
            {state.archiveBytes ? ` of ${formatFileSize(state.archiveBytes)}` : ''}.
          </p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 w-full border-2 border-px-dim/40"
          >
            <div className="h-full bg-[#7c5cff]" style={{ width: `${percent}%` }} />
          </div>
        </>
      )}

      {state.phase === 'ready' && (
        <>
          <p className="text-sm text-px-ok" aria-live="polite">
            Version <span className="px-tabular">{state.latestVersion}</span> is downloaded and
            verified.
          </p>
          {converting ? (
            <p className="text-sm text-px-dim">
              Wait for the active conversion to finish before restarting.
            </p>
          ) : (
            <p className="text-sm text-px-dim">
              The app closes, installs the update, and reopens on the new version.
            </p>
          )}
        </>
      )}

      {state.phase === 'applying' && (
        <>
          <p className="text-sm text-px-dim" aria-live="polite">
            Installing version <span className="px-tabular">{state.latestVersion}</span>.
          </p>
          <UpdateProgress progress={state.applyProgress} />
        </>
      )}

      {state.phase === 'ready' && state.errorCode && state.errorMessage && (
        <p className="text-sm text-px-warn" role="status">
          {state.errorMessage}
        </p>
      )}

      {state.lastApply && !state.lastApply.ok && (
        <div className="space-y-1" role="status">
          <p className="text-sm text-px-warn">
            The update to <span className="px-tabular">{state.lastApply.toVersion}</span> failed (
            {state.lastApply.reason}).
          </p>
          {state.lastApply.detail && (
            <p className="text-sm break-words text-px-dim">{state.lastApply.detail}</p>
          )}
          <p className="text-sm text-px-dim">
            {state.lastApply.restored === false
              ? 'The previous version could not be restored automatically.'
              : 'The previous version is still available.'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(state.phase === 'idle' ||
          state.phase === 'up-to-date' ||
          state.phase === 'error' ||
          state.phase === 'available') && (
          <button
            type="button"
            className="px-btn text-sm"
            disabled={busy}
            onClick={() => void updateActions.check()}
          >
            {state.phase === 'error' || state.phase === 'available'
              ? 'Check Again'
              : 'Check for Updates'}
          </button>
        )}
        {state.phase === 'available' && (
          <button
            type="button"
            className="px-btn px-btn-primary text-sm"
            disabled={!state.canDownload}
            onClick={() => void updateActions.download()}
          >
            Download Update
          </button>
        )}
        {state.phase === 'downloading' && (
          <button
            type="button"
            className="px-btn text-sm"
            onClick={() => void updateActions.cancelDownload()}
          >
            Cancel Download
          </button>
        )}
        {state.phase === 'ready' && (
          <button
            type="button"
            className="px-btn px-btn-primary text-sm"
            disabled={converting || !state.canApply}
            onClick={() => void updateActions.apply()}
          >
            Restart and Update
          </button>
        )}
        {state.releaseUrl && (
          <button
            type="button"
            className="px-btn text-sm"
            onClick={() => void updateActions.openRelease()}
          >
            View Release
          </button>
        )}
        <button
          type="button"
          className="px-btn text-sm"
          onClick={() => setNotesOpen(true)}
          aria-haspopup="dialog"
        >
          Release Notes
        </button>
      </div>

      {notesOpen && (
        <Suspense fallback={null}>
          <ReleaseNotesModal version={state.currentVersion} onClose={() => setNotesOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}

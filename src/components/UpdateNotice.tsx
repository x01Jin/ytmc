import { CircleArrowUp } from 'lucide-react';
import { useUpdater } from '../hooks/useUpdater';

export function UpdateNotice() {
  const state = useUpdater();
  if (
    !state ||
    (state.phase !== 'available' && state.phase !== 'ready' && state.phase !== 'applying')
  ) {
    return null;
  }

  const version = state.latestVersion ?? '';
  let label = 'Update';
  let title = `Version ${version} is available. Open Settings to update.`;
  if (state.phase === 'ready') {
    label = 'Update ready';
    title = `Version ${version} is ready to install. Open Settings to update.`;
  } else if (state.phase === 'applying') {
    label = 'Installing…';
    title = `Installing version ${version}. Open Settings for progress.`;
  }

  return (
    <button
      type="button"
      className="px-btn px-btn-primary flex items-center gap-1 !px-2 !py-1 text-xs"
      title={title}
      aria-label={title}
      onClick={() => {
        window.location.hash = '#/settings';
      }}
    >
      <CircleArrowUp className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

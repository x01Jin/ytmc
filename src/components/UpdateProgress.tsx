import type { ApplyProgress } from '../types/electron';

const PHASE_LABELS: Record<string, string> = {
  preparing: 'Preparing',
  start: 'Preparing',
  verifying: 'Verifying the update',
  extracting: 'Unpacking the update',
  validating: 'Checking the files',
  'pre-swap': 'Preparing to restart',
  copying: 'Keeping your settings',
  installing: 'Installing',
  launched: 'Opening the new version',
  'boot-ok': 'Finishing',
  restarting: 'Restarting',
  cancelling: 'Cancelling',
};

function applyPhaseLabel(phase: string | undefined): string {
  return phase ? (PHASE_LABELS[phase] ?? 'Installing') : 'Installing';
}

export function UpdateProgress({ progress }: { progress: ApplyProgress | null }) {
  const percent = progress?.percent ?? null;
  return (
    <div className="w-full space-y-1" aria-live="polite">
      <p className="text-sm text-px-dim">
        {applyPhaseLabel(progress?.phase)}
        {percent !== null ? ` ${percent}%` : '…'}
      </p>
      <div
        role="progressbar"
        aria-label="Update progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-2 w-full border-2 border-px-dim/40"
      >
        <div
          className={
            percent === null ? 'h-full w-1/2 animate-pulse bg-[#7c5cff]' : 'h-full bg-[#7c5cff]'
          }
          style={percent !== null ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}

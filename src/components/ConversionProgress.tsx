import { AlertCircle, CheckCircle2, Cookie, Loader2, RotateCw } from 'lucide-react';
import React from 'react';
import { ConversionJob } from '../types';

interface ConversionProgressProps {
  job: ConversionJob;
  onRetry: () => void;
  onOpenCookiesModal: () => void;
}

export const ConversionProgress: React.FC<ConversionProgressProps> = ({
  job,
  onRetry,
  onOpenCookiesModal
}) => {
  const isError = job.status === 'error';
  const isCompleted = job.status === 'completed';
  const isBotBlocked = job.isBotBlocked || /sign in to confirm|not a bot|bot|login_required|cookies-from-browser|403/i.test(job.error || '');

  return (
    <section id="conversion-progress-section" className="w-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-sm space-y-4 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isError ? (
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          ) : isCompleted ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Loader2 className="w-5 h-5 text-rose-600 dark:text-rose-400 animate-spin" />
          )}
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {isError ? 'Conversion Halted' : isCompleted ? 'Conversion Ready!' : 'Converting Audio...'}
          </h3>
        </div>
        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{job.progress}%</span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          id="conversion-progress-bar"
          className={`h-full transition-all duration-300 ease-out rounded-full ${
            isError ? 'bg-rose-500' : isCompleted ? 'bg-emerald-500' : 'bg-rose-600'
          }`}
          style={{ width: `${Math.max(4, job.progress)}%` }}
        />
      </div>

      {/* Stage status description */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-600 dark:text-zinc-400 font-medium">{job.stageMessage || 'Processing track...'}</span>
        <span className="text-zinc-400 dark:text-zinc-500 uppercase font-semibold">
          {job.format.toUpperCase()} • {job.bitrate}
        </span>
      </div>

      {/* Error / Bot Block Alert Details */}
      {isError && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-900 dark:text-rose-200 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-sm text-rose-950 dark:text-rose-100">
                {isBotBlocked ? 'YouTube Sign-in Verification Required' : 'Conversion Could Not Complete'}
              </p>
              <p className="text-rose-800 dark:text-rose-300 leading-relaxed">
                {job.error || 'Audio conversion failed. Please try another track or format.'}
              </p>
            </div>
          </div>

          {isBotBlocked ? (
            <div className="p-3 rounded-lg bg-white/80 dark:bg-zinc-900/80 border border-rose-200/80 dark:border-rose-900/80 space-y-2.5">
              <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                YouTube requires user session authentication or browser cookies for this track in cloud environments.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  id="error-configure-cookies-btn"
                  type="button"
                  onClick={onOpenCookiesModal}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-all shadow-xs"
                >
                  <Cookie className="w-4 h-4" />
                  <span>Open Session & Cookie Settings</span>
                </button>
                <button
                  id="retry-conversion-btn"
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold transition-colors"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Retry Conversion</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-1 flex items-center gap-3">
              <button
                id="retry-conversion-btn"
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

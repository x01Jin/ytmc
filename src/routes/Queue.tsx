import { AlertCircle } from 'lucide-react';
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ConversionProgress } from '../components/ConversionProgress';
import { useConvertDraft, useJobs, useLibrary, useSession } from '../store/appStore';
import { ApiClient } from '../services/apiClient';

const CookieModal = lazy(() =>
  import('../components/CookieModal').then(m => ({ default: m.CookieModal }))
);

export function QueueRoute() {
  const { state: jobs, actions: jobActions } = useJobs();
  const { state: session, actions: sessionActions } = useSession();
  const { state: draft } = useConvertDraft();
  const { actions: libraryActions } = useLibrary();
  const { activeJob } = jobs;
  const [isCookieModalOpen, setIsCookieModalOpen] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const completedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeJob?.status !== 'completed' || completedIdRef.current === activeJob.id) return;
    completedIdRef.current = activeJob.id;
    void jobActions.refreshRecent();
    void libraryActions.refresh().catch(() => {});
    jobActions.resetActive();
  }, [activeJob, jobActions, libraryActions]);

  const handleRetry = async () => {
    if (!activeJob) return;
    setRetryError(null);
    try {
      await jobActions.startConversion(ApiClient.youTubeWatchUrl(activeJob.videoId), draft.options);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Could not restart the conversion.');
    }
  };

  return (
    <div className="space-y-2">
      {retryError && (
        <div
          role="alert"
          className="px-panel flex items-start gap-2 border-px-err p-2 text-xs sm:text-sm"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-px-err" aria-hidden="true" />
          <p className="flex-1">{retryError}</p>
        </div>
      )}

      {activeJob ? (
        <ConversionProgress
          job={activeJob}
          onRetry={() => void handleRetry()}
          onOpenCookiesModal={() => setIsCookieModalOpen(true)}
        />
      ) : (
        <section className="px-panel p-2 text-center" aria-label="Queue">
          <p className="font-display text-xs">QUEUE EMPTY</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-px-dim">
            Nothing converting right now. Start a conversion and watch it land here.
          </p>
        </section>
      )}

      {isCookieModalOpen && (
        <Suspense fallback={null}>
          <CookieModal
            isOpen={isCookieModalOpen}
            onClose={() => {
              setIsCookieModalOpen(false);
              void sessionActions.refresh();
            }}
            status={session.status}
            onStatusUpdated={next => sessionActions.update(next)}
          />
        </Suspense>
      )}
    </div>
  );
}

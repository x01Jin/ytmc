import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversionOptionsPanel } from "../components/ConversionOptionsPanel";
import { ConversionProgress } from "../components/ConversionProgress";
import { CookieModal } from "../components/CookieModal";
import { UrlInput } from "../components/UrlInput";
import { VideoCard } from "../components/VideoCard";
import { ApiClient } from "../services/apiClient";
import { useConvertDraft, useHistory, useJobs, useLibrary, useSession } from "../store/appStore";
import { canonicalWatchUrl } from "./History";

const SAVE_BANNER_TIMEOUT_MS = 6000;

export function ConvertRoute() {
  const { state: jobs, actions: jobActions } = useJobs();
  const { state: session, actions: sessionActions } = useSession();
  const { state: draft, actions: draftActions } = useConvertDraft();
  const { actions: libraryActions } = useLibrary();
  const { actions: historyActions } = useHistory();
  const { activeJob, isConverting } = jobs;
  const { url, metadata, options, pendingInspectUrl } = draft;
  const { setUrl, setMetadata, setOptions, consumeInspectUrl, resetDraft } =
    draftActions;
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [isCookieModalOpen, setIsCookieModalOpen] = useState(false);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const completedIdRef = useRef<string | null>(null);

  const handleInspectUrl = useCallback(
    async (inputUrl?: string) => {
      const targetUrl = inputUrl || url;
      if (!targetUrl.trim()) return;

      setIsInspecting(true);
      setInspectError(null);
      jobActions.resetActive();

      try {
        const data = await ApiClient.fetchVideoInfo(targetUrl);
        setMetadata(data);
      } catch (err: unknown) {
        setInspectError(
          err instanceof Error
            ? err.message
            : "Failed to load video details. Check the URL and try again.",
        );
        setMetadata(null);
      } finally {
        setIsInspecting(false);
      }
    },
    [url, jobActions, setMetadata],
  );

  const handleStartConversion = useCallback(async () => {
    if (!metadata) return;
    try {
      await jobActions.startConversion(
        canonicalWatchUrl(metadata.id),
        options,
      );
    } catch (err: unknown) {
      setInspectError(
        err instanceof Error
          ? err.message
          : "Failed to start conversion. Try again.",
      );
    }
  }, [metadata, jobActions, options]);

  // Completion handoff: the finished track already lives in the library, so
  // the tab resets to its blank state and reports success briefly.
  useEffect(() => {
    if (
      activeJob?.status !== "completed" ||
      completedIdRef.current === activeJob.id
    )
      return;
    completedIdRef.current = activeJob.id;
    const title = activeJob.title;
    void historyActions.refresh();
    void libraryActions.refresh().catch(() => {});
    jobActions.resetActive();
    resetDraft();
    setInspectError(null);
    setSavedTitle(title);
    const timer = window.setTimeout(
      () => setSavedTitle(null),
      SAVE_BANNER_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeJob, jobActions, historyActions, libraryActions, resetDraft]);

  // Re-convert entry: the History tab queues a URL, Convert pastes and inspects it once.
  useEffect(() => {
    if (!pendingInspectUrl) return;
    const target = pendingInspectUrl;
    consumeInspectUrl();
    setUrl(target);
    void handleInspectUrl(target);
  }, [pendingInspectUrl, consumeInspectUrl, setUrl, handleInspectUrl]);

  return (
    <div className="space-y-3">
      {savedTitle && (
        <div
          role="status"
          className="px-panel fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] items-center gap-3 border-px-ok p-3 text-xs sm:text-sm"
        >
          <CheckCircle2
            className="h-5 w-5 shrink-0 text-px-ok"
            aria-hidden="true"
          />
          <p>
            <span className="font-semibold">Saved to library</span>
            <span className="block truncate text-px-dim">{savedTitle}</span>
          </p>
        </div>
      )}

      <UrlInput
        value={url}
        onChange={(newVal) => {
          setUrl(newVal);
          if (inspectError) setInspectError(null);
        }}
        onSubmit={() => void handleInspectUrl()}
        isLoading={isInspecting}
      />

      {inspectError && (
        <div
          role="alert"
          className="px-panel flex items-start gap-3 border-px-err p-4 text-xs sm:text-sm"
        >
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-px-err"
            aria-hidden="true"
          />
          <div className="flex-1">
            <p className="font-semibold">Unable to load video</p>
            <p className="mt-0.5 text-px-dim">{inspectError}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleInspectUrl()}
            className="px-btn shrink-0 !py-1 text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {metadata && (
        <VideoCard
          metadata={metadata}
          onOpenCookiesModal={() => setIsCookieModalOpen(true)}
        />
      )}

      {activeJob ? (
        <ConversionProgress
          job={activeJob}
          onRetry={handleStartConversion}
          onOpenCookiesModal={() => setIsCookieModalOpen(true)}
        />
      ) : (
        metadata && (
          <ConversionOptionsPanel
            options={options}
            onChange={setOptions}
            onConvert={handleStartConversion}
            isConverting={isConverting}
          />
        )
      )}

      <CookieModal
        isOpen={isCookieModalOpen}
        onClose={() => {
          setIsCookieModalOpen(false);
          void sessionActions.refresh();
        }}
        status={session.status}
        onStatusUpdated={(next) => sessionActions.update(next)}
      />
    </div>
  );
}

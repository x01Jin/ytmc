import { Check, FileAudio, Link2, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useConvertDraft, useHistory } from "../store/appStore";

export function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const COPY_CONFIRM_TIMEOUT_MS = 2000;

export function HistoryRoute({ onReconvert }: { onReconvert: () => void }) {
  const { state: history, actions: historyActions } = useHistory();
  const { actions: draftActions } = useConvertDraft();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const entries = history.entries;

  const handleCopyLink = async (jobId: string, videoId: string) => {
    try {
      await navigator.clipboard.writeText(canonicalWatchUrl(videoId));
      setCopiedId(jobId);
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(
        () => setCopiedId(null),
        COPY_CONFIRM_TIMEOUT_MS,
      );
    } catch {
      setCopiedId(null);
    }
  };

  const handleReconvert = (videoId: string) => {
    const target = canonicalWatchUrl(videoId);
    draftActions.setUrl(target);
    draftActions.queueInspectUrl(target);
    onReconvert();
  };

  if (entries.length === 0) {
    return (
      <section className="px-panel p-6 text-center" aria-label="History">
        <p className="font-display text-xs">NO HISTORY YET</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-px-dim">
          Finished conversions land here with their YouTube link, so a lost file
          can always be converted again.
        </p>
      </section>
    );
  }

  return (
    <section
      className="px-panel w-full space-y-2 p-3"
      aria-label="Conversion history"
    >
      <div className="flex items-center justify-between border-b-2 border-px-line pb-2">
        <h3 className="font-display text-[10px]">HISTORY</h3>
        <span className="flex items-center gap-2">
          <span className="px-tabular text-xs text-px-dim">
            {entries.length} tracks
          </span>
          <button
            type="button"
            className={`px-btn shrink-0 !px-2 !py-1 text-xs ${
              confirmClear ? "!border-px-err !text-px-err" : ""
            }`}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              setConfirmClear(false);
              void historyActions.clear().catch(() => {});
            }}
            onBlur={() => setConfirmClear(false)}
            title={confirmClear ? "Click again to confirm" : "Clear history"}
            aria-label={
              confirmClear ? "Confirm clear history" : "Clear history"
            }
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {confirmClear ? "Confirm" : "Clear"}
          </button>
        </span>
      </div>

      <div className="divide-y divide-px-line">
        {entries.map((entry) => (
          <div
            key={entry.jobId}
            id={`history-item-${entry.jobId}`}
            className="px-row flex items-center gap-3 py-2.5"
          >
            <span className="h-10 w-10 shrink-0 overflow-hidden border-2 border-px-line bg-px-bg">
              {entry.thumbnail ? (
                <img
                  src={entry.thumbnail}
                  alt=""
                  width={40}
                  height={40}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="px-pixelated h-full w-full object-cover"
                />
              ) : (
                <FileAudio
                  className="h-full w-full p-2 text-px-dim"
                  aria-hidden="true"
                />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">
                {entry.title}
              </span>
              <span className="block truncate text-[11px] text-px-dim">
                {entry.author}
              </span>
            </span>

            <button
              type="button"
              className="px-btn shrink-0 !p-2"
              onClick={() => void handleCopyLink(entry.jobId, entry.videoId)}
              title="Copy YouTube link"
              aria-label={
                copiedId === entry.jobId
                  ? "Link copied"
                  : `Copy YouTube link for ${entry.title}`
              }
            >
              {copiedId === entry.jobId ? (
                <Check className="h-4 w-4 text-px-ok" aria-hidden="true" />
              ) : (
                <Link2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="px-btn shrink-0 !p-2"
              onClick={() => handleReconvert(entry.videoId)}
              title="Convert again"
              aria-label={`Convert ${entry.title} again`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="px-btn shrink-0 !p-2"
              onClick={() => void historyActions.removeEntry(entry.jobId)}
              title="Remove from history"
              aria-label={`Remove ${entry.title} from history`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

import { Loader2, Scissors } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../../services/apiClient";
import { formatSeconds, parseTimeToSeconds } from "../../utils/time";
import { useEditPanel } from "./LibraryEditPanel";

/**
 * Trimmer pane: preview the track, pick start/end, loop the selection,
 * then overwrite the file. Destructive apply requires explicit confirmation.
 */
export function TrimPane() {
  const { record, onEdited } = useEditPanel();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startRef = useRef<HTMLInputElement | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [loopSelection, setLoopSelection] = useState(true);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isProbing, setIsProbing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmArmed, setConfirmArmed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsProbing(true);
    ApiClient.probeLibraryFile(record.jobId)
      .then((probe) => {
        if (!cancelled) setDuration(probe.durationSeconds);
      })
      .catch(() => {
        if (!cancelled) setDuration(null);
      })
      .finally(() => {
        if (!cancelled) setIsProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [record.jobId]);

  const parsedStart = start.trim() ? parseTimeToSeconds(start) : 0;
  const parsedEnd = end.trim() ? parseTimeToSeconds(end) : duration;
  const selectionValid =
    parsedStart !== null &&
    (end.trim() === "" || parsedEnd !== null) &&
    (parsedEnd === null || parsedStart < parsedEnd) &&
    (duration === null || parsedStart < duration) &&
    (parsedEnd === null || duration === null || parsedEnd <= duration);
  const startSecs = parsedStart ?? 0;
  const endSecs = parsedEnd;

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setPosition(audio.currentTime);
    if (loopSelection && endSecs !== null && audio.currentTime >= endSecs) {
      audio.currentTime = startSecs;
    }
  };

  const seekTo = (secs: number | null) => {
    const audio = audioRef.current;
    if (!audio || secs === null) return;
    audio.currentTime = Math.max(0, secs);
    void audio.play().catch(() => {});
  };

  const setFromPosition = (which: "start" | "end") => {
    const value = formatSeconds(position);
    if (which === "start") setStart(value);
    else setEnd(value);
    setFieldError(null);
    setConfirmArmed(false);
  };

  const handleApply = async () => {
    if (!selectionValid) {
      setFieldError(
        "Check the trim bounds: start must be before end and inside the track.",
      );
      startRef.current?.focus();
      return;
    }
    if (!start.trim() && !end.trim()) {
      setFieldError("Enter a start or end time to trim.");
      startRef.current?.focus();
      return;
    }
    if (!confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    setIsSaving(true);
    setStatus(null);
    try {
      await ApiClient.trimLibraryFile(
        record.jobId,
        start.trim() || "0",
        end.trim(),
      );
      setStatus("Trim applied. The file was overwritten.");
      setConfirmArmed(false);
      onEdited();
    } catch (err) {
      setFieldError(
        err instanceof Error ? err.message : "Could not trim the audio file.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <audio
        ref={audioRef}
        src={`/api/stream/${record.jobId}`}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) {
            setDuration((prev) => prev ?? d);
          }
        }}
        controls
        className="w-full"
        aria-label={`Preview ${record.title}`}
      />

      <div
        className="px-tabular flex justify-between text-[11px] text-px-dim"
        aria-live="off"
      >
        <span>Position {formatSeconds(position)}</span>
        <span>
          {isProbing
            ? "Reading duration…"
            : duration !== null
              ? `Length ${formatSeconds(duration)}`
              : "Length unknown"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`trim-start-${record.jobId}`}
            className="mb-1 block text-xs font-semibold text-px-text"
          >
            Start <span className="font-normal text-px-dim">(e.g. 0:15)</span>
          </label>
          <div className="flex gap-1.5">
            <input
              ref={startRef}
              id={`trim-start-${record.jobId}`}
              name={`trim-start-${record.jobId}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setFieldError(null);
                setConfirmArmed(false);
              }}
              placeholder="0:00…"
              className="px-input min-w-0 flex-1 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => seekTo(parseTimeToSeconds(start))}
              className="px-btn shrink-0 !px-2 !py-1 text-xs"
              aria-label="Preview from start time"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={() => setFromPosition("start")}
              className="px-btn shrink-0 !px-2 !py-1 text-xs"
              title="Use current playback position as start"
            >
              Set
            </button>
          </div>
        </div>
        <div>
          <label
            htmlFor={`trim-end-${record.jobId}`}
            className="mb-1 block text-xs font-semibold text-px-text"
          >
            End{" "}
            <span className="font-normal text-px-dim">
              (blank = keep to end)
            </span>
          </label>
          <div className="flex gap-1.5">
            <input
              id={`trim-end-${record.jobId}`}
              name={`trim-end-${record.jobId}`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setFieldError(null);
                setConfirmArmed(false);
              }}
              placeholder="2:45…"
              className="px-input min-w-0 flex-1 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() =>
                seekTo(end.trim() ? parseTimeToSeconds(end) : duration)
              }
              className="px-btn shrink-0 !px-2 !py-1 text-xs"
              aria-label="Preview from end time"
            >
              ▶
            </button>
            <button
              type="button"
              onClick={() => setFromPosition("end")}
              className="px-btn shrink-0 !px-2 !py-1 text-xs"
              title="Use current playback position as end"
            >
              Set
            </button>
          </div>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-px-dim">
        <input
          type="checkbox"
          checked={loopSelection}
          onChange={(e) => setLoopSelection(e.target.checked)}
          className="h-4 w-4 accent-[#7c5cff]"
        />
        <span>Loop the selected region during preview</span>
      </label>

      {fieldError && (
        <p
          role="alert"
          className="border-2 border-px-err bg-px-bg p-2 text-xs text-px-err"
        >
          {fieldError}
        </p>
      )}
      {status && (
        <p
          role="status"
          aria-live="polite"
          className="border-2 border-px-ok bg-px-bg p-2 text-xs text-px-ok"
        >
          {status}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleApply()}
        disabled={isSaving}
        className={`px-btn flex w-full items-center justify-center gap-2 !py-2.5 text-sm font-bold ${
          confirmArmed ? "!border-px-err !bg-px-err !text-[#0b0b12]" : ""
        }`}
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span aria-live="polite">Trimming…</span>
          </>
        ) : (
          <>
            <Scissors className="h-4 w-4" aria-hidden="true" />
            <span>
              {confirmArmed
                ? "Confirm trim — this overwrites the file"
                : "Apply trim"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

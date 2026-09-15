import { startTransition, useEffect, useRef } from "react";
import { ApiClient } from "../services/apiClient";
import type { ConversionJob } from "../types";

const POLL_INTERVAL_MS = 1000;
const BACKOFF_AFTER_FAILURES = 3;
const BACKOFF_INTERVAL_MS = 3000;

interface PollCallbacks {
  onUpdate: (job: ConversionJob) => void;
  onDone?: (job: ConversionJob) => void;
}

/**
 * Polls a conversion job until it completes or fails. State updates ride
 * inside startTransition so progress ticks never block typing or playback.
 * Interval backs off from 1s to 3s after repeated network failures.
 */
export function useJobPolling(
  jobId: string | null,
  status: string | undefined,
  { onUpdate, onDone }: PollCallbacks,
) {
  const callbacksRef = useRef({ onUpdate, onDone });
  callbacksRef.current = { onUpdate, onDone };

  useEffect(() => {
    if (!jobId) return;
    if (status === "completed" || status === "error") return;

    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped) return;
      try {
        const updated = await ApiClient.getJobStatus(jobId);
        failures = 0;
        startTransition(() => callbacksRef.current.onUpdate(updated));
        if (updated.status === "completed" || updated.status === "error") {
          startTransition(() => callbacksRef.current.onDone?.(updated));
          return;
        }
      } catch {
        failures += 1;
      }
      if (!stopped) {
        const delay =
          failures >= BACKOFF_AFTER_FAILURES
            ? BACKOFF_INTERVAL_MS
            : POLL_INTERVAL_MS;
        timer = setTimeout(tick, delay);
      }
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, status]);
}

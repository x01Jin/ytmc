import { startTransition, useCallback, useEffect, useRef } from "react";
import { ApiClient } from "../services/apiClient";
import { ConversionJob } from "../types";

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
        const delay = failures >= 3 ? 3000 : 1000;
        timer = setTimeout(tick, delay);
      }
    };

    timer = setTimeout(tick, 1000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, status]);
}

export function useMountEffect(effect: () => void | (() => void)) {
  const runRef = useRef(effect);
  runRef.current = effect;
  useEffect(() => runRef.current(), []);
}

export function useStableCallback<T extends (...args: never[]) => unknown>(
  fn: T,
): T {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback(((...args: never[]) => fnRef.current(...args)) as T, []);
}

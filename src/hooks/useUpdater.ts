import { useSyncExternalStore } from 'react';
import type { UpdateState } from '../types/electron';

let snapshot: UpdateState | null = null;
const listeners = new Set<() => void>();
let started = false;

const applyState = (next: UpdateState): void => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const start = (): void => {
  if (started) return;
  const bridge = window.updates;
  if (!bridge) return;
  started = true;
  bridge.onState(applyState);
  void bridge
    .getState()
    .then(applyState)
    .catch(error => console.error('updates:get-state failed', error));
  void bridge
    .notifyRendererReady()
    .catch(error => console.error('updates:renderer-ready failed', error));
};

const subscribe = (listener: () => void): (() => void) => {
  if (!window.updates) return () => {};
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): UpdateState | null => snapshot;

export function useUpdater(): UpdateState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const updateActions = {
  check: () => window.updates?.check(),
  download: () => window.updates?.download(),
  cancelDownload: () => window.updates?.cancelDownload(),
  apply: () => window.updates?.apply(),
  openRelease: () => window.updates?.openRelease(),
  revealLog: () => window.updates?.revealLog(),
};

import fs from 'fs';
import { BGUTIL_PATH, POT_PORT } from '../config.js';

/**
 * Single choke point for every PO-Token sidecar decision.
 *
 * Strategy (empirically grounded, Sep 2026):
 * - Sidecar installed AND reachable  -> `pot` mode: pass the bgutil-http
 *   extractor args and NO cookies (anonymous PO tokens do not validate
 *   against cookie sessions server-side).
 * - Otherwise                       -> `fallback` mode: no POT args, pass
 *   cookies when present, and pin a no-POT player-client cascade
 *   (`default,web_embedded,android_vr`) so strictly-checked clients are
 *   never the error surface.
 */
export type PotStrategy = 'pot' | 'fallback';

export function potBaseUrl(): string {
  return `http://127.0.0.1:${POT_PORT}`;
}

export function isSidecarInstalled(): boolean {
  try {
    return fs.existsSync(BGUTIL_PATH);
  } catch {
    return false;
  }
}

let lastReachable: boolean | null = null;
let lastCheckedAt = 0;
const PING_TTL_MS = 60_000;

/** Live `/ping` check against the sidecar (cached for 60s). */
export async function refreshSidecarReachability(): Promise<boolean> {
  if (!isSidecarInstalled()) {
    lastReachable = false;
    lastCheckedAt = Date.now();
    return false;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(`${potBaseUrl()}/ping`, { signal: ctrl.signal });
      lastReachable = res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    lastReachable = false;
  }
  lastCheckedAt = Date.now();
  return lastReachable;
}

/** Cached reachability; use after boot/`refreshSidecarReachability()`. */
export function isSidecarReachableCached(): boolean | null {
  if (lastReachable === null) return null;
  if (Date.now() - lastCheckedAt > PING_TTL_MS) return lastReachable;
  return lastReachable;
}

/** Resolve the current strategy (awaits a fresh ping when stale/unknown). */
export async function resolveStrategy(): Promise<{ strategy: PotStrategy; reachable: boolean }> {
  const reachable = await refreshSidecarReachability();
  return { strategy: reachable ? 'pot' : 'fallback', reachable };
}

/** Extractor args for the given strategy. */
export function extractorArgsFor(strategy: PotStrategy): string[] {
  if (strategy === 'pot') {
    return ['--extractor-args', `youtubepot-bgutilhttp:base_url=${potBaseUrl()}`];
  }
  return ['--extractor-args', 'youtube:player_client=default,web_embedded,android_vr'];
}

/**
 * Whether `--cookies` may accompany a request under this strategy.
 * In `pot` mode cookies are omitted (anonymous token + session mismatch).
 */
export function cookiesAllowed(strategy: PotStrategy, hasCookies: boolean): boolean {
  return strategy === 'fallback' && hasCookies;
}

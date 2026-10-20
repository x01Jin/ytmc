import fs from 'fs';
import { BGUTIL_PATH, POT_PORT } from '../config.js';

export type PotStrategy = 'pot' | 'fallback';

const REACHABILITY_TTL_MS = 15_000;
let reachability: { reachable: boolean; at: number } | null = null;

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

export async function refreshSidecarReachability(): Promise<boolean> {
  if (!isSidecarInstalled()) {
    reachability = { reachable: false, at: Date.now() };
    return false;
  }
  if (reachability && Date.now() - reachability.at < REACHABILITY_TTL_MS) {
    return reachability.reachable;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(`${potBaseUrl()}/ping`, { signal: ctrl.signal });
      reachability = { reachable: res.ok, at: Date.now() };
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    reachability = { reachable: false, at: Date.now() };
    return false;
  }
}

export async function resolveStrategy(): Promise<{
  strategy: PotStrategy;
  reachable: boolean;
}> {
  const reachable = await refreshSidecarReachability();
  return { strategy: reachable ? 'pot' : 'fallback', reachable };
}

export function extractorArgsFor(strategy: PotStrategy): string[] {
  if (strategy === 'pot') {
    return ['--extractor-args', `youtubepot-bgutilhttp:base_url=${potBaseUrl()}`];
  }
  return ['--extractor-args', 'youtube:player_client=default,web_embedded,android_vr'];
}

export function cookiesAllowed(strategy: PotStrategy, hasCookies: boolean): boolean {
  return strategy === 'fallback' && hasCookies;
}

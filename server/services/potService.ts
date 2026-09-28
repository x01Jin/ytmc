import fs from 'fs';
import { BGUTIL_PATH, POT_PORT } from '../config.js';

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

export async function refreshSidecarReachability(): Promise<boolean> {
  if (!isSidecarInstalled()) {
    return false;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(`${potBaseUrl()}/ping`, { signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
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

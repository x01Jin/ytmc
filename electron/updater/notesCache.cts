import { readJson, writeJson } from './install.cjs';

interface CachedReleaseNotes {
  version: string;
  notes: string;
}

export function readCachedReleaseNotes(filePath: string, version: string): string | null {
  const cached = readJson<Partial<CachedReleaseNotes>>(filePath);
  if (cached?.version !== version || typeof cached.notes !== 'string') return null;
  return cached.notes;
}

export function writeCachedReleaseNotes(filePath: string, version: string, notes: string): void {
  const cached: CachedReleaseNotes = { version, notes };
  writeJson(filePath, cached);
}

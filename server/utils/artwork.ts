import fs from 'fs';

export function buildArtworkUrl(jobId: string, filePath: string): string {
  let version = '0';
  try {
    version = String(Math.floor(fs.statSync(filePath).mtimeMs));
  } catch {}
  return `/api/library/${encodeURIComponent(jobId)}/artwork?v=${encodeURIComponent(version)}`;
}

export function isRemoteArtworkUrl(value: string | undefined): boolean {
  return !!value && /^https?:\/\//i.test(value);
}

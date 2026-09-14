import fs from 'fs';
import path from 'path';

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

export function sanitizeSegment(name: string, maxLength = 100): string {
  let clean = name
    .replace(ILLEGAL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (RESERVED_NAMES.has(clean.toUpperCase())) {
    clean = `_${clean}`;
  }
  if (!clean) clean = 'Untitled';
  return clean.slice(0, maxLength);
}

export function buildDisplayFileName(artist: string, title: string, ext: string): string {
  const cleanTitle = sanitizeSegment(title);
  const cleanArtist = sanitizeSegment(artist);
  const normalizedExt = ext.replace(/^\./, '').toLowerCase() || 'opus';
  if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase())) {
    return `${cleanTitle}.${normalizedExt}`;
  }
  return `${cleanArtist} - ${cleanTitle}.${normalizedExt}`;
}

export function dedupeFileName(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = fileName;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} - ${String(counter).padStart(2, '0')}${ext}`;
    counter += 1;
  }
  return candidate;
}

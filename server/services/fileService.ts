import fs from 'fs';
import path from 'path';
import { DOWNLOADS_DIR } from '../config.js';
import { SettingsService, WRITE_TEST_FILENAME } from './settingsService.js';

export const AUDIO_EXTENSIONS = new Set(['.opus', '.m4a', '.mp3', '.flac', '.wav', '.ogg', '.aac']);

export interface LibraryFile {
  id: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  mtimeMs: number;
  ext: string;
}

export namespace FileService {
  export function getDownloadsDir(): string {
    const configured = SettingsService.getSettings().downloadsDir;
    return configured && configured.trim() ? configured : DOWNLOADS_DIR;
  }

  export function ensureDownloadsDir(): string {
    const dir = getDownloadsDir();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  export function isInsideLibrary(absolutePath: string): boolean {
    const dir = path.normalize(getDownloadsDir() + path.sep);
    const target = path.normalize(absolutePath);
    return target.startsWith(dir);
  }

  export function scanLibrary(): LibraryFile[] {
    const dir = ensureDownloadsDir();
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const files: LibraryFile[] = [];
    for (const entry of entries) {
      if (entry.endsWith('.part') || entry.endsWith('.ytdl') || entry === WRITE_TEST_FILENAME)
        continue;
      const filePath = path.join(dir, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (!AUDIO_EXTENSIONS.has(path.extname(entry).toLowerCase())) continue;
      files.push({
        id: entry,
        fileName: entry,
        filePath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        ext: path.extname(entry).replace('.', '').toLowerCase(),
      });
    }
    return files.toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  }

  export function sweepPartFiles(): number {
    const dir = ensureDownloadsDir();
    let removed = 0;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return 0;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.part') && !entry.startsWith('temp_')) continue;
      try {
        fs.unlinkSync(path.join(dir, entry));
        removed += 1;
      } catch {}
    }
    return removed;
  }
}

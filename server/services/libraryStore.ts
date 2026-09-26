import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';
import type { MusicTags } from './audioTagService.js';

export interface LibraryRecord {
  jobId: string;
  source?: 'conversion' | 'import';
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  format: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  completedAt: number;
  tags?: MusicTags;
}

const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');
const MAX_RECORDS = 500;

function norm(p: string): string {
  return path.normalize(p);
}

export function isSameFilePath(a: string, b: string): boolean {
  if (process.platform === 'win32') return norm(a).toLowerCase() === norm(b).toLowerCase();
  return norm(a) === norm(b);
}

function readAll(): LibraryRecord[] {
  try {
    if (!fs.existsSync(LIBRARY_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')) as LibraryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(records: LibraryRecord[]): void {
  fs.mkdirSync(path.dirname(LIBRARY_FILE), { recursive: true });
  const tmp = `${LIBRARY_FILE}.${process.pid}.part`;
  fs.writeFileSync(tmp, JSON.stringify(records.slice(0, MAX_RECORDS), null, 2), 'utf8');
  fs.renameSync(tmp, LIBRARY_FILE);
}

function keyOf(p: string): string {
  return process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
}

export namespace LibraryStore {
  export function upsert(record: LibraryRecord): void {
    const records = readAll().filter(
      r => r.jobId !== record.jobId && !isSameFilePath(r.filePath, record.filePath)
    );
    records.unshift(record);
    writeAll(records);
  }

  export function reconcile(): { removed: number } {
    const all = readAll();
    const seen = new Set<string>();
    const sorted = all.toSorted((a, b) => b.completedAt - a.completedAt);
    const kept: LibraryRecord[] = [];
    for (const record of sorted) {
      const key = keyOf(record.filePath);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (!record.filePath || !fs.existsSync(record.filePath)) continue;
      } catch {
        continue;
      }
      kept.push(record);
    }
    const removed = all.length - kept.length;
    if (removed > 0) writeAll(kept);
    return { removed };
  }

  export function list(): LibraryRecord[] {
    return readAll()
      .filter(r => {
        try {
          return !!r.filePath && fs.existsSync(r.filePath);
        } catch {
          return false;
        }
      })
      .toSorted((a, b) => b.completedAt - a.completedAt);
  }

  export function remove(jobId: string): void {
    writeAll(readAll().filter(r => r.jobId !== jobId));
  }
}

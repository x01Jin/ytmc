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
  sourceThumbnail?: string;
  format: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  completedAt: number;
  tags?: MusicTags;
  hasCover?: boolean;
}

const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');

let cache: LibraryRecord[] | null = null;
const byJobId = new Map<string, LibraryRecord>();
const byPath = new Map<string, LibraryRecord>();

function norm(p: string): string {
  return path.normalize(p);
}

function keyOf(p: string): string {
  return process.platform === 'win32' ? norm(p).toLowerCase() : norm(p);
}

function indexRecords(records: LibraryRecord[]): void {
  byJobId.clear();
  byPath.clear();
  for (const record of records) {
    byJobId.set(record.jobId, record);
    byPath.set(keyOf(record.filePath), record);
  }
}

function fileExists(filePath: string): boolean {
  try {
    return !!filePath && fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readAll(): LibraryRecord[] {
  if (cache) return cache;
  try {
    if (!fs.existsSync(LIBRARY_FILE)) {
      cache = [];
    } else {
      const parsed = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')) as LibraryRecord[];
      cache = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    cache = [];
  }
  indexRecords(cache);
  return cache;
}

function writeAll(records: LibraryRecord[]): void {
  const ordered = records.toSorted((a, b) => b.completedAt - a.completedAt);
  fs.mkdirSync(path.dirname(LIBRARY_FILE), { recursive: true });
  const tmp = `${LIBRARY_FILE}.${process.pid}.part`;
  fs.writeFileSync(tmp, JSON.stringify(ordered, null, 2), 'utf8');
  fs.renameSync(tmp, LIBRARY_FILE);
  cache = ordered;
  indexRecords(ordered);
}

export namespace LibraryStore {
  export function upsert(record: LibraryRecord): void {
    upsertMany([record]);
  }

  export function upsertMany(recordsToUpsert: LibraryRecord[]): void {
    if (recordsToUpsert.length === 0) return;
    const incoming = new Map(recordsToUpsert.map(record => [record.jobId, record]));
    const ids = new Set(incoming.keys());
    const paths = new Set(Array.from(incoming.values(), record => keyOf(record.filePath)));
    const existing = readAll().filter(
      record => !ids.has(record.jobId) && !paths.has(keyOf(record.filePath))
    );
    writeAll([...incoming.values(), ...existing]);
  }

  export function reconcile(): { removed: number } {
    const all = readAll();
    const seen = new Set<string>();
    const kept: LibraryRecord[] = [];
    for (const record of all.toSorted((a, b) => b.completedAt - a.completedAt)) {
      const key = keyOf(record.filePath);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!fileExists(record.filePath)) continue;
      kept.push(record);
    }
    const removed = all.length - kept.length;
    if (removed > 0) writeAll(kept);
    return { removed };
  }

  export function list(): LibraryRecord[] {
    return readAll()
      .filter(record => fileExists(record.filePath))
      .toSorted((a, b) => b.completedAt - a.completedAt);
  }

  export function findByJobId(jobId: string): LibraryRecord | undefined {
    readAll();
    const record = byJobId.get(jobId);
    return record && fileExists(record.filePath) ? record : undefined;
  }

  export function findByPath(filePath: string): LibraryRecord | undefined {
    readAll();
    const record = byPath.get(keyOf(filePath));
    return record && fileExists(record.filePath) ? record : undefined;
  }

  export function remove(jobId: string): void {
    writeAll(readAll().filter(record => record.jobId !== jobId));
  }
}

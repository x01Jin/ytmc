import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

declare global {
  interface Array<T> {
    toSorted(compareFn?: (a: T, b: T) => number): T[];
  }
}

export interface HistoryEntry {
  jobId: string;
  videoId: string;
  canonicalUrl: string;
  title: string;
  author: string;
  thumbnail: string;
  createdAt: number;
  completedAt: number;
}

const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_ENTRIES = 200;

function readAll(): HistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): void {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  const tmp = `${HISTORY_FILE}.${process.pid}.part`;
  fs.writeFileSync(tmp, JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2), 'utf8');
  fs.renameSync(tmp, HISTORY_FILE);
}

export namespace HistoryStore {
  export function add(entry: HistoryEntry): void {
    const entries = readAll().filter(e => e.jobId !== entry.jobId);
    entries.unshift(entry);
    writeAll(entries);
  }

  export function list(): HistoryEntry[] {
    return readAll().toSorted(
      (a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)
    );
  }

  export function remove(jobId: string): boolean {
    const entries = readAll();
    if (!entries.some(e => e.jobId === jobId)) return false;
    writeAll(entries.filter(e => e.jobId !== jobId));
    return true;
  }

  export function clear(): void {
    writeAll([]);
  }
}

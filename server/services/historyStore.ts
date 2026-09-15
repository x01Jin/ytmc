import fs from "fs";
import path from "path";
import { DATA_DIR } from "../config.js";

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

const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const MAX_ENTRIES = 200;

function readAll(): HistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const parsed = JSON.parse(
      fs.readFileSync(HISTORY_FILE, "utf8"),
    ) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: HistoryEntry[]): void {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  const tmp = `${HISTORY_FILE}.${process.pid}.part`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2),
    "utf8",
  );
  fs.renameSync(tmp, HISTORY_FILE);
}

/**
 * Append-only log of finished Convert-tab conversions.
 *
 * Entries are frozen at completion time (original YouTube title, author,
 * thumbnail). Library edits (retag, trim, format change) never touch this
 * index, so History always shows what was originally converted. Deleting a
 * library file does not remove its History entry — the link can still be
 * re-converted.
 */
export class HistoryStore {
  public static add(entry: HistoryEntry): void {
    const entries = readAll().filter((e) => e.jobId !== entry.jobId);
    entries.unshift(entry);
    writeAll(entries);
  }

  public static list(): HistoryEntry[] {
    return readAll().sort(
      (a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt),
    );
  }

  public static remove(jobId: string): boolean {
    const entries = readAll();
    if (!entries.some((e) => e.jobId === jobId)) return false;
    writeAll(entries.filter((e) => e.jobId !== jobId));
    return true;
  }

  public static clear(): void {
    writeAll([]);
  }
}

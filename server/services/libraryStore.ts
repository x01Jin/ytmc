import fs from "fs";
import path from "path";
import { DATA_DIR } from "../config.js";
import type { MusicTags } from "./audioTagService.js";

export interface LibraryRecord {
  jobId: string;
  source?: "conversion" | "import";
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

const LIBRARY_FILE = path.join(DATA_DIR, "library.json");
const MAX_RECORDS = 500;

/** Identity of a file on disk. Case-insensitive on Windows. */
export function isSameFilePath(a: string, b: string): boolean {
  const norm = (p: string) => path.normalize(p);
  if (process.platform === "win32") return norm(a).toLowerCase() === norm(b).toLowerCase();
  return norm(a) === norm(b);
}

function readAll(): LibraryRecord[] {
  try {
    if (!fs.existsSync(LIBRARY_FILE)) return [];
    const parsed = JSON.parse(
      fs.readFileSync(LIBRARY_FILE, "utf8"),
    ) as LibraryRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(records: LibraryRecord[]): void {
  fs.mkdirSync(path.dirname(LIBRARY_FILE), { recursive: true });
  const tmp = `${LIBRARY_FILE}.${process.pid}.part`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(records.slice(0, MAX_RECORDS), null, 2),
    "utf8",
  );
  fs.renameSync(tmp, LIBRARY_FILE);
}

export class LibraryStore {
  public static upsert(record: LibraryRecord): void {
    // One row per file: drop any row with the same id OR the same path so
    // a rescan/rename can never stack two rows over one file on disk.
    const records = readAll().filter(
      (r) => r.jobId !== record.jobId && !isSameFilePath(r.filePath, record.filePath),
    );
    records.unshift(record);
    writeAll(records);
  }

  /**
   * Collapse duplicate rows (same file, different ids) keeping the newest,
   * and persist-drop rows whose file no longer exists. Runs at boot so
   * stale accumulation from older builds heals itself.
   */
  public static reconcile(): { removed: number } {
    const seen = new Set<string>();
    const keyOf = (p: string) =>
      process.platform === "win32"
        ? path.normalize(p).toLowerCase()
        : path.normalize(p);
    const sorted = readAll().sort((a, b) => b.completedAt - a.completedAt);
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
    const removed = readAll().length - kept.length;
    if (removed > 0) writeAll(kept);
    return { removed };
  }

  public static list(): LibraryRecord[] {
    return readAll()
      .filter((r) => {
        try {
          return !!r.filePath && fs.existsSync(r.filePath);
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.completedAt - a.completedAt);
  }

  public static remove(jobId: string): void {
    writeAll(readAll().filter((r) => r.jobId !== jobId));
  }
}

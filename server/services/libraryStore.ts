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
    const records = readAll().filter((r) => r.jobId !== record.jobId);
    records.unshift(record);
    writeAll(records);
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

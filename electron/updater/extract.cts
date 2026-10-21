import * as fs from 'node:fs';
import * as path from 'node:path';
import { crc32 as nativeCrc32 } from 'node:zlib';
import * as yauzl from 'yauzl';

export type ExtractOutcome =
  | { ok: true; entries: number; bytes: number }
  | { ok: false; reason: string; detail?: string };

export interface ArchiveInfo {
  entries: number;
  bytes: number;
}

export interface ExtractProgress {
  entries: number;
  totalEntries: number;
  bytes: number;
  totalBytes: number;
}

export interface ExtractOptions {
  totalEntries?: number;
  totalBytes?: number;
  onProgress?: (progress: ExtractProgress) => void;
}

const MAX_ENTRIES = 20000;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_TARGET_LENGTH = 240;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const TRAILING_DOT_OR_SPACE = /[ .]$/;

function isSymlink(entry: yauzl.Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
}

function targetFor(destination: string, entryName: string): string | null {
  if (entryName.length === 0 || entryName.includes(':')) return null;
  if (entryName.includes('\\')) return null;
  const root = path.resolve(destination);
  const segments: string[] = [];
  for (const segment of entryName.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    if (TRAILING_DOT_OR_SPACE.test(segment)) return null;
    if (RESERVED_NAME.test(segment)) return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  const target = path.resolve(root, segments.join(path.sep));
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  if (target.length > MAX_TARGET_LENGTH) return null;
  return target;
}

export function extractArchive(
  archivePath: string,
  destination: string,
  options: ExtractOptions = {}
): Promise<ExtractOutcome> {
  return new Promise(resolve => {
    yauzl.open(
      archivePath,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          resolve({ ok: false, reason: 'open-failed' });
          return;
        }
        const totalBytes = options.totalBytes ?? 0;
        const totalEntries = options.totalEntries ?? 0;
        const seen = new Set<string>();
        let entries = 0;
        let completedEntries = 0;
        let completedBytes = 0;
        let bytes = 0;
        let settled = false;
        const fail = (reason: string, detail?: string) => {
          if (settled) return;
          settled = true;
          try {
            zipFile.close();
          } catch {}
          resolve(detail === undefined ? { ok: false, reason } : { ok: false, reason, detail });
        };
        const progress = (currentBytes: number) => {
          if (!options.onProgress) return;
          try {
            options.onProgress({
              entries: completedEntries,
              totalEntries,
              bytes: completedBytes + currentBytes,
              totalBytes,
            });
          } catch {
            fail('progress-failed');
          }
        };
        zipFile.on('error', (error: Error) => {
          if (
            /invalid characters in fileName|absolute path|invalid relative path/i.test(
              error.message
            )
          ) {
            fail('unsafe-entry');
          } else {
            fail('archive-error', error.message);
          }
        });
        zipFile.on('entry', (entry: yauzl.Entry) => {
          if (settled) return;
          entries += 1;
          if (entries > MAX_ENTRIES) {
            fail('too-many-entries');
            return;
          }
          if (isSymlink(entry)) {
            fail('symlink-entry');
            return;
          }
          const isDirectory = entry.fileName.endsWith('/');
          const target = targetFor(destination, entry.fileName);
          if (!target) {
            fail('unsafe-entry');
            return;
          }
          const key = target.toLowerCase();
          if (seen.has(key)) {
            fail('duplicate-entry');
            return;
          }
          seen.add(key);
          bytes += entry.uncompressedSize;
          if (bytes > MAX_TOTAL_BYTES) {
            fail('archive-too-large');
            return;
          }
          if (isDirectory) {
            fs.mkdirSync(target, { recursive: true });
            completedEntries += 1;
            progress(0);
            zipFile.readEntry();
            return;
          }
          zipFile.openReadStream(entry, (streamError, readStream) => {
            if (streamError || !readStream) {
              fail(
                'entry-read-failed',
                streamError ? `${entry.fileName}: ${streamError.message}` : entry.fileName
              );
              return;
            }
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const output = fs.createWriteStream(target);
            let crc = 0;
            let size = 0;
            readStream.on('data', (chunk: Buffer) => {
              crc = nativeCrc32(chunk, crc);
              size += chunk.length;
              progress(size);
            });
            readStream.on('error', (error: Error) => {
              output.destroy();
              fail('entry-read-failed', `${entry.fileName}: ${error.message}`);
            });
            output.on('error', (error: Error) => {
              readStream.destroy();
              const code = (error as NodeJS.ErrnoException).code;
              fail('entry-write-failed', `${entry.fileName}: ${code ?? error.message}`);
            });
            output.on('close', () => {
              if (settled) return;
              if (size !== entry.uncompressedSize) {
                fail('entry-size-mismatch');
                return;
              }
              if (crc >>> 0 !== entry.crc32 >>> 0) {
                fail('entry-crc-mismatch');
                return;
              }
              completedEntries += 1;
              completedBytes += size;
              progress(0);
              zipFile.readEntry();
            });
            readStream.pipe(output);
          });
        });
        zipFile.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ ok: true, entries, bytes });
        });
        zipFile.readEntry();
      }
    );
  });
}

export function archiveInfo(archivePath: string): Promise<ArchiveInfo | null> {
  return new Promise(resolve => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        resolve(null);
        return;
      }
      let entries = 0;
      let bytes = 0;
      let settled = false;
      const finish = (value: ArchiveInfo | null) => {
        if (settled) return;
        settled = true;
        try {
          zipFile.close();
        } catch {}
        resolve(value);
      };
      zipFile.on('error', () => finish(null));
      zipFile.on('entry', (entry: yauzl.Entry) => {
        entries += 1;
        bytes += entry.uncompressedSize;
        if (entries > MAX_ENTRIES || bytes > MAX_TOTAL_BYTES) {
          finish(null);
          return;
        }
        zipFile.readEntry();
      });
      zipFile.on('end', () => finish({ entries, bytes }));
      zipFile.readEntry();
    });
  });
}

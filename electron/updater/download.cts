import { once } from 'node:events';
import * as fs from 'node:fs';
import { hashFileHex, verifyDigestSignature } from './signature.cjs';
import { headerValue, type OpenStream } from './http.cjs';

export interface DownloadPlan {
  url: string;
  destination: string;
  expectedSize: number;
  expectedDigestHex: string;
  signatureBase64: string;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

export type DownloadOutcome =
  | { status: 'ok'; bytes: number; etag: string | null }
  | { status: 'aborted'; bytes: number }
  | { status: 'stale-url'; bytes: number }
  | { status: 'failed'; reason: string; bytes: number };

export interface DownloadOptions {
  openStream: OpenStream;
  plan: DownloadPlan;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

interface ConsumeResult {
  status: 'complete' | 'aborted' | 'stalled' | 'oversized';
  bytes: number;
}

const USER_AGENT = 'ytmc-updater';
const STALL_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 4;

function partPathOf(destination: string): string {
  return `${destination}.part`;
}

function partSize(partPath: string): number {
  try {
    const stats = fs.statSync(partPath);
    return stats.isFile() ? stats.size : 0;
  } catch {
    return 0;
  }
}

function truncate(partPath: string): void {
  fs.rmSync(partPath, { force: true });
}

function parseContentRange(value: string): { start: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { start: Number(match[1]), total: Number(match[3]) };
}

async function consume(
  options: DownloadOptions,
  response: { stream: AsyncIterable<Buffer>; abort: () => void },
  partPath: string,
  received: number
): Promise<ConsumeResult> {
  const total = options.plan.expectedSize;
  const output = fs.createWriteStream(partPath, { flags: received > 0 ? 'a' : 'w' });
  let bytes = received;
  let stalled = false;
  let oversized = false;
  let timer: NodeJS.Timeout | null = null;
  const resetWatchdog = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      response.abort();
    }, STALL_TIMEOUT_MS);
  };
  const onAbort = () => response.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    resetWatchdog();
    for await (const chunk of response.stream) {
      resetWatchdog();
      if (options.signal?.aborted) break;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > total) {
        oversized = true;
        response.abort();
        break;
      }
      if (!output.write(buffer)) await once(output, 'drain');
      options.onProgress?.({ received: bytes, total });
    }
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    output.destroy();
    if (options.signal?.aborted) return { status: 'aborted', bytes };
    if (stalled) return { status: 'stalled', bytes };
    if (oversized) return { status: 'oversized', bytes };
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
  if (options.signal?.aborted) return { status: 'aborted', bytes };
  if (stalled) return { status: 'stalled', bytes };
  if (oversized) return { status: 'oversized', bytes };
  return { status: 'complete', bytes };
}

export async function downloadUpdate(options: DownloadOptions): Promise<DownloadOutcome> {
  const { plan, openStream, signal, onProgress } = options;
  if (!Number.isSafeInteger(plan.expectedSize) || plan.expectedSize <= 0) {
    return { status: 'failed', reason: 'size-invalid', bytes: 0 };
  }
  const partPath = partPathOf(plan.destination);
  let received = partSize(partPath);
  let etag: string | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) return { status: 'aborted', bytes: received };
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/octet-stream',
    };
    if (received > 0) {
      headers.Range = `bytes=${received}-`;
      if (etag) headers['If-Range'] = etag;
    }
    let response;
    try {
      response = await openStream(plan.url, { headers });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS - 1) {
        return {
          status: 'failed',
          reason: 'network',
          bytes: received,
        };
      }
      void error;
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      response.abort();
      return { status: 'stale-url', bytes: received };
    }
    if (response.status === 416) {
      response.abort();
      truncate(partPath);
      received = 0;
      continue;
    }
    if (response.status !== 200 && response.status !== 206) {
      response.abort();
      return { status: 'failed', reason: `http-${response.status}`, bytes: received };
    }
    if (response.status === 206) {
      const range = parseContentRange(headerValue(response.headers, 'content-range') ?? '');
      if (!range || range.total !== plan.expectedSize || range.start !== received) {
        response.abort();
        truncate(partPath);
        received = 0;
        continue;
      }
    } else if (received > 0) {
      truncate(partPath);
      received = 0;
    }
    const responseEtag = headerValue(response.headers, 'etag');
    if (responseEtag) etag = responseEtag;
    const result = await consume(options, response, partPath, received);
    if (result.status === 'aborted') return { status: 'aborted', bytes: result.bytes };
    received = result.bytes;
    if (result.status === 'stalled') continue;
    if (result.status === 'oversized') {
      truncate(partPath);
      return { status: 'failed', reason: 'size-mismatch', bytes: 0 };
    }
    if (received !== plan.expectedSize) {
      truncate(partPath);
      return { status: 'failed', reason: 'size-mismatch', bytes: 0 };
    }
    const digestHex = await hashFileHex(partPath);
    if (digestHex !== plan.expectedDigestHex) {
      truncate(partPath);
      return { status: 'failed', reason: 'digest-mismatch', bytes: 0 };
    }
    const signature = verifyDigestSignature(digestHex, plan.signatureBase64);
    if (!signature.ok) {
      truncate(partPath);
      return { status: 'failed', reason: `signature-${signature.reason}`, bytes: 0 };
    }
    fs.renameSync(partPath, plan.destination);
    onProgress?.({ received, total: plan.expectedSize });
    return { status: 'ok', bytes: received, etag };
  }
  return { status: 'failed', reason: 'retries-exhausted', bytes: received };
}

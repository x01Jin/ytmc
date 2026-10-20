import { net } from 'electron';
import type {
  FetchJson,
  HttpRequestOptions,
  HttpResponse,
  HttpResponseStream,
  OpenStream,
} from './http.cjs';

interface ElectronResponse {
  statusCode?: number;
  headers: Record<string, string | string[]>;
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
}

interface OpenResponse {
  status: number;
  headers: Record<string, string>;
  response: ElectronResponse;
  abort: () => void;
}

const RESPONSE_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function flattenHeaders(headers: Record<string, string | string[]>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    flat[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return flat;
}

function iterate(response: ElectronResponse): AsyncIterable<Buffer> {
  const chunks: Buffer[] = [];
  let ended = false;
  let failed: Error | null = null;
  let wake: (() => void) | null = null;
  const signal = () => {
    const pending = wake;
    wake = null;
    if (pending) pending();
  };
  response.on('data', chunk => {
    chunks.push(chunk);
    signal();
  });
  response.on('end', () => {
    ended = true;
    signal();
  });
  response.on('error', error => {
    failed = error;
    ended = true;
    signal();
  });
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (chunks.length > 0) yield chunks.shift() as Buffer;
        if (failed) throw failed;
        if (ended) return;
        await new Promise<void>(resolve => {
          wake = resolve;
        });
      }
    },
  };
}

function open(url: string, options?: HttpRequestOptions): Promise<OpenResponse> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: options?.method ?? 'GET',
      url,
      redirect: 'follow',
    });
    for (const [name, value] of Object.entries(options?.headers ?? {})) {
      request.setHeader(name, value);
    }
    const abort = () => {
      try {
        request.abort();
      } catch {}
    };
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      abort();
      reject(new Error('Update request timed out.'));
    }, RESPONSE_TIMEOUT_MS);
    request.on('response', response => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const message = response as unknown as ElectronResponse;
      resolve({
        status: message.statusCode ?? 0,
        headers: flattenHeaders(message.headers),
        response: message,
        abort,
      });
    });
    request.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    request.end();
  });
}

export const fetchJson: FetchJson = async (
  url: string,
  options?: HttpRequestOptions
): Promise<HttpResponse> => {
  const { status, headers, response, abort } = await open(url, options);
  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    response.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        abort();
        reject(new Error('Update response too large.'));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => resolve());
    response.on('error', reject);
  });
  return { status, headers, body: Buffer.concat(chunks).toString('utf8') };
};

export const openStream: OpenStream = async (
  url: string,
  options?: HttpRequestOptions
): Promise<HttpResponseStream> => {
  const { status, headers, response, abort } = await open(url, options);
  return { status, headers, stream: iterate(response), abort };
};

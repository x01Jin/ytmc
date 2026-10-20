export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
}

export interface HttpResponseStream {
  status: number;
  headers: Record<string, string>;
  stream: AsyncIterable<Buffer>;
  abort: () => void;
}

export type FetchJson = (url: string, options?: HttpRequestOptions) => Promise<HttpResponse>;
export type OpenStream = (url: string, options?: HttpRequestOptions) => Promise<HttpResponseStream>;

export function headerValue(headers: Record<string, string>, name: string): string | null {
  const direct = headers[name.toLowerCase()];
  return direct === undefined ? null : direct;
}

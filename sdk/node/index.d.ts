// ContrastAPI Node SDK 2.0 — hand-written client declarations.
// The per-operation argument types and methods come from src/operations.d.ts,
// which is generated from the server's OpenAPI document.

import type { ContrastAPIMethods, OperationArgs, OperationId } from "./src/operations.js";

export type * from "./src/operations.js";

/** FetchInit is the request init that the client hands to `fetch`. */
export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect: "manual";
  /** An AbortSignal. It is typed loosely, so the SDK needs neither the DOM lib nor @types/node. */
  signal: any;
}

/** FetchResponseLike is the part of a fetch Response that the client reads. */
export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: unknown;
}

export type FetchLike = (input: string, init: FetchInit) => Promise<FetchResponseLike>;

export interface RateLimitInfo {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: Date;
  readonly resetHuman: string;
}

export interface ContrastAPIOptions {
  /**
   * The API key. It defaults to the CONTRASTAPI_API_KEY environment variable, trimmed of ASCII white space.
   * An empty string sends no key. A key outside printable ASCII (0x21-0x7E) throws TypeError.
   */
  apiKey?: string;
  /** The server URL. It defaults to https://api.contrastcyber.com. Plain http is allowed only for localhost, 127.0.0.1 and [::1]. */
  baseUrl?: string;
  /** When true, the client sends the key to a host other than api.contrastcyber.com, localhost, 127.0.0.1 and [::1]. */
  trustHost?: boolean;
  /** The request timeout. The client clamps it to 1000-120000 ms. The default is 30000. */
  timeoutMs?: number;
  /** The number of retries after a 429 that carries Retry-After. The default is 0. */
  maxRetries?: number;
  /** A finite number >= 0, in ms. The client does not retry a 429 or a busy 503 whose wait is longer. The default is 60000. */
  maxRetryWaitMs?: number;
  /** The number of retries after a 503 with the code upstream_busy or raw_body_busy. The default is 2. */
  upstreamBusyRetries?: number;
  /** The fetch function. It defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** The client calls it with each new rate-limit reading. An exception that it throws is ignored. */
  onRateLimit?: (info: RateLimitInfo) => void;
}

export interface RequestOptions {
  query?: Record<string, string | number | bigint | boolean | null | undefined>;
  body?: unknown;
}

type CallArgs<K extends OperationId> = {} extends OperationArgs[K]
  ? [args?: OperationArgs[K]]
  : [args: OperationArgs[K]];

export declare class ContrastAPI {
  constructor(options?: ContrastAPIOptions);
  call<K extends OperationId>(operationId: K, ...args: CallArgs<K>): Promise<unknown>;
  request(method: string, path: string, options?: RequestOptions): Promise<unknown>;
  get lastRateLimit(): RateLimitInfo | null;
}

export interface ContrastAPI extends ContrastAPIMethods {}

export interface ContrastAPIErrorOptions {
  status?: number | null;
  code?: string | null;
  retryAfter?: number | null;
  rateLimit?: RateLimitInfo | null;
  cause?: unknown;
}

export declare class ContrastAPIError extends Error {
  constructor(message: string, options?: ContrastAPIErrorOptions);
  readonly status: number | null;
  readonly code: string | null;
  /** The seconds from the Retry-After header, at most 3600, or null. */
  readonly retryAfter: number | null;
  readonly rateLimit: RateLimitInfo | null;
}
export declare class BadRequestError extends ContrastAPIError {}
export declare class AuthenticationError extends ContrastAPIError {}
export declare class NotFoundError extends ContrastAPIError {}
export declare class RateLimitError extends ContrastAPIError {}
export declare class UpstreamError extends ContrastAPIError {}
export declare class APIConnectionError extends ContrastAPIError {
  readonly status: null;
}
export declare class APITimeoutError extends APIConnectionError {}

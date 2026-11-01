// This file holds the ContrastAPI REST client. One transport serves every operation.
// The generated methods and call() build a request from OPERATIONS.
// request() takes a raw path instead.

import { OPERATIONS } from "./operations.js";
import {
  ContrastAPIError,
  APIConnectionError,
  APITimeoutError,
  errorClassForStatus,
} from "./errors.js";

/** VERSION is the package version. The User-Agent header carries it. */
export const VERSION = "2.0.0";

const USER_AGENT = `contrastapi-node/${VERSION}`;
const DEFAULT_BASE_URL = "https://api.contrastcyber.com";
const TRUSTED_HOST = "api.contrastcyber.com";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const API_KEY_ENV_VAR = "CONTRASTAPI_API_KEY";

const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_MAX_RETRY_WAIT_MS = 60000;
const DEFAULT_UPSTREAM_BUSY_RETRIES = 2;
const MAX_RETRY_AFTER_SECONDS = 3600;
const DEFAULT_RETRY_WAIT_SECONDS = 1;
const BUSY_CODES = new Set(["upstream_busy", "raw_body_busy"]);

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 300;
/** MAX_HEADER_INTEGER is the largest rate-limit count the client reads. The Python client uses the same bound. */
const MAX_HEADER_INTEGER = Number.MAX_SAFE_INTEGER;
/** MAX_RESET_UNIX_SECONDS is 9999-12-31T23:59:59Z. It is the last second that a Python datetime holds. */
const MAX_RESET_UNIX_SECONDS = 253402300799;

const DIGITS = /^[0-9]+$/;
const KEY_CHARS = /^[\x21-\x7e]+$/;
const ASCII_SPACE_EDGES = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
const METHOD_CHARS = /^[A-Za-z]+$/;
/* eslint-disable no-control-regex */
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f\p{Cf}\p{Cs}]/gu;
const URL_UNSAFE_CHARS = /[\x00-\x20\x7f\\]/;
const RAW_PATH_UNSAFE_CHARS = /[\x00-\x20\x7f\\?#]/;
/* eslint-enable no-control-regex */
const URL_SCHEME_AND_AUTHORITY = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/]*)/;
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;
const PATH_SAFE_CHARS = /[A-Za-z0-9\-._~!$&'()*+,;=:@]/;
const QUERY_SAFE_CHARS = /[A-Za-z0-9\-._~]/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * parseRetryAfter reads a Retry-After header. It accepts whole seconds only and clamps them to 0-3600.
 * @param {string|null} value
 * @returns {number|null} seconds, or null when absent or not an integer
 */
function parseRetryAfter(value) {
  if (value === null || !DIGITS.test(value)) return null;
  return Math.min(Number(value), MAX_RETRY_AFTER_SECONDS);
}

/**
 * parseRateLimit reads the four rate-limit headers. It returns null when a header is
 * missing or a count is not a whole number. Free calls send none of the four.
 */
function parseRateLimit(headers) {
  const limit = headers.get("X-RateLimit-Limit");
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset = headers.get("X-RateLimit-Reset-Machine");
  const resetHuman = headers.get("X-RateLimit-Reset-Human");
  if (limit === null || remaining === null || reset === null || resetHuman === null) return null;
  if (!DIGITS.test(limit) || !DIGITS.test(remaining) || !DIGITS.test(reset) || resetHuman === "") return null;
  const counts = { limit: Number(limit), remaining: Number(remaining), reset: Number(reset) };
  if (counts.limit > MAX_HEADER_INTEGER || counts.remaining > MAX_HEADER_INTEGER) return null;
  if (counts.reset > MAX_RESET_UNIX_SECONDS) return null;
  return Object.freeze({
    limit: counts.limit,
    remaining: counts.remaining,
    resetAt: new Date(counts.reset * 1000),
    resetHuman: cleanText(resetHuman),
  });
}

/**
 * cleanText removes C0 controls, DEL, C1 controls, format characters (Unicode Cf,
 * such as U+202E) and lone surrogates. Then it cuts the text to MAX_MESSAGE_CHARS
 * code points. It counts code points, so it never cuts a surrogate pair in half.
 */
function cleanText(value) {
  return Array.from(value.replace(CONTROL_CHARS, "")).slice(0, MAX_MESSAGE_CHARS).join("");
}

/** percentEncode encodes every UTF-8 byte of `text` as %XX unless `keep` matches its character. */
function percentEncode(text, keep) {
  let out = "";
  for (const byte of new TextEncoder().encode(text)) {
    const ch = String.fromCharCode(byte);
    if (keep.test(ch)) out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/**
 * scalarText turns one path or query value into text. A well-formed string stays as it is.
 * A finite number, a boolean or a bigint goes through String(). Anything else throws
 * TypeError, so an object never goes out as "[object Object]" and NaN never as "NaN".
 */
function scalarText(name, value) {
  switch (typeof value) {
    case "string":
      if (!value.isWellFormed()) throw new TypeError(`${name} holds a lone surrogate`);
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
      return String(value);
    case "boolean":
    case "bigint":
      return String(value);
    default:
      throw new TypeError(`${name} must be a string, number or boolean`);
  }
}

/**
 * queryString writes the name=value pairs. It percent-encodes every byte outside the
 * RFC 3986 unreserved set, and a space becomes %20. It leaves out a pair whose value is
 * undefined or null.
 */
function queryString(pairs) {
  const parts = [];
  for (const [name, value] of pairs) {
    if (value === undefined || value === null) continue;
    const text = scalarText(`query value "${name}"`, value);
    const key = scalarText("query name", name);
    parts.push(percentEncode(key, QUERY_SAFE_CHARS) + "=" + percentEncode(text, QUERY_SAFE_CHARS));
  }
  return parts.join("&");
}

/**
 * jsonBody serializes a request body. A non-finite number, a function, a symbol or an
 * object that is neither plain nor an array throws TypeError. Without the check it would
 * turn silently into null, nothing or {}. An object with toJSON, such as a Date, is
 * written through toJSON.
 */
function jsonBody(body) {
  return JSON.stringify(body, (key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("body holds a number that is not finite");
    }
    if (typeof value === "function" || typeof value === "symbol") {
      throw new TypeError("body holds a function or a symbol");
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value) && !isPlainObject(value)) {
      throw new TypeError("body holds an object that is not plain");
    }
    return value;
  });
}

function isPlainObject(value) {
  if (value === null || value === undefined) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * isIdentityEncoded tells whether a Content-Encoding value is absent or "identity".
 * The client asks for identity. It reads no other body, because fetch would decode
 * that body before readCapped could count its bytes.
 */
function isIdentityEncoded(value) {
  return value === null || value.toLowerCase() === "identity";
}

/**
 * hasDotSegment tells whether `path` holds a "." or ".." segment. A dot written as %2e,
 * in any case, counts as a dot. The URL parser of fetch reads it as a dot, and httpx
 * does not. Refusing every spelling keeps the two SDKs alike.
 */
function hasDotSegment(path) {
  return path.split("/").some((segment) => DOT_SEGMENT.test(segment));
}

/**
 * isUnderBase tells whether `url` has the origin of `base` and a path under the path
 * of `base`. Both go through the URL parser that fetch uses.
 */
export function isUnderBase(url, base) {
  const built = new URL(url);
  const root = new URL(base);
  return built.origin === root.origin && built.pathname.startsWith(root.pathname.replace(/\/+$/, "") + "/");
}

/** writtenHost returns the host of an authority as written. It lower-cases the host and drops the port. An IPv6 host keeps its brackets. */
function writtenHost(authority) {
  const end = authority.startsWith("[") ? authority.indexOf("]") + 1 : authority.indexOf(":");
  return (end <= 0 ? authority : authority.slice(0, end)).toLowerCase();
}

/**
 * parseBaseUrl checks baseUrl and returns it without trailing slashes. The host that
 * decides http and the key is the host as written. It is not the host that the URL
 * parser rebuilds: "127.1" is not localhost, and "%63om" is not "com". It refuses a
 * "." or ".." path segment, because the URL parser would resolve it away.
 * @returns {{base: string, host: string}}
 */
function parseBaseUrl(raw) {
  if (typeof raw !== "string") throw new TypeError("baseUrl must be a string");
  if (URL_UNSAFE_CHARS.test(raw)) {
    throw new TypeError("baseUrl must not hold whitespace, control characters or a backslash");
  }
  if (raw.includes("?") || raw.includes("#")) {
    throw new TypeError("baseUrl must not contain a query or fragment");
  }
  const head = URL_SCHEME_AND_AUTHORITY.exec(raw);
  if (head === null) throw new TypeError("baseUrl is not a valid URL");
  if (head[2].includes("@")) throw new TypeError("baseUrl must not contain a username or password");
  const host = writtenHost(head[2]);
  if (host === "") throw new TypeError("baseUrl has no host");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("baseUrl is not a valid URL");
  }
  if (hasDotSegment(raw.slice(head[0].length))) {
    throw new TypeError("baseUrl path must not hold a . or .. segment");
  }
  const scheme = head[1].toLowerCase();
  if (scheme !== "https" && !(scheme === "http" && LOCAL_HOSTS.has(host))) {
    throw new TypeError("baseUrl must use https (http only for localhost, 127.0.0.1 or [::1])");
  }
  return { base: (url.origin + url.pathname).replace(/\/+$/, ""), host };
}

function resolveKey(apiKey) {
  let key = apiKey;
  if (key === undefined) key = (process.env[API_KEY_ENV_VAR] ?? "").replace(ASCII_SPACE_EDGES, "");
  if (typeof key !== "string") throw new TypeError("apiKey must be a string");
  if (key === "") return null;
  if (!KEY_CHARS.test(key)) throw new TypeError("apiKey may hold only printable ASCII without spaces");
  return key;
}

function checkRetryCount(name, value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a whole number >= 0`);
  return value;
}

function clampTimeout(value) {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(value, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/**
 * readCapped reads the body bytes, up to MAX_RESPONSE_BYTES. Past the cap it cancels the
 * stream and returns null. A huge body therefore never sits in memory whole.
 */
async function readCapped(response) {
  const body = response.body;
  if (body === null || body === undefined) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * parseJson parses a body as strict UTF-8 JSON and drops one leading BOM. It returns
 * undefined for bytes that are not UTF-8 and for text that is not JSON.
 */
function parseJson(bytes) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

function connectionError(err) {
  if (err?.name === "TimeoutError") {
    return new APITimeoutError("request timed out", { cause: err });
  }
  return new APIConnectionError("connection failed", { cause: err });
}

/**
 * buildRequest checks `args` against one operation and builds its path, query and body.
 * It throws TypeError for an args object that is not plain, an unknown key, a missing
 * required value (undefined or null) and a path or query value that scalarText refuses.
 * @returns {{method: string, path: string, search: string, body: object|undefined}}
 */
export function buildRequest(operationId, op, args) {
  if (!isPlainObject(args)) throw new TypeError(`${operationId}: args must be a plain object`);
  const names = new Set(op.params.map((p) => p.name));
  for (const key of Object.keys(args)) {
    if (!names.has(key)) throw new TypeError(`${operationId}: unknown argument "${key}"`);
  }
  for (const p of op.params) {
    if (p.required && (args[p.name] === undefined || args[p.name] === null)) {
      throw new TypeError(`${operationId}: missing required argument "${p.name}"`);
    }
  }

  let path = op.path;
  const pairs = [];
  let body;
  for (const p of op.params) {
    const value = args[p.name];
    if (p.in === "path") {
      const segment = percentEncode(scalarText(`${operationId}: "${p.name}"`, value), PATH_SAFE_CHARS);
      // A function replacement: a string one would expand "$&" and "$'" in the value.
      path = path.replace(`{${p.name}}`, () => segment);
    } else if (p.in === "query") {
      pairs.push([p.name, value]);
    } else {
      body ??= {};
      if (value !== undefined && value !== null) body[p.name] = value;
    }
  }
  return { method: op.method, path, search: queryString(pairs), body };
}

export class ContrastAPI {
  #apiKey;
  #base;
  #timeoutMs;
  #maxRetries;
  #maxRetryWaitMs;
  #upstreamBusyRetries;
  #fetch;
  #onRateLimit;
  #lastRateLimit = null;

  /** @param {import("../index.js").ContrastAPIOptions} [options] */
  constructor(options = {}) {
    const parsed = parseBaseUrl(options.baseUrl === undefined ? DEFAULT_BASE_URL : options.baseUrl);
    this.#base = parsed.base;
    const key = resolveKey(options.apiKey);
    const host = parsed.host;
    const trusted = host === TRUSTED_HOST || LOCAL_HOSTS.has(host) || options.trustHost === true;
    // The client stores a key only when it will send it.
    this.#apiKey = trusted ? key : null;
    this.#timeoutMs = clampTimeout(options.timeoutMs);
    this.#maxRetries = checkRetryCount("maxRetries", options.maxRetries, DEFAULT_MAX_RETRIES);
    this.#upstreamBusyRetries = checkRetryCount(
      "upstreamBusyRetries",
      options.upstreamBusyRetries,
      DEFAULT_UPSTREAM_BUSY_RETRIES,
    );
    const wait = options.maxRetryWaitMs;
    if (wait !== undefined && !(Number.isFinite(wait) && wait >= 0)) {
      throw new TypeError("maxRetryWaitMs must be a finite number >= 0");
    }
    this.#maxRetryWaitMs = wait === undefined ? DEFAULT_MAX_RETRY_WAIT_MS : wait;
    const fetchFn = options.fetch === undefined ? globalThis.fetch : options.fetch;
    if (typeof fetchFn !== "function") throw new TypeError("fetch must be a function");
    this.#fetch = fetchFn;
    if (options.onRateLimit !== undefined && typeof options.onRateLimit !== "function") {
      throw new TypeError("onRateLimit must be a function");
    }
    this.#onRateLimit = options.onRateLimit;
  }

  /** lastRateLimit is the rate-limit reading of the last response that carried one, or null. */
  get lastRateLimit() {
    return this.#lastRateLimit;
  }

  /**
   * call runs one operation of OPERATIONS. Every argument check happens before the
   * request, so a call with a bad argument spends no credit.
   * @returns {Promise<unknown>} the parsed JSON body
   */
  async call(operationId, args = {}) {
    if (!Object.hasOwn(OPERATIONS, operationId)) {
      throw new TypeError(`unknown operation: ${String(operationId)}`);
    }
    const { method, path, search, body } = buildRequest(operationId, OPERATIONS[operationId], args);
    return this.#send(method, path, search, body);
  }

  /**
   * request sends a raw request to a path that the operations table does not cover.
   * It follows the same key policy, errors, retries and rate-limit reading as call().
   */
  async request(method, path, options = {}) {
    if (typeof method !== "string" || !METHOD_CHARS.test(method)) {
      throw new TypeError("method must be ASCII letters only");
    }
    if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError('path must start with "/"');
    if (RAW_PATH_UNSAFE_CHARS.test(path)) {
      throw new TypeError("path must not hold whitespace, control characters, a backslash, ? or #");
    }
    const { query, body } = options;
    let search = "";
    if (query !== undefined && query !== null) {
      if (!isPlainObject(query)) throw new TypeError("query must be a plain object");
      search = queryString(Object.entries(query));
    }
    return this.#send(method.toUpperCase(), path, search, body ?? undefined);
  }

  /**
   * #send is the one place that builds a URL. Before any request it refuses a path with
   * a dot segment. Then it checks that the URL stays under baseUrl. So neither a table
   * path nor a raw path can send the key elsewhere.
   */
  async #send(method, path, search, body) {
    if (hasDotSegment(path)) throw new TypeError("request path must not hold a . or .. segment");
    const url = this.#base + path + (search === "" ? "" : "?" + search);
    if (!isUnderBase(url, this.#base)) throw new TypeError("request URL is not under baseUrl");
    const headers = { Accept: "application/json", "Accept-Encoding": "identity", "User-Agent": USER_AGENT };
    let payload;
    if (body !== undefined) {
      payload = jsonBody(body);
      headers["Content-Type"] = "application/json";
    }
    if (this.#apiKey !== null) headers["X-API-Key"] = this.#apiKey;

    let busyLeft = this.#upstreamBusyRetries;
    let rateLeft = this.#maxRetries;
    for (;;) {
      const { status, bytes, rateLimit, retryAfter } = await this.#attempt(method, url, headers, payload);
      if (status >= 300 && status <= 399) throw new APIConnectionError("redirect refused");
      const parsed = parseJson(bytes);
      if (status >= 200 && status <= 299) {
        if (typeof parsed === "object" && parsed !== null) return parsed;
        const message = `response is not a JSON object or array (HTTP ${status})`;
        throw new ContrastAPIError(message, { status, rateLimit });
      }

      let code = null;
      let message = `HTTP ${status}`;
      const envelope = parsed?.error;
      if (typeof envelope?.code === "string") code = cleanText(envelope.code);
      if (typeof envelope?.message === "string") message = cleanText(envelope.message);

      // A 503 busy without Retry-After waits the default; a 429 without one is not retried.
      const waitMs = (retryAfter ?? DEFAULT_RETRY_WAIT_SECONDS) * 1000;
      const waitAllowed = waitMs <= this.#maxRetryWaitMs;
      if (status === 503 && BUSY_CODES.has(code) && busyLeft > 0 && waitAllowed) {
        busyLeft--;
        await sleep(waitMs);
        continue;
      }
      if (status === 429 && retryAfter !== null && rateLeft > 0 && waitAllowed) {
        rateLeft--;
        await sleep(waitMs);
        continue;
      }
      const ErrorClass = errorClassForStatus(status);
      throw new ErrorClass(message, { status, code, retryAfter, rateLimit });
    }
  }

  /**
   * #attempt runs one fetch and the capped body read, and records the rate-limit reading.
   * It cancels a body whose Content-Encoding is not identity without reading it.
   */
  async #attempt(method, url, headers, payload) {
    const init = {
      method,
      headers,
      // manual: a 3xx comes back as an answer, and #send refuses it. No redirect is followed.
      redirect: "manual",
      signal: AbortSignal.timeout(this.#timeoutMs),
    };
    if (payload !== undefined) init.body = payload;

    let response;
    let bytes;
    let encoded;
    try {
      const fetchFn = this.#fetch;
      response = await fetchFn(url, init);
      encoded = !isIdentityEncoded(response.headers.get("Content-Encoding"));
      if (encoded) await response.body?.cancel().catch(() => {});
      else bytes = await readCapped(response);
    } catch (err) {
      throw connectionError(err);
    }

    const status = response.status;
    const rateLimit = parseRateLimit(response.headers);
    if (rateLimit !== null) this.#recordRateLimit(rateLimit);
    if (encoded) {
      throw new ContrastAPIError("response has a Content-Encoding other than identity", { status, rateLimit });
    }
    if (bytes === null) {
      throw new ContrastAPIError(`response body exceeds ${MAX_RESPONSE_BYTES} bytes`, { status, rateLimit });
    }
    return { status, bytes, rateLimit, retryAfter: parseRetryAfter(response.headers.get("Retry-After")) };
  }

  #recordRateLimit(info) {
    this.#lastRateLimit = info;
    const callback = this.#onRateLimit;
    if (callback === undefined) return;
    try {
      const result = callback(info);
      if (typeof result?.then === "function") result.then(undefined, () => {});
    } catch {
      /* The callback is user code. Its failure must not fail the request. */
    }
  }
}

/**
 * installOperationMethods installs one method per operation on `proto`.
 * `proto[op.methodName](args)` runs `this.call(id, args)`. The function checks every
 * name before it installs any, and it throws when a name is taken. A generated method
 * therefore never hides call(), request(), lastRateLimit or an Object.prototype member.
 */
export function installOperationMethods(proto, operations) {
  const seen = new Set();
  for (const op of Object.values(operations)) {
    const name = op.methodName;
    if (name in proto || seen.has(name)) {
      throw new Error(`operation method name collides with an existing member: ${name}`);
    }
    seen.add(name);
  }
  for (const [id, op] of Object.entries(operations)) {
    Object.defineProperty(proto, op.methodName, {
      value: function (args) {
        return this.call(id, args);
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

installOperationMethods(ContrastAPI.prototype, OPERATIONS);

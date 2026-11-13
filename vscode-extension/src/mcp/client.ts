/**
 * JsonSchemaProperty is one property of a tool's inputSchema.
 * The server writes only a subset of JSON Schema there.
 * The form builder reads only the keywords listed here.
 */
export interface JsonSchemaProperty {
  type?: "string" | "integer" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/** JsonSchemaObject is a tool's inputSchema. It is always an object schema. */
export interface JsonSchemaObject extends JsonSchemaProperty {
  type: "object";
}

/** McpTool is one entry of the server's tools/list answer. */
export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchemaObject;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  _meta?: Record<string, unknown>;
}

/** MCP_CATEGORY_META_KEY is the _meta key that holds a tool's category name. */
export const MCP_CATEGORY_META_KEY = "com.contrastcyber/category";

/** RateLimitInfo holds the credit state that the X-RateLimit-* response headers carry. */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  /** resetAt is the Unix time in seconds when the credits refill. */
  resetAt: number;
}

/** McpClientOptions holds the settings of one McpClient. */
export interface McpClientOptions {
  baseUrl: string;
  apiKey?: string;
  userAgent: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onRateLimit?: (info: RateLimitInfo) => void;
}

const TRUSTED_HOST = "api.contrastcyber.com";
/** LOCAL_HOSTS holds the hostnames of this machine. URL.hostname writes the IPv6 loopback with its brackets, as [::1]. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Returns the tool's category from its _meta.
 * The sidebar groups tools by this name.
 * A missing or non-string value gives undefined, so the caller picks its own fallback group.
 */
export function toolCategory(tool: McpTool): string | undefined {
  const value = tool._meta?.[MCP_CATEGORY_META_KEY];
  return typeof value === "string" ? value : undefined;
}

/**
 * Thrown when the server answers a tools/call with isError:true.
 * The server uses it for a refused argument or a failed lookup.
 * The message is the server's own text.
 */
export class ToolError extends Error {
  toolName: string;

  constructor(toolName: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.toolName = toolName;
  }
}

/**
 * Thrown when the server refuses the request itself.
 * A JSON-RPC error sets code. A REST-shaped body leaves code undefined and sets restCode.
 * retryAfter tells the caller how long to wait after a 429 or a 503.
 */
export class RpcError extends Error {
  code: number | undefined;
  status: number;
  restCode?: string;
  retryAfter?: number;

  constructor(message: string, status: number, code?: number, restCode?: string, retryAfter?: number) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.status = status;
    if (restCode !== undefined) {
      this.restCode = restCode;
    }
    if (retryAfter !== undefined) {
      this.retryAfter = retryAfter;
    }
  }
}

/**
 * Removes trailing slashes from a base URL.
 * The client and the tool cache both use it, so one server always maps to one URL text.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function parseUrl(baseUrl: string): URL | undefined {
  try {
    return new URL(baseUrl);
  } catch {
    return undefined;
  }
}

function isLocalHost(url: URL): boolean {
  return LOCAL_HOSTS.includes(url.hostname);
}

/**
 * Tells whether the client may talk to this base URL at all.
 * Plain http is allowed only to this machine, so nothing travels in clear text over a network.
 * An unparseable URL is not allowed.
 */
export function isAllowedBaseUrl(baseUrl: string): boolean {
  const url = parseUrl(baseUrl);
  if (!url) {
    return false;
  }
  return url.protocol === "https:" || (url.protocol === "http:" && isLocalHost(url));
}

/**
 * Tells whether the API key may be sent to this base URL.
 * The hostname must equal the production host exactly, or be this machine.
 * A look-alike host such as api.contrastcyber.com.evil.com never gets the key.
 */
export function isTrustedHost(baseUrl: string): boolean {
  const url = parseUrl(baseUrl);
  if (!url) {
    return false;
  }
  return url.hostname === TRUSTED_HOST || isLocalHost(url);
}

function finiteHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * isTool tells whether a value has the shape of an McpTool: a string name and an object inputSchema.
 * title and description must be strings when present.
 * _meta and annotations must be objects when present.
 * The live tool list and the stored one both pass through it.
 * Code that reads a tool's members then never meets null or a number.
 * One bad entry therefore cannot break the sidebar or the Run Tool list.
 */
export function isTool(value: unknown): value is McpTool {
  return (
    isRecord(value)                                                            &&
    typeof value.name === "string"                                             &&
    isRecord(value.inputSchema)                                                &&
    (value.title === undefined || typeof value.title === "string")             &&
    (value.description === undefined || typeof value.description === "string") &&
    (value._meta === undefined || isRecord(value._meta))                       &&
    (value.annotations === undefined || isRecord(value.annotations))
  );
}

/**
 * Speaks JSON-RPC to the server's POST /mcp endpoint.
 * Its own error texts carry no "ContrastAPI" prefix.
 * The text that shows an error adds the name once (see forms/errorNotice.ts).
 * The server needs no initialize call and keeps no session, so each call is one POST.
 * No MCP-Protocol-Version header is sent.
 * The server decides each request's era from that header's value.
 * No header, or a handshake-era value such as 2025-06-18, keeps the request in the legacy era.
 * Any other value puts it in the modern era.
 * A modern request must carry reserved keys in params._meta, and this client sends none.
 */
export class McpClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onRateLimit?: (info: RateLimitInfo) => void;
  private nextId = 1;

  /**
   * Checks the base URL before anything is sent.
   * A refused URL throws here, so a bad setting fails at once and not on the first call.
   * The key goes into the headers only for a trusted host.
   */
  constructor(options: McpClientOptions) {
    if (!isAllowedBaseUrl(options.baseUrl)) {
      throw new Error("The contrastapi.baseUrl setting must use https (http is allowed only for localhost).");
    }
    const base = normalizeBaseUrl(options.baseUrl);
    this.endpoint = `${base}/mcp`;
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": options.userAgent,
    };
    if (options.apiKey && isTrustedHost(base)) {
      this.headers["X-API-Key"] = options.apiKey;
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onRateLimit = options.onRateLimit;
  }

  /**
   * Fetches the server's tool list.
   * The sidebar, the Run Tool pick list and the forms come from this list, not from a copy in the bundle.
   * The palette shortcuts and the two watchlist tool names are fixed in the bundle.
   * An entry that is not a tool is dropped, so one bad entry cannot break the sidebar or a lookup by name.
   */
  async listTools(): Promise<McpTool[]> {
    const result = await this.rpc("tools/list", undefined);
    if (!isRecord(result) || !Array.isArray(result.tools)) {
      throw new Error("the server returned a tools/list answer without a tools array");
    }
    return result.tools.filter(isTool);
  }

  /**
   * Calls one tool and returns its JSON body.
   * Text that is not JSON comes back as the raw string.
   * An isError answer throws ToolError with the server's message.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.rpc("tools/call", { name, arguments: args });
    if (!isRecord(result) || !Array.isArray(result.content)) {
      throw new Error(`the server returned no content for ${name}`);
    }
    const first: unknown = result.content[0];
    const text = isRecord(first) && first.type === "text" && typeof first.text === "string" ? first.text : undefined;
    if (result.isError === true) {
      throw new ToolError(name, text ?? `${name} failed.`);
    }
    if (text === undefined) {
      throw new Error(`the server returned no text content for ${name}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async rpc(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    const message: Record<string, unknown> = { jsonrpc: "2.0", id: this.nextId++, method };
    if (params !== undefined) {
      message.params = params;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { ...this.headers },
        body: JSON.stringify(message),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err?.name === "TimeoutError") {
        throw new Error(`request timed out after ${this.timeoutMs} ms`);
      }
      throw new Error(`request failed: ${err?.message ?? String(e)}`);
    }

    this.reportRateLimit(res.headers);

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new RpcError(`the server returned an unreadable answer (HTTP ${res.status})`, res.status);
    }

    const error = isRecord(body) ? body.error : undefined;
    if (isRecord(error)) {
      const errMessage = typeof error.message === "string" ? error.message : `HTTP ${res.status}`;
      if (typeof error.code === "number") {
        const data = isRecord(error.data) ? error.data : {};
        const retryAfter = nonNegative(data.retry_after_seconds) ?? nonNegative(finiteHeader(res.headers, "Retry-After"));
        throw new RpcError(errMessage, res.status, error.code, undefined, retryAfter);
      }
      const restCode = typeof error.code === "string" ? error.code : undefined;
      const retryAfter = nonNegative(finiteHeader(res.headers, "Retry-After"));
      throw new RpcError(errMessage, res.status, undefined, restCode, retryAfter);
    }
    if (!res.ok || !isRecord(body) || !("result" in body)) {
      throw new RpcError(`request failed (HTTP ${res.status})`, res.status);
    }
    return body.result;
  }

  private reportRateLimit(headers: Headers): void {
    if (!this.onRateLimit) {
      return;
    }
    const limit = finiteHeader(headers, "X-RateLimit-Limit");
    const remaining = finiteHeader(headers, "X-RateLimit-Remaining");
    const resetAt = finiteHeader(headers, "X-RateLimit-Reset-Machine");
    if (limit === undefined || remaining === undefined || resetAt === undefined) {
      return;
    }
    this.onRateLimit({ limit, remaining, resetAt });
  }
}

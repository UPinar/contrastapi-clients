import { McpTool, isTool, normalizeBaseUrl } from "../mcp/client";

/**
 * KeyValueStore is the key-value store the cache writes to.
 * vscode's Memento fits this shape, so this module needs no vscode import and runs in plain tests.
 */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** TOOL_CACHE_MAX_AGE_MS is how long a stored tool list counts as fresh: 24 hours. */
export const TOOL_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** CachedTools holds one stored tool list and the time it was fetched. */
export interface CachedTools {
  tools: McpTool[];
  fetchedAtMs: number;
}

const KEY_PREFIX = "contrastapi.toolCache:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCachedTools(value: unknown): value is CachedTools {
  return (
    isRecord(value)                       &&
    typeof value.fetchedAtMs === "number" &&
    Number.isFinite(value.fetchedAtMs)    &&
    Array.isArray(value.tools)            &&
    value.tools.every(isTool)
  );
}

/**
 * Keeps the last tools/list answer of one server.
 * The extension can then show its commands at start-up without waiting for the network.
 * The storage key holds the normalized base URL, so two servers never share an entry.
 */
export class ToolCache {
  private readonly store: KeyValueStore;
  private readonly key: string;

  constructor(store: KeyValueStore, baseUrl: string) {
    this.store = store;
    this.key = KEY_PREFIX + normalizeBaseUrl(baseUrl);
  }

  /**
   * Returns the stored entry.
   * A value with the wrong shape reads as undefined.
   * An older extension version or a corrupt store then causes a refetch, not a crash.
   */
  readToolCache(): CachedTools | undefined {
    const value = this.store.get<unknown>(this.key);
    return isCachedTools(value) ? value : undefined;
  }

  /**
   * Tells whether the tool list should be fetched again.
   * An entry is stale from the moment its age reaches TOOL_CACHE_MAX_AGE_MS.
   * A fetch time in the future also counts as stale, so a clock moved back cannot pin an old list.
   */
  isToolCacheStale(nowMs: number): boolean {
    const entry = this.readToolCache();
    if (!entry) {
      return true;
    }
    const age = nowMs - entry.fetchedAtMs;
    return age < 0 || age >= TOOL_CACHE_MAX_AGE_MS;
  }

  /** Stores a fresh tool list with the time it was fetched. */
  saveToolCache(tools: McpTool[], nowMs: number): PromiseLike<void> {
    const entry: CachedTools = { tools, fetchedAtMs: nowMs };
    return this.store.update(this.key, entry);
  }
}

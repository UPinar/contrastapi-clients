import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { KeyValueStore, TOOL_CACHE_MAX_AGE_MS, ToolCache } from "../../src/cache/toolCache";
import { McpTool } from "../../src/mcp/client";

const SNAPSHOT_PATH = path.join(__dirname, "../../../claude-desktop-extension/tools_list.json");
const SNAPSHOT_TOOLS = (
  JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as { result: { tools: McpTool[] } }
).result.tools;

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  update(key: string, value: unknown): PromiseLike<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

const PROD = "https://api.contrastcyber.com";
const LOCAL = "http://localhost:8080";
const T0 = 1767225600000;

let passed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

async function main(): Promise<void> {
  console.log("toolCache.test.ts");

  await test("max age is 24 hours", () => {
    assert.strictEqual(TOOL_CACHE_MAX_AGE_MS, 86_400_000);
  });

  await test("empty store: readToolCache() undefined and isToolCacheStale() true", () => {
    const cache = new ToolCache(new MemoryStore(), PROD);
    assert.strictEqual(cache.readToolCache(), undefined);
    assert.strictEqual(cache.isToolCacheStale(T0), true);
  });

  await test("saveToolCache then readToolCache returns the tools and the fetch time", async () => {
    const cache = new ToolCache(new MemoryStore(), PROD);
    await cache.saveToolCache(SNAPSHOT_TOOLS, T0);
    const got = cache.readToolCache();
    assert.ok(got);
    assert.deepStrictEqual(got.tools, SNAPSHOT_TOOLS);
    assert.strictEqual(got.fetchedAtMs, T0);
  });

  await test("age = max − 1 is fresh, age = max is stale, age 0 is fresh", async () => {
    const cache = new ToolCache(new MemoryStore(), PROD);
    await cache.saveToolCache(SNAPSHOT_TOOLS, T0);
    assert.strictEqual(cache.isToolCacheStale(T0), false);
    assert.strictEqual(cache.isToolCacheStale(T0 + TOOL_CACHE_MAX_AGE_MS - 1), false);
    assert.strictEqual(cache.isToolCacheStale(T0 + TOOL_CACHE_MAX_AGE_MS), true);
    assert.strictEqual(cache.isToolCacheStale(T0 + TOOL_CACHE_MAX_AGE_MS + 1), true);
  });

  await test("a fetch time in the future (clock moved back) reads as stale", async () => {
    const cache = new ToolCache(new MemoryStore(), PROD);
    await cache.saveToolCache(SNAPSHOT_TOOLS, T0);
    assert.strictEqual(cache.isToolCacheStale(T0 - 1), true);
  });

  await test("two base URLs never share an entry", async () => {
    const store = new MemoryStore();
    const prod = new ToolCache(store, PROD);
    const local = new ToolCache(store, LOCAL);
    await prod.saveToolCache(SNAPSHOT_TOOLS, T0);
    assert.strictEqual(local.readToolCache(), undefined);
    assert.strictEqual(local.isToolCacheStale(T0), true);
    const one = SNAPSHOT_TOOLS.slice(0, 1);
    await local.saveToolCache(one, T0 + 5000);
    assert.strictEqual(store.data.size, 2);
    assert.deepStrictEqual(prod.readToolCache()?.tools, SNAPSHOT_TOOLS);
    assert.strictEqual(prod.readToolCache()?.fetchedAtMs, T0);
    assert.deepStrictEqual(local.readToolCache()?.tools, one);
    assert.strictEqual(local.readToolCache()?.fetchedAtMs, T0 + 5000);
  });

  await test("the storage key contains the normalized base URL", async () => {
    const store = new MemoryStore();
    await new ToolCache(store, `${PROD}//`).saveToolCache(SNAPSHOT_TOOLS, T0);
    const keys = [...store.data.keys()];
    assert.strictEqual(keys.length, 1);
    assert.ok(keys[0].includes(PROD), keys[0]);
    assert.ok(!keys[0].includes(`${PROD}/`), keys[0]);
  });

  await test("trailing slashes reach the same entry", async () => {
    const store = new MemoryStore();
    await new ToolCache(store, `${PROD}/`).saveToolCache(SNAPSHOT_TOOLS, T0);
    assert.strictEqual(new ToolCache(store, PROD).readToolCache()?.fetchedAtMs, T0);
  });

  const badShapes: Array<[string, unknown]> = [
    ["null", null],
    ["a string", "tools"],
    ["tools not an array", { tools: "x", fetchedAtMs: T0 }],
    ["fetchedAtMs a string", { tools: [], fetchedAtMs: String(T0) }],
    ["fetchedAtMs missing", { tools: [] }],
    ["fetchedAtMs NaN", { tools: [], fetchedAtMs: Number.NaN }],
    ["a tool without a name", { tools: [{ inputSchema: { type: "object" } }], fetchedAtMs: T0 }],
    ["a tool with a numeric name", { tools: [{ name: 1, inputSchema: { type: "object" } }], fetchedAtMs: T0 }],
    ["a tool without inputSchema", { tools: [{ name: "health" }], fetchedAtMs: T0 }],
    ["a null tool", { tools: [null], fetchedAtMs: T0 }],
  ];
  for (const [label, value] of badShapes) {
    await test(`stored value with the wrong shape (${label}) reads as undefined and stale`, async () => {
      const store = new MemoryStore();
      const cache = new ToolCache(store, PROD);
      await cache.saveToolCache(SNAPSHOT_TOOLS, T0);
      const key = [...store.data.keys()][0];
      store.data.set(key, value);
      assert.strictEqual(cache.readToolCache(), undefined);
      assert.strictEqual(cache.isToolCacheStale(T0), true);
    });
  }

  await test("an empty tool list with a valid time is a valid entry", async () => {
    const cache = new ToolCache(new MemoryStore(), PROD);
    await cache.saveToolCache([], T0);
    assert.deepStrictEqual(cache.readToolCache(), { tools: [], fetchedAtMs: T0 });
  });

  console.log(`\nAll ${passed} tool cache tests passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

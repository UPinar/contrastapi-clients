import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  MCP_CATEGORY_META_KEY,
  McpClient,
  McpClientOptions,
  McpTool,
  RateLimitInfo,
  RpcError,
  ToolError,
  isAllowedBaseUrl,
  isTrustedHost,
  toolCategory,
} from "../../src/mcp/client";
import { groupToolsByCategory } from "../../src/views/toolTree";

const SNAPSHOT_PATH = path.join(__dirname, "../../../claude-desktop-extension/tools_list.json");
const SNAPSHOT_TEXT = fs.readFileSync(SNAPSHOT_PATH, "utf8");
const SNAPSHOT_TOOLS = (JSON.parse(SNAPSHOT_TEXT) as { result: { tools: McpTool[] } }).result.tools;

const BASE = "https://api.contrastcyber.com";
const KEY = "fake-key-for-tests";
const UA = "contrastapi-vscode/9.9.9-test";

interface Call {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: { jsonrpc: string; id: number; method: string; params?: Record<string, unknown> };
}

type Reply = () => Response | Promise<Response>;

function fakeFetch(calls: Call[], reply: Reply): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const safeInit = init ?? {};
    calls.push({
      url: String(url),
      init: safeInit,
      headers: { ...((safeInit.headers as Record<string, string>) ?? {}) },
      body: JSON.parse(String(safeInit.body)),
    });
    return reply();
  }) as typeof fetch;
}

function jsonReply(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
}

function rpcResult(result: unknown): unknown {
  return { jsonrpc: "2.0", id: 1, result };
}

function rpcErrorBody(code: number, message: string, data?: unknown): unknown {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id: 1, error };
}

function textResult(text: string, isError?: boolean): unknown {
  const result: Record<string, unknown> = { content: [{ type: "text", text }] };
  if (isError !== undefined) {
    result.isError = isError;
  }
  return rpcResult(result);
}

function makeClient(
  calls: Call[],
  reply: Reply,
  extra: Partial<McpClientOptions> = {},
): McpClient {
  return new McpClient({
    baseUrl: BASE,
    apiKey: KEY,
    userAgent: UA,
    fetchImpl: fakeFetch(calls, reply),
    ...extra,
  });
}

async function expectReject<E extends Error>(
  promise: Promise<unknown>,
  ctor: new (...args: never[]) => E,
): Promise<E> {
  try {
    await promise;
  } catch (e) {
    assert.ok(e instanceof ctor, `expected ${ctor.name}, got ${String(e)}`);
    return e as E;
  }
  throw new assert.AssertionError({ message: `expected a ${ctor.name} rejection` });
}

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
  console.log("mcpClient.test.ts");

  await test("listTools POSTs tools/list to <base>/mcp and returns the snapshot tools", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, () => new Response(SNAPSHOT_TEXT, { status: 200 }), {
      baseUrl: `${BASE}///`,
    });
    const tools = await client.listTools();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, `${BASE}/mcp`);
    assert.strictEqual(calls[0].init.method, "POST");
    assert.strictEqual(calls[0].body.jsonrpc, "2.0");
    assert.strictEqual(calls[0].body.method, "tools/list");
    assert.strictEqual(tools.length, SNAPSHOT_TOOLS.length);
    assert.deepStrictEqual(tools, SNAPSHOT_TOOLS);
  });

  await test("listTools keeps only the entries that are tools, so a lookup by name and the grouping still work", async () => {
    const calls: Call[] = [];
    const valid: McpTool = { name: "health", inputSchema: { type: "object" } };
    const client = makeClient(calls, jsonReply(200, rpcResult({ tools: [null, 5, {}, valid] })));
    const tools = await client.listTools();
    assert.deepStrictEqual(tools, [valid]);
    assert.strictEqual(tools.find((t) => t.name === "health"), tools[0], "lookup by name, as ToolSession.findTool does");
    assert.strictEqual(tools.find((t) => t.name === "missing"), undefined, "lookup of a missing name");
    assert.deepStrictEqual(groupToolsByCategory(tools), [{ category: "Other", tools: [valid] }]);
  });

  await test("listTools drops a tool whose title, description, _meta or annotations has the wrong type", async () => {
    const calls: Call[] = [];
    const full: McpTool = { name: "ok", title: "OK", description: "Fine.", inputSchema: {}, _meta: {}, annotations: {} };
    const bad = [
      { name: "a", inputSchema: {}, title: 7 },
      { name: "b", inputSchema: {}, description: 5 },
      { name: "c", inputSchema: {}, _meta: "x" },
      { name: "d", inputSchema: {}, annotations: 5 },
    ];
    const client = makeClient(calls, jsonReply(200, rpcResult({ tools: [...bad, full] })));
    assert.deepStrictEqual(await client.listTools(), [full]);
  });

  await test("request headers: JSON content type, JSON accept, User-Agent", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("{}")));
    await client.callTool("health", {});
    assert.strictEqual(calls[0].headers["Content-Type"], "application/json");
    assert.strictEqual(calls[0].headers["Accept"], "application/json");
    assert.strictEqual(calls[0].headers["User-Agent"], UA);
  });

  await test("no MCP-Protocol-Version header is sent (any case)", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("{}")));
    await client.callTool("health", {});
    await client.listTools().catch(() => undefined);
    for (const call of calls) {
      const names = Object.keys(call.headers).map((h) => h.toLowerCase());
      assert.ok(!names.includes("mcp-protocol-version"), `headers: ${names.join(",")}`);
    }
  });

  await test("redirect is 'error' and a signal is attached", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("{}")));
    await client.callTool("health", {});
    assert.strictEqual(calls[0].init.redirect, "error");
    assert.ok(calls[0].init.signal instanceof AbortSignal, "signal");
  });

  await test("timeout: default 30000 ms, timeoutMs overrides it", async () => {
    const seen: number[] = [];
    const realTimeout = AbortSignal.timeout;
    AbortSignal.timeout = ((ms: number) => {
      seen.push(ms);
      return realTimeout.call(AbortSignal, ms);
    }) as typeof AbortSignal.timeout;
    try {
      const calls: Call[] = [];
      await makeClient(calls, jsonReply(200, textResult("{}"))).callTool("health", {});
      await makeClient(calls, jsonReply(200, textResult("{}")), { timeoutMs: 1234 }).callTool(
        "health",
        {},
      );
    } finally {
      AbortSignal.timeout = realTimeout;
    }
    assert.deepStrictEqual(seen, [30000, 1234]);
  });

  await test("JSON-RPC id increases by one per call on one client", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("{}")));
    await client.callTool("health", {});
    await client.callTool("health", {});
    await client.callTool("health", {});
    assert.strictEqual(typeof calls[0].body.id, "number");
    assert.strictEqual(calls[1].body.id, calls[0].body.id + 1);
    assert.strictEqual(calls[2].body.id, calls[1].body.id + 1);
  });

  await test("callTool sends tools/call {name, arguments} and returns parsed JSON", async () => {
    const calls: Call[] = [];
    const payload = { cve_id: "CVE-2021-44228", cvss_v3: 10, in_kev: true };
    const client = makeClient(calls, jsonReply(200, textResult(JSON.stringify(payload))));
    const out = await client.callTool("cve_lookup", { cve_id: "CVE-2021-44228", include_ghsa: true });
    assert.strictEqual(calls[0].body.method, "tools/call");
    assert.deepStrictEqual(calls[0].body.params, {
      name: "cve_lookup",
      arguments: { cve_id: "CVE-2021-44228", include_ghsa: true },
    });
    assert.deepStrictEqual(out, payload);
  });

  await test("callTool returns the raw text when it is not JSON", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("plain words, not {json")));
    assert.strictEqual(await client.callTool("health", {}), "plain words, not {json");
  });

  await test("isError:true → ToolError with the content text and tool name", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("cve_id must look like CVE-YYYY-NNNN", true)));
    const err = await expectReject(client.callTool("cve_lookup", { cve_id: "x" }), ToolError);
    assert.ok(err instanceof Error, "an Error");
    assert.ok(!(err instanceof RpcError), "not an RpcError");
    assert.strictEqual(err.message, "cve_id must look like CVE-YYYY-NNNN");
    assert.strictEqual(err.toolName, "cve_lookup");
  });

  await test("isError:false is a normal result", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("[1,2]", false)));
    assert.deepStrictEqual(await client.callTool("health", {}), [1, 2]);
  });

  await test("content that is not text is refused, and isError without text names the tool", async () => {
    const calls: Call[] = [];
    const image = makeClient(calls, jsonReply(200, rpcResult({ content: [{ type: "image", text: "{}" }] })));
    await assert.rejects(image.callTool("health", {}), /no text content/);
    const empty = makeClient(calls, jsonReply(200, rpcResult({ content: [], isError: true })));
    const err = await expectReject(empty.callTool("health", {}), ToolError);
    assert.strictEqual(err.message, "health failed.");
  });

  for (const [status, body] of [
    [500, textResult("{}")],
    [200, { jsonrpc: "2.0", id: 1 }],
  ] as const) {
    await test(`HTTP ${status} ${status === 200 ? "without result" : "with a result"} → RpcError with status ${status}`, async () => {
      const calls: Call[] = [];
      const client = makeClient(calls, jsonReply(status, body));
      const err = await expectReject(client.callTool("health", {}), RpcError);
      assert.strictEqual(err.status, status);
    });
  }

  for (const code of [-32700, -32600, -32601, -32602, -32603]) {
    await test(`HTTP 200 + JSON-RPC error ${code} → RpcError(code ${code}, status 200)`, async () => {
      const calls: Call[] = [];
      const client = makeClient(calls, jsonReply(200, rpcErrorBody(code, `message for ${code}`)));
      const err = await expectReject(client.callTool("cve_lookup", {}), RpcError);
      assert.strictEqual(err.code, code);
      assert.strictEqual(err.status, 200);
      assert.strictEqual(err.message, `message for ${code}`);
      assert.strictEqual(err.restCode, undefined);
      assert.strictEqual(err.retryAfter, undefined);
    });
  }

  for (const code of [-32001, -32004]) {
    await test(`HTTP 401 + ${code} → RpcError(code ${code}, status 401), key not in message`, async () => {
      const calls: Call[] = [];
      const client = makeClient(calls, jsonReply(401, rpcErrorBody(code, "invalid api key")));
      const err = await expectReject(client.listTools(), RpcError);
      assert.strictEqual(err.code, code);
      assert.strictEqual(err.status, 401);
      assert.ok(!err.message.includes(KEY), "key in message");
      assert.ok(!String(err.stack).includes(KEY), "key in stack");
    });
  }

  await test("HTTP 429 + -32000: retryAfter from data.retry_after_seconds wins over the header", async () => {
    const calls: Call[] = [];
    const client = makeClient(
      calls,
      jsonReply(
        429,
        rpcErrorBody(-32000, "rate limit exceeded", { retry_after_seconds: 37 }),
        { "Retry-After": "99" },
      ),
    );
    const err = await expectReject(client.callTool("health", {}), RpcError);
    assert.strictEqual(err.code, -32000);
    assert.strictEqual(err.status, 429);
    assert.strictEqual(err.message, "rate limit exceeded");
    assert.strictEqual(err.retryAfter, 37);
  });

  await test("HTTP 429 without data: retryAfter falls back to the Retry-After header", async () => {
    const calls: Call[] = [];
    const client = makeClient(
      calls,
      jsonReply(429, rpcErrorBody(-32000, "rate limit exceeded"), { "Retry-After": "41" }),
    );
    const err = await expectReject(client.callTool("health", {}), RpcError);
    assert.strictEqual(err.retryAfter, 41);
  });

  await test("negative data.retry_after_seconds is ignored, header used", async () => {
    const calls: Call[] = [];
    const client = makeClient(
      calls,
      jsonReply(429, rpcErrorBody(-32000, "x", { retry_after_seconds: -1 }), { "Retry-After": "12" }),
    );
    assert.strictEqual((await expectReject(client.callTool("health", {}), RpcError)).retryAfter, 12);
  });

  await test("retry_after_seconds 0 is kept (≥ 0 boundary)", async () => {
    const calls: Call[] = [];
    const client = makeClient(
      calls,
      jsonReply(429, rpcErrorBody(-32000, "x", { retry_after_seconds: 0 }), { "Retry-After": "12" }),
    );
    assert.strictEqual((await expectReject(client.callTool("health", {}), RpcError)).retryAfter, 0);
  });

  for (const header of ["Wed, 21 Oct 2026 07:28:00 GMT", "-3", "", "abc"]) {
    await test(`Retry-After ${JSON.stringify(header)} without data → retryAfter undefined`, async () => {
      const calls: Call[] = [];
      const client = makeClient(
        calls,
        jsonReply(429, rpcErrorBody(-32000, "x"), { "Retry-After": header }),
      );
      assert.strictEqual(
        (await expectReject(client.callTool("health", {}), RpcError)).retryAfter,
        undefined,
      );
    });
  }

  await test("HTTP 503 + -32003 → RpcError(code -32003, status 503, retryAfter 5)", async () => {
    const calls: Call[] = [];
    const client = makeClient(
      calls,
      jsonReply(503, rpcErrorBody(-32003, "service busy", { retry_after_seconds: 5 }), {
        "Retry-After": "5",
      }),
    );
    const err = await expectReject(client.callTool("health", {}), RpcError);
    assert.strictEqual(err.code, -32003);
    assert.strictEqual(err.status, 503);
    assert.strictEqual(err.retryAfter, 5);
  });

  const restRows: Array<[number, string]> = [
    [400, "invalid_json"],
    [405, "method_not_allowed"],
    [413, "payload_too_large"],
    [414, "uri_too_long"],
    [431, "headers_too_large"],
    [501, "not_implemented"],
  ];
  for (const [status, restCode] of restRows) {
    await test(`HTTP ${status} REST-shaped body → RpcError(code undefined, restCode ${restCode})`, async () => {
      const calls: Call[] = [];
      const client = makeClient(
        calls,
        jsonReply(status, { error: { code: restCode, message: `rest ${status}` } }),
      );
      const err = await expectReject(client.callTool("health", {}), RpcError);
      assert.strictEqual(err.code, undefined);
      assert.strictEqual(err.status, status);
      assert.strictEqual(err.restCode, restCode);
      assert.strictEqual(err.message, `rest ${status}`);
    });
  }

  await test("REST-shaped 429 → retryAfter from the Retry-After header", async () => {
    const calls: Call[] = [];
    const client = makeClient(
      calls,
      jsonReply(429, { error: { code: "rate_limited", message: "m" } }, { "Retry-After": "7" }),
    );
    const err = await expectReject(client.callTool("health", {}), RpcError);
    assert.strictEqual(err.restCode, "rate_limited");
    assert.strictEqual(err.retryAfter, 7);
  });

  await test("non-JSON error body (HTTP 502) → RpcError(code undefined, status 502)", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, () => new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await expectReject(client.callTool("health", {}), RpcError);
    assert.strictEqual(err.code, undefined);
    assert.strictEqual(err.restCode, undefined);
    assert.strictEqual(err.status, 502);
  });

  await test("network failure → plain Error (not RpcError) with a readable message, no key", async () => {
    const client = new McpClient({
      baseUrl: BASE,
      apiKey: KEY,
      userAgent: UA,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    const err = await expectReject(client.callTool("health", {}), Error);
    assert.ok(!(err instanceof RpcError), "not an RpcError");
    assert.ok(!(err instanceof ToolError), "not a ToolError");
    assert.ok(err.message.length > 0, "empty message");
    assert.ok(err.message.includes("fetch failed"), err.message);
    assert.ok(!err.message.includes(KEY), "key in message");
  });

  await test("timeout → plain Error whose message says it timed out, no key", async () => {
    const client = new McpClient({
      baseUrl: BASE,
      apiKey: KEY,
      userAgent: UA,
      timeoutMs: 2500,
      fetchImpl: (async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }) as typeof fetch,
    });
    const err = await expectReject(client.callTool("health", {}), Error);
    assert.ok(!(err instanceof RpcError), "not an RpcError");
    assert.ok(/timed out/i.test(err.message), err.message);
    assert.ok(err.message.includes("2500"), err.message);
    assert.ok(!err.message.includes(KEY), "key in message");
  });

  const RL_HEADERS = {
    "X-RateLimit-Limit": "50",
    "X-RateLimit-Remaining": "7",
    "X-RateLimit-Reset-Machine": "1767225600",
    "X-RateLimit-Reset-Human": "00:00:00",
  };

  await test("onRateLimit gets {limit 50, remaining 7, resetAt 1767225600}", async () => {
    const calls: Call[] = [];
    const seen: RateLimitInfo[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("{}"), RL_HEADERS), {
      onRateLimit: (info) => seen.push(info),
    });
    await client.callTool("health", {});
    assert.deepStrictEqual(seen, [{ limit: 50, remaining: 7, resetAt: 1767225600 }]);
  });

  await test("onRateLimit is also called on a 429 that carries the headers", async () => {
    const calls: Call[] = [];
    const seen: RateLimitInfo[] = [];
    const client = makeClient(
      calls,
      jsonReply(429, rpcErrorBody(-32000, "rate limit exceeded", { retry_after_seconds: 30 }), {
        ...RL_HEADERS,
        "X-RateLimit-Remaining": "0",
      }),
      { onRateLimit: (info) => seen.push(info) },
    );
    await expectReject(client.callTool("health", {}), RpcError);
    assert.deepStrictEqual(seen, [{ limit: 50, remaining: 0, resetAt: 1767225600 }]);
  });

  await test("onRateLimit is also called on a non-JSON 502 that carries the headers", async () => {
    const calls: Call[] = [];
    const seen: RateLimitInfo[] = [];
    const client = makeClient(calls, () => new Response("<html>", { status: 502, headers: RL_HEADERS }), {
      onRateLimit: (info) => seen.push(info),
    });
    await expectReject(client.callTool("health", {}), RpcError);
    assert.deepStrictEqual(seen, [{ limit: 50, remaining: 7, resetAt: 1767225600 }]);
  });

  await test("onRateLimit not called when the headers are absent (zero-cost / 401 / 503)", async () => {
    const calls: Call[] = [];
    const seen: RateLimitInfo[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("{}")), {
      onRateLimit: (info) => seen.push(info),
    });
    await client.callTool("health", {});
    assert.strictEqual(seen.length, 0);
  });

  const partials: Array<[string, Record<string, string>]> = [
    ["no Limit", { "X-RateLimit-Remaining": "7", "X-RateLimit-Reset-Machine": "1767225600" }],
    ["no Remaining", { "X-RateLimit-Limit": "50", "X-RateLimit-Reset-Machine": "1767225600" }],
    ["no Reset-Machine", { "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "7", "X-RateLimit-Reset-Human": "00:00:00" }],
    ["non-numeric Remaining", { ...RL_HEADERS, "X-RateLimit-Remaining": "seven" }],
    ["empty Limit", { ...RL_HEADERS, "X-RateLimit-Limit": "" }],
    ["Infinity Reset-Machine", { ...RL_HEADERS, "X-RateLimit-Reset-Machine": "Infinity" }],
  ];
  for (const [label, headers] of partials) {
    await test(`onRateLimit not called with partial headers: ${label}`, async () => {
      const calls: Call[] = [];
      const seen: RateLimitInfo[] = [];
      const client = makeClient(calls, jsonReply(200, textResult("{}"), headers), {
        onRateLimit: (info) => seen.push(info),
      });
      await client.callTool("health", {});
      assert.strictEqual(seen.length, 0);
    });
  }

  await test("missing onRateLimit callback is fine when headers are present", async () => {
    const calls: Call[] = [];
    const client = makeClient(calls, jsonReply(200, textResult("{\"ok\":1}"), RL_HEADERS));
    assert.deepStrictEqual(await client.callTool("health", {}), { ok: 1 });
  });

  const keySent: string[] = [
    "https://api.contrastcyber.com",
    "https://api.contrastcyber.com/",
    "http://localhost:8080",
    "http://127.0.0.1:8080/",
    "http://[::1]:3000",
    "https://localhost",
  ];
  for (const base of keySent) {
    await test(`X-API-Key is sent to ${base}`, async () => {
      const calls: Call[] = [];
      const client = makeClient(calls, jsonReply(200, textResult("{}")), { baseUrl: base });
      await client.callTool("health", {});
      assert.strictEqual(calls[0].headers["X-API-Key"], KEY);
    });
  }

  const keyNotSent: string[] = [
    "https://api.contrastcyber.com.evil.com",
    "https://evilapi.contrastcyber.com",
    "https://contrastcyber.com",
    "https://example.com",
    "https://api.contrastcyber.com.",
  ];
  for (const base of keyNotSent) {
    await test(`X-API-Key is NOT sent to ${base}`, async () => {
      const calls: Call[] = [];
      const client = makeClient(calls, jsonReply(200, textResult("{}")), { baseUrl: base });
      await client.callTool("health", {});
      const names = Object.keys(calls[0].headers).map((h) => h.toLowerCase());
      assert.ok(!names.includes("x-api-key"), `headers: ${names.join(",")}`);
      assert.strictEqual(calls[0].url, `${base.replace(/\/+$/, "")}/mcp`);
    });
  }

  for (const apiKey of [undefined, ""]) {
    await test(`no X-API-Key when apiKey is ${JSON.stringify(apiKey)} (anonymous)`, async () => {
      const calls: Call[] = [];
      const client = makeClient(calls, jsonReply(200, textResult("{}")), { apiKey });
      await client.callTool("health", {});
      const names = Object.keys(calls[0].headers).map((h) => h.toLowerCase());
      assert.ok(!names.includes("x-api-key"), `headers: ${names.join(",")}`);
    });
  }

  const refused: string[] = [
    "http://api.contrastcyber.com",
    "http://example.com",
    "http://localhost.evil.com",
    "ftp://api.contrastcyber.com",
    "not a url",
    "",
  ];
  for (const base of refused) {
    await test(`constructor refuses base URL ${JSON.stringify(base)}`, () => {
      assert.strictEqual(isAllowedBaseUrl(base), false);
      assert.throws(
        () => new McpClient({ baseUrl: base, apiKey: KEY, userAgent: UA, fetchImpl: fetch }),
        (e: unknown) => e instanceof Error && !e.message.includes(KEY),
      );
    });
  }

  await test("isAllowedBaseUrl accepts https anywhere and http only to localhost", () => {
    assert.strictEqual(isAllowedBaseUrl("https://example.com"), true);
    assert.strictEqual(isAllowedBaseUrl("https://api.contrastcyber.com"), true);
    assert.strictEqual(isAllowedBaseUrl("http://localhost"), true);
    assert.strictEqual(isAllowedBaseUrl("http://127.0.0.1:8080"), true);
    assert.strictEqual(isAllowedBaseUrl("http://[::1]:8080"), true);
    assert.strictEqual(isAllowedBaseUrl("http://127.0.0.2"), false);
  });

  await test("isTrustedHost: exact hostname or localhost only", () => {
    assert.strictEqual(isTrustedHost("https://api.contrastcyber.com"), true);
    assert.strictEqual(isTrustedHost("https://API.ContrastCyber.com/"), true);
    assert.strictEqual(isTrustedHost("http://localhost:8080"), true);
    assert.strictEqual(isTrustedHost("http://127.0.0.1"), true);
    assert.strictEqual(isTrustedHost("http://[::1]:1"), true);
    assert.strictEqual(isTrustedHost("https://api.contrastcyber.com.evil.com"), false);
    assert.strictEqual(isTrustedHost("https://evilapi.contrastcyber.com"), false);
    assert.strictEqual(isTrustedHost("https://x.api.contrastcyber.com"), false);
    assert.strictEqual(isTrustedHost("not a url"), false);
  });

  await test("the local hosts are exactly localhost, 127.0.0.1 and [::1]: allowed over http and trusted", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      assert.strictEqual(isAllowedBaseUrl(`http://${host}:8714`), true, `allowed: ${host}`);
      assert.strictEqual(isTrustedHost(`http://${host}:8714`), true, `trusted: ${host}`);
    }
    for (const host of ["0.0.0.0", "evillocalhost", "localhost.evil.test", "127.0.0.2", "api.contrastcyber.com.evil.test"]) {
      assert.strictEqual(isAllowedBaseUrl(`http://${host}:8714`), false, `allowed over http: ${host}`);
      assert.strictEqual(isTrustedHost(`http://${host}:8714`), false, `trusted over http: ${host}`);
      assert.strictEqual(isTrustedHost(`https://${host}`), false, `trusted over https: ${host}`);
    }
  });

  await test("toolCategory reads _meta['com.contrastcyber/category'] from snapshot tools", () => {
    assert.strictEqual(MCP_CATEGORY_META_KEY, "com.contrastcyber/category");
    const health = SNAPSHOT_TOOLS.find((t) => t.name === "health") as McpTool;
    const bulk = SNAPSHOT_TOOLS.find((t) => t.name === "package_check_bulk") as McpTool;
    assert.strictEqual(toolCategory(health), "Operations");
    assert.strictEqual(toolCategory(bulk), "Package Vulnerabilities (SBOM)");
    const categories = new Set(SNAPSHOT_TOOLS.map((t) => toolCategory(t)));
    assert.strictEqual(categories.size, 8);
    assert.ok(!categories.has(undefined), "a tool without a category");
  });

  await test("toolCategory is undefined without _meta or with a non-string value", () => {
    const base: McpTool = { name: "x", inputSchema: { type: "object" } };
    assert.strictEqual(toolCategory(base), undefined);
    assert.strictEqual(toolCategory({ ...base, _meta: {} }), undefined);
    assert.strictEqual(toolCategory({ ...base, _meta: { [MCP_CATEGORY_META_KEY]: 3 } }), undefined);
  });

  console.log(`\nAll ${passed} MCP client tests passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import * as assert from "assert";
import {
  CLIENT_STARTING_MESSAGE,
  describeError,
  toolListRefreshWarning,
  toolListUnavailableWarning,
} from "../../src/forms/errorNotice";
import { McpClient, RpcError, ToolError } from "../../src/mcp/client";

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


const KEY = "fake-key-for-tests";

function clientFailing(error: () => never, timeoutMs?: number): McpClient {
  return new McpClient({
    baseUrl: "https://api.contrastcyber.com",
    apiKey: KEY,
    userAgent: "contrastapi-vscode/9.9.9-test",
    timeoutMs,
    fetchImpl: (async () => error()) as typeof fetch,
  });
}

function clientAnswering(status: number, text: string): McpClient {
  return new McpClient({
    baseUrl: "https://api.contrastcyber.com",
    apiKey: KEY,
    userAgent: "contrastapi-vscode/9.9.9-test",
    fetchImpl: (async () => new Response(text, { status })) as typeof fetch,
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new assert.AssertionError({ message: "expected a rejection" });
}

function brandCount(text: string): number {
  return text.split("ContrastAPI").length - 1;
}

function constructorError(baseUrl: string): string {
  try {
    new McpClient({ baseUrl, userAgent: "contrastapi-vscode/9.9.9-test" });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new assert.AssertionError({ message: "expected the constructor to throw" });
}

async function main(): Promise<void> {
  console.log("errorNotice.test.ts");

  await test("a ToolError shows the server's text as it is", () => {
    const n = describeError(new ToolError("cve_lookup", "CVE-2031-40417 is not in the database."));
    assert.deepStrictEqual(n, { message: "CVE-2031-40417 is not in the database.", offerSetApiKey: false });
  });

  await test("401 says the key was rejected and offers Set API Key, without the server text", () => {
    const n = describeError(new RpcError("key fixture-key-0417 unknown", 401, -32001));
    assert.deepStrictEqual(n, { message: "API key rejected (invalid, revoked or expired)", offerSetApiKey: true });
  });

  await test("429 says the credits ran out and adds the wait when known", () => {
    assert.deepStrictEqual(describeError(new RpcError("x", 429, undefined, "rate_limited", 37)), {
      message: "Credit limit reached, retry in 37 s",
      offerSetApiKey: false,
    });
    assert.deepStrictEqual(describeError(new RpcError("x", 429)), {
      message: "Credit limit reached",
      offerSetApiKey: false,
    });
    assert.deepStrictEqual(describeError(new RpcError("x", 429, undefined, undefined, 0)), {
      message: "Credit limit reached",
      offerSetApiKey: false,
    });
  });

  await test("503 says the upstream is busy and adds the wait when known", () => {
    assert.deepStrictEqual(describeError(new RpcError("x", 503, undefined, undefined, 12)), {
      message: "Upstream busy, try again in 12 s",
      offerSetApiKey: false,
    });
    assert.deepStrictEqual(describeError(new RpcError("x", 503)), {
      message: "Upstream busy, try again later",
      offerSetApiKey: false,
    });
  });

  await test("another RpcError status shows the server message with a prefix", () => {
    assert.deepStrictEqual(describeError(new RpcError("Method not found", 400, -32601)), {
      message: "ContrastAPI error: Method not found",
      offerSetApiKey: false,
    });
    assert.deepStrictEqual(describeError(new RpcError("Bad gateway", 502)), {
      message: "ContrastAPI error: Bad gateway",
      offerSetApiKey: false,
    });
  });

  await test("a plain Error or a thrown string gets the same prefix", () => {
    assert.deepStrictEqual(describeError(new Error("socket hang up")), {
      message: "ContrastAPI error: socket hang up",
      offerSetApiKey: false,
    });
    assert.deepStrictEqual(describeError("timed out after 30000 ms"), {
      message: "ContrastAPI error: timed out after 30000 ms",
      offerSetApiKey: false,
    });
  });

  await test("the refresh warning for a network failure names ContrastAPI once", async () => {
    const err = await rejection(clientFailing(() => {
      throw new TypeError("fetch failed");
    }).listTools());
    const warning = toolListRefreshWarning(err);
    assert.strictEqual(
      warning,
      "ContrastAPI: could not refresh the tool list (request failed: fetch failed). The previous list stays in use.",
    );
    assert.strictEqual(brandCount(warning), 1, warning);
  });

  await test("every client failure gives one ContrastAPI in the refresh warning and in describeError, and no key", async () => {
    const failures: unknown[] = [
      await rejection(clientFailing(() => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }, 2500).listTools()),
      await rejection(clientAnswering(502, "<html>bad gateway</html>").listTools()),
      await rejection(clientAnswering(500, JSON.stringify({ jsonrpc: "2.0", id: 1 })).listTools()),
      await rejection(clientAnswering(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })).listTools()),
      await rejection(clientAnswering(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })).callTool("health", {})),
      await rejection(
        clientAnswering(200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "image" }] } })).callTool("health", {}),
      ),
      new Error(constructorError("http://example.com")),
      new Error(CLIENT_STARTING_MESSAGE),
    ];
    for (const err of failures) {
      const warning = toolListRefreshWarning(err);
      const message = describeError(err).message;
      assert.strictEqual(brandCount(warning), 1, warning);
      assert.strictEqual(brandCount(message), 1, message);
      assert.ok(!warning.includes(KEY) && !message.includes(KEY));
    }
  });

  await test("the client's own failure texts carry no ContrastAPI prefix", async () => {
    const network = await rejection(clientFailing(() => {
      throw new TypeError("fetch failed");
    }).callTool("health", {}));
    assert.strictEqual(describeError(network).message, "ContrastAPI error: request failed: fetch failed");
    const timeout = await rejection(clientFailing(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }, 2500).callTool("health", {}));
    assert.strictEqual(describeError(timeout).message, "ContrastAPI error: request timed out after 2500 ms");
    const unreadable = await rejection(clientAnswering(502, "<html>bad gateway</html>").listTools());
    assert.strictEqual(describeError(unreadable).message, "ContrastAPI error: the server returned an unreadable answer (HTTP 502)");
    assert.strictEqual(
      constructorError("http://example.com"),
      "The contrastapi.baseUrl setting must use https (http is allowed only for localhost).",
    );
  });

  await test("the refresh warning keeps the fixed texts of 401, 429 and 503", () => {
    assert.strictEqual(
      toolListRefreshWarning(new RpcError("x", 429, undefined, "rate_limited", 37)),
      "ContrastAPI: could not refresh the tool list (Credit limit reached, retry in 37 s). The previous list stays in use.",
    );
    assert.strictEqual(
      toolListRefreshWarning(new RpcError("key fixture-key-0417 unknown", 401, -32001)),
      "ContrastAPI: could not refresh the tool list (API key rejected (invalid, revoked or expired)). The previous list stays in use.",
    );
  });

  await test("the no-client warning names ContrastAPI once", () => {
    const warning = toolListUnavailableWarning(constructorError("ftp://example.com"));
    assert.strictEqual(
      warning,
      "ContrastAPI: cannot load the tool list. The contrastapi.baseUrl setting must use https (http is allowed only for localhost).",
    );
    assert.strictEqual(brandCount(toolListUnavailableWarning(CLIENT_STARTING_MESSAGE)), 1);
  });

  console.log(`\nAll ${passed} error notice tests passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

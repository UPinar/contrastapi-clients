// Status mapping, error body parsing, body cap, network errors, key privacy.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  ContrastAPI,
  ContrastAPIError,
  BadRequestError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  UpstreamError,
  APIConnectionError,
  APITimeoutError,
} from "../src/index.js";
import { fakeFetch, json, text, apiError, KEY } from "./fake_fetch.js";

async function failure(response, options = {}) {
  const fetch = fakeFetch(() => (typeof response === "function" ? response() : response));
  const client = new ContrastAPI({ fetch, ...options });
  let caught;
  try {
    await client.health();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "expected a rejection");
  return { error: caught, calls: fetch.calls.length };
}

describe("status -> class", () => {
  const map = [
    [400, BadRequestError],
    [401, AuthenticationError],
    [403, ContrastAPIError],
    [404, NotFoundError],
    [405, ContrastAPIError],
    [422, ContrastAPIError],
    [429, RateLimitError],
    [499, ContrastAPIError],
    [500, ContrastAPIError],
    [501, ContrastAPIError],
    [502, UpstreamError],
    [503, UpstreamError],
    [504, UpstreamError],
    [505, ContrastAPIError],
    [599, ContrastAPIError],
  ];
  for (const [status, cls] of map) {
    test(`${status} -> ${cls.name}`, async () => {
      const { error, calls } = await failure(() => apiError(status, "some_code", "some message"));
      assert.equal(error.constructor, cls);
      assert.ok(error instanceof ContrastAPIError);
      assert.ok(error instanceof Error);
      assert.equal(error.name, cls.name);
      assert.equal(error.status, status);
      assert.equal(error.code, "some_code");
      assert.equal(error.message, "some message");
      assert.equal(calls, 1);
    });
  }

  test("a 2xx other than 200 is a success", async () => {
    const fetch = fakeFetch(() => json(201, { made: 1 }));
    assert.deepEqual(await new ContrastAPI({ fetch }).health(), { made: 1 });
  });

  test("a 3xx that reaches the client is refused as a redirect", async () => {
    const { error } = await failure(() => json(302, { moved: true }, { Location: "https://evil.example/" }));
    assert.equal(error.constructor, APIConnectionError);
    assert.equal(error.message, "redirect refused");
    assert.equal(error.status, null);
  });

  test("299 is a success", async () => {
    const fetch = fakeFetch(() => json(299, { a: 1 }));
    assert.deepEqual(await new ContrastAPI({ fetch }).health(), { a: 1 });
  });
});

describe("error body", () => {
  test("error envelope gives code and message", async () => {
    const { error } = await failure(() => apiError(400, "invalid_cve_id", "cve_id must look like CVE-YYYY-NNNN"));
    assert.equal(error.code, "invalid_cve_id");
    assert.equal(error.message, "cve_id must look like CVE-YYYY-NNNN");
    assert.equal(error.retryAfter, null);
    assert.equal(error.rateLimit, null);
  });

  const noShape = [
    ["not JSON", () => text(400, "<html>bad</html>")],
    ["empty body", () => text(400, "")],
    ["detail only", () => json(400, { detail: "x" })],
    ["error is a string", () => json(400, { error: "boom" })],
    ["error is null", () => json(400, { error: null })],
    ["error is an array", () => json(400, { error: ["x"] })],
    ["top-level array", () => json(400, [{ error: { code: "c", message: "m" } }])],
    ["JSON null", () => json(400, null)],
  ];
  for (const [name, make] of noShape) {
    test(`${name} -> code null, message "HTTP 400"`, async () => {
      const { error } = await failure(make);
      assert.equal(error.constructor, BadRequestError);
      assert.equal(error.code, null);
      assert.equal(error.message, "HTTP 400");
    });
  }

  test("non-string code and message fall back", async () => {
    const { error } = await failure(() => json(404, { error: { code: 7, message: { x: 1 } } }));
    assert.equal(error.code, null);
    assert.equal(error.message, "HTTP 404");
  });

  test("message is capped at 300 characters", async () => {
    const { error } = await failure(() => apiError(400, "c", "m".repeat(299) + "XY"));
    assert.equal(error.message, "m".repeat(299) + "X");
    assert.equal(error.message.length, 300);
    const { error: e2 } = await failure(() => apiError(400, "c", "n".repeat(300)));
    assert.equal(e2.message, "n".repeat(300));
  });

  test("control characters are removed before the cap", async () => {
    const { error } = await failure(() => apiError(400, "c", "a\u0000b\u001fc\u007fd\ne\tf g\u0080h\u009fi\u00a0j"));
    assert.equal(error.message, "abcdef ghi\u00a0j");
    const { error: e2 } = await failure(() => apiError(400, "c", "\u0001".repeat(10) + "x".repeat(300)));
    assert.equal(e2.message, "x".repeat(300));
  });

  test("control characters are removed from the code too", async () => {
    const { error } = await failure(() => apiError(400, "bad\u001b[31mcode", "m"));
    assert.equal(error.code, "bad[31mcode");
  });
});

describe("Retry-After on an error", () => {
  const cases = [
    [undefined, null],
    ["0", 0],
    ["1", 1],
    ["3599", 3599],
    ["3600", 3600],
    ["3601", 3600],
    ["99999999999999999999", 3600],
    ["-1", null],
    ["1.5", null],
    ["", null],
    ["1e3", null],
    ["0x10", null],
    ["abc", null],
    ["Wed, 21 Oct 2026 07:28:00 GMT", null],
  ];
  for (const [header, seconds] of cases) {
    test(`Retry-After ${JSON.stringify(header)} -> ${seconds}`, async () => {
      const headers = header === undefined ? {} : { "Retry-After": header };
      const { error } = await failure(() => apiError(400, "c", "m", headers));
      assert.equal(error.retryAfter, seconds);
    });
  }
});

describe("2xx body", () => {
  test("non-JSON 200 -> ContrastAPIError with code null", async () => {
    const { error } = await failure(() => text(200, "<html>ok</html>"));
    assert.equal(error.constructor, ContrastAPIError);
    assert.equal(error.status, 200);
    assert.equal(error.code, null);
  });

  test("empty 200 -> ContrastAPIError", async () => {
    const { error } = await failure(() => text(200, ""));
    assert.equal(error.constructor, ContrastAPIError);
    assert.equal(error.code, null);
  });

  test("a body of exactly 16 MiB is read", async () => {
    const size = 16 * 1024 * 1024;
    const body = '["' + "a".repeat(size - 4) + '"]';
    const fetch = fakeFetch(() => text(200, body));
    const out = await new ContrastAPI({ fetch }).health();
    assert.equal(out[0].length, size - 4);
  });

  test("a body of 16 MiB + 1 byte is refused", async () => {
    const size = 16 * 1024 * 1024 + 1;
    const body = '"' + "a".repeat(size - 2) + '"';
    const { error } = await failure(() => text(200, body));
    assert.equal(error.constructor, ContrastAPIError);
    assert.equal(error.code, null);
    assert.equal(error.status, 200);
  });

  test("an endless body is cancelled past the cap", async () => {
    let cancelled = false;
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    const stream = new ReadableStream({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { error } = await failure(() => new Response(stream, { status: 200 }));
    assert.equal(error.constructor, ContrastAPIError);
    assert.ok(cancelled);
    assert.ok(pulled <= 20, `pulled ${pulled}`);
  });

  for (const [name, body] of [["null", null], ["undefined", undefined]]) {
    test(`a response whose body is ${name} reads as empty text`, async () => {
      const { error } = await failure(() => ({ status: 200, headers: new Headers(), body }));
      assert.equal(error.constructor, ContrastAPIError);
      assert.equal(error.code, null);
      assert.equal(error.status, 200);
    });
  }

  test("a body that ends inside a UTF-8 sequence is not JSON", async () => {
    const { error } = await failure(() => new Response(new Uint8Array([0x22, 0x61, 0x22, 0xc3]), { status: 200 }));
    assert.equal(error.constructor, ContrastAPIError);
  });

  test("a multi-byte UTF-8 body split across chunks decodes", async () => {
    const bytes = new TextEncoder().encode('{"v":"ü€"}');
    const stream = new ReadableStream({
      start(controller) {
        for (const b of bytes) controller.enqueue(new Uint8Array([b]));
        controller.close();
      },
    });
    const fetch = fakeFetch(() => new Response(stream, { status: 200 }));
    assert.deepEqual(await new ContrastAPI({ fetch }).health(), { v: "ü€" });
  });
});

describe("network errors", () => {
  test("fetch rejection -> APIConnectionError with cause", async () => {
    const cause = new TypeError("fetch failed");
    const { error } = await failure(() => Promise.reject(cause));
    assert.equal(error.constructor, APIConnectionError);
    assert.ok(error instanceof ContrastAPIError);
    assert.equal(error.status, null);
    assert.equal(error.code, null);
    assert.equal(error.cause, cause);
  });

  test("AbortError that is not a timeout -> APIConnectionError", async () => {
    const cause = new DOMException("aborted", "AbortError");
    const { error } = await failure(() => Promise.reject(cause));
    assert.equal(error.constructor, APIConnectionError);
  });

  test("TimeoutError -> APITimeoutError with cause", async () => {
    const cause = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const { error } = await failure(() => Promise.reject(cause));
    assert.equal(error.constructor, APITimeoutError);
    assert.ok(error instanceof APIConnectionError);
    assert.equal(error.status, null);
    assert.equal(error.cause, cause);
  });

  test("a timeout while reading the body -> APITimeoutError", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.error(new DOMException("timeout", "TimeoutError"));
      },
    });
    const { error } = await failure(() => new Response(stream, { status: 200 }));
    assert.equal(error.constructor, APITimeoutError);
  });

  test("a network error while reading the body -> APIConnectionError", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.error(new TypeError("terminated"));
      },
    });
    const { error } = await failure(() => new Response(stream, { status: 200 }));
    assert.equal(error.constructor, APIConnectionError);
  });

  test("a fetch that rejects is a connection error; redirect is manual", async () => {
    const fetch = fakeFetch((n, url, init) => {
      assert.equal(init.redirect, "manual");
      return Promise.reject(new TypeError("fetch failed", { cause: new TypeError("unexpected redirect") }));
    });
    await assert.rejects(new ContrastAPI({ fetch }).health(), APIConnectionError);
  });
});

describe("the key never leaks", () => {
  function assertClean(value) {
    const views = [
      inspect(value, { depth: Infinity, showHidden: true, getters: true }),
      inspect(value),
      String(value),
      JSON.stringify(value) ?? "",
    ];
    if (value instanceof Error) {
      views.push(value.message, value.stack ?? "", JSON.stringify(Object.getOwnPropertyDescriptors(value)));
      let c = value.cause;
      while (c) {
        views.push(inspect(c, { depth: Infinity, showHidden: true }), String(c));
        c = c.cause;
      }
    }
    for (const v of views) assert.ok(!v.includes(KEY), "key leaked: " + v.slice(0, 200));
  }

  test("client inspect / JSON / keys", () => {
    const client = new ContrastAPI({ apiKey: KEY, fetch: fakeFetch() });
    assertClean(client);
    assert.deepEqual(Object.keys(client), []);
  });

  test("HTTP error, connection error and timeout error", async () => {
    const answers = [
      () => apiError(401, "invalid_key", "bad key"),
      () => apiError(429, "rate_limited", "slow down", { "Retry-After": "5" }),
      () => Promise.reject(new TypeError("fetch failed")),
      () => Promise.reject(new DOMException("timeout", "TimeoutError")),
      () => text(200, "not json"),
    ];
    for (const answer of answers) {
      const { error } = await failure(answer, { apiKey: KEY });
      assertClean(error);
    }
  });

  test("the key the server echoes back is still the server's text, not ours", async () => {
    const fetch = fakeFetch((n, url, init) => apiError(401, "invalid_key", "bad"));
    const client = new ContrastAPI({ apiKey: KEY, fetch });
    await assert.rejects(client.health(), AuthenticationError);
    assert.equal(fetch.calls[0].init.headers["X-API-Key"], KEY);
  });
});

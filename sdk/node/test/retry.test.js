// 429 and 503 retries under mock timers: no real waiting.
import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ContrastAPI, RateLimitError, UpstreamError } from "../src/index.js";
import { fakeFetch, sequence, json, apiError, flush } from "./fake_fetch.js";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

/** Start a call; the returned promise is settled-safe until the test awaits it. */
function start(client, run = (c) => c.health()) {
  const p = run(client);
  p.catch(() => {});
  return p;
}

async function tick(ms) {
  mock.timers.tick(ms);
  await flush();
}

const busy = (code = "upstream_busy", headers = {}) => () => apiError(503, code, "busy", headers);
const ok = () => json(200, { ok: true });

describe("503 upstream busy", () => {
  test("upstream_busy is retried twice after Retry-After, then thrown", async () => {
    const fetch = fakeFetch(busy("upstream_busy", { "Retry-After": "2" }));
    const p = start(new ContrastAPI({ fetch }));
    await flush();
    assert.equal(fetch.calls.length, 1);
    await tick(1999);
    assert.equal(fetch.calls.length, 1);
    await tick(1);
    assert.equal(fetch.calls.length, 2);
    await tick(1999);
    assert.equal(fetch.calls.length, 2);
    await tick(1);
    assert.equal(fetch.calls.length, 3);
    await tick(10000);
    assert.equal(fetch.calls.length, 3);
    await assert.rejects(p, (e) => e instanceof UpstreamError && e.code === "upstream_busy" && e.retryAfter === 2);
  });

  test("raw_body_busy is retried and the retry can succeed", async () => {
    const fetch = sequence(busy("raw_body_busy", { "Retry-After": "1" }), ok);
    const p = start(new ContrastAPI({ fetch }));
    await flush();
    await tick(1000);
    assert.equal(fetch.calls.length, 2);
    assert.deepEqual(await p, { ok: true });
  });

  test("missing Retry-After waits 1 s", async () => {
    const fetch = sequence(busy(), ok);
    const p = start(new ContrastAPI({ fetch }));
    await flush();
    await tick(999);
    assert.equal(fetch.calls.length, 1);
    await tick(1);
    assert.equal(fetch.calls.length, 2);
    await p;
  });

  test("invalid Retry-After waits 1 s", async () => {
    const fetch = sequence(busy("upstream_busy", { "Retry-After": "1.5" }), ok);
    const p = start(new ContrastAPI({ fetch }));
    await flush();
    await tick(999);
    assert.equal(fetch.calls.length, 1);
    await tick(1);
    assert.equal(fetch.calls.length, 2);
    await p;
  });

  test("Retry-After 0 retries without waiting", async () => {
    const fetch = sequence(busy("upstream_busy", { "Retry-After": "0" }), ok);
    const p = start(new ContrastAPI({ fetch }));
    await flush();
    await tick(0);
    assert.equal(fetch.calls.length, 2);
    await p;
  });

  test("upstreamBusyRetries 1 makes two calls", async () => {
    const fetch = fakeFetch(busy("upstream_busy", { "Retry-After": "1" }));
    const p = start(new ContrastAPI({ fetch, upstreamBusyRetries: 1 }));
    await flush();
    await tick(1000);
    await tick(1000);
    await tick(1000);
    assert.equal(fetch.calls.length, 2);
    await assert.rejects(p, UpstreamError);
  });

  test("upstreamBusyRetries 0 does not retry", async () => {
    const fetch = fakeFetch(busy());
    const p = start(new ContrastAPI({ fetch, upstreamBusyRetries: 0 }));
    await flush();
    await tick(5000);
    assert.equal(fetch.calls.length, 1);
    await assert.rejects(p, UpstreamError);
  });

  for (const [name, make] of [
    ["503 other code", busy("maintenance", { "Retry-After": "1" })],
    ["503 without a code", () => json(503, { error: { message: "down" } }, { "Retry-After": "1" })],
    ["502 upstream_busy", () => apiError(502, "upstream_busy", "x", { "Retry-After": "1" })],
    ["504 upstream_busy", () => apiError(504, "upstream_busy", "x", { "Retry-After": "1" })],
    ["500 upstream_busy", () => apiError(500, "upstream_busy", "x", { "Retry-After": "1" })],
  ]) {
    test(`${name} is not retried`, async () => {
      const fetch = fakeFetch(make);
      const p = start(new ContrastAPI({ fetch, maxRetries: 3 }));
      await flush();
      await tick(5000);
      assert.equal(fetch.calls.length, 1);
      await assert.rejects(p);
    });
  }

  test("503 busy whose Retry-After is over the wait cap is thrown at once", async () => {
    const fetch = fakeFetch(busy("upstream_busy", { "Retry-After": "61" }));
    const p = start(new ContrastAPI({ fetch }));
    await assert.rejects(p, (e) => e instanceof UpstreamError && e.retryAfter === 61);
    assert.equal(fetch.calls.length, 1);
  });
});

describe("429", () => {
  test("not retried by default", async () => {
    const fetch = fakeFetch(() => apiError(429, "rate_limited", "slow", { "Retry-After": "1" }));
    const p = start(new ContrastAPI({ fetch }));
    await assert.rejects(p, (e) => e instanceof RateLimitError && e.retryAfter === 1 && e.code === "rate_limited");
    await tick(5000);
    assert.equal(fetch.calls.length, 1);
  });

  test("maxRetries 2 makes three calls, waiting Retry-After each time", async () => {
    const fetch = fakeFetch(() => apiError(429, "rate_limited", "slow", { "Retry-After": "3" }));
    const p = start(new ContrastAPI({ fetch, maxRetries: 2 }));
    await flush();
    await tick(2999);
    assert.equal(fetch.calls.length, 1);
    await tick(1);
    assert.equal(fetch.calls.length, 2);
    await tick(3000);
    assert.equal(fetch.calls.length, 3);
    await tick(3000);
    assert.equal(fetch.calls.length, 3);
    await assert.rejects(p, RateLimitError);
  });

  test("a retry that succeeds returns its body", async () => {
    const fetch = sequence(() => apiError(429, "rate_limited", "slow", { "Retry-After": "1" }), ok);
    const p = start(new ContrastAPI({ fetch, maxRetries: 1 }));
    await flush();
    await tick(1000);
    assert.deepEqual(await p, { ok: true });
  });

  test("a 429 without Retry-After is not retried", async () => {
    const fetch = sequence(() => apiError(429, "rate_limited", "slow"), ok);
    const p = start(new ContrastAPI({ fetch, maxRetries: 1 }));
    await flush();
    await assert.rejects(p, RateLimitError);
    assert.equal(fetch.calls.length, 1);
  });

  test("busy and 429 retries are counted apart", async () => {
    const fetch = sequence(
      busy("upstream_busy", { "Retry-After": "1" }),
      () => apiError(429, "rate_limited", "slow", { "Retry-After": "1" }),
      busy("upstream_busy", { "Retry-After": "1" }),
      ok,
    );
    const p = start(new ContrastAPI({ fetch, maxRetries: 1, upstreamBusyRetries: 2 }));
    await flush();
    await tick(1000);
    await tick(1000);
    await tick(1000);
    assert.equal(fetch.calls.length, 4);
    assert.deepEqual(await p, { ok: true });
  });
});

describe("wait cap", () => {
  test("default cap 60000 ms: Retry-After 60 is retried", async () => {
    const fetch = sequence(() => apiError(429, "rate_limited", "slow", { "Retry-After": "60" }), ok);
    const p = start(new ContrastAPI({ fetch, maxRetries: 1 }));
    await flush();
    await tick(59999);
    assert.equal(fetch.calls.length, 1);
    await tick(1);
    assert.equal(fetch.calls.length, 2);
    await p;
  });

  test("default cap 60000 ms: Retry-After 61 is thrown at once", async () => {
    const fetch = fakeFetch(() => apiError(429, "rate_limited", "slow", { "Retry-After": "61" }));
    const p = start(new ContrastAPI({ fetch, maxRetries: 1 }));
    await assert.rejects(p, (e) => e instanceof RateLimitError && e.retryAfter === 61);
    assert.equal(fetch.calls.length, 1);
  });

  test("maxRetryWaitMs 5000: 5 s retried, 6 s thrown", async () => {
    const f1 = sequence(() => apiError(429, "r", "s", { "Retry-After": "5" }), ok);
    const p1 = start(new ContrastAPI({ fetch: f1, maxRetries: 1, maxRetryWaitMs: 5000 }));
    await flush();
    await tick(5000);
    await p1;
    assert.equal(f1.calls.length, 2);

    const f2 = fakeFetch(() => apiError(429, "r", "s", { "Retry-After": "6" }));
    await assert.rejects(start(new ContrastAPI({ fetch: f2, maxRetries: 1, maxRetryWaitMs: 5000 })), RateLimitError);
    assert.equal(f2.calls.length, 1);
  });

  test("maxRetryWaitMs 0 still retries Retry-After 0", async () => {
    const fetch = sequence(() => apiError(429, "r", "s", { "Retry-After": "0" }), ok);
    const p = start(new ContrastAPI({ fetch, maxRetries: 1, maxRetryWaitMs: 0 }));
    await flush();
    await tick(0);
    await p;
    assert.equal(fetch.calls.length, 2);
  });

  test("Retry-After 3601 is read as 3600 against the cap", async () => {
    const fetch = sequence(() => apiError(429, "r", "s", { "Retry-After": "3601" }), ok);
    const p = start(new ContrastAPI({ fetch, maxRetries: 1, maxRetryWaitMs: 3600000 }));
    await flush();
    await tick(3599999);
    assert.equal(fetch.calls.length, 1);
    await tick(1);
    assert.equal(fetch.calls.length, 2);
    await p;
  });
});

describe("retry options are checked", () => {
  for (const [name, value] of [
    ["maxRetries", -1],
    ["maxRetries", 1.5],
    ["maxRetries", "2"],
    ["upstreamBusyRetries", -1],
    ["upstreamBusyRetries", NaN],
    ["maxRetryWaitMs", -1],
    ["maxRetryWaitMs", Infinity],
    ["maxRetryWaitMs", "1000"],
  ]) {
    test(`${name} ${String(value)} is a TypeError`, () => {
      assert.throws(() => new ContrastAPI({ fetch: fakeFetch(), [name]: value }), TypeError);
    });
  }

  test("a non-function fetch or onRateLimit is a TypeError", () => {
    assert.throws(() => new ContrastAPI({ fetch: "x" }), TypeError);
    assert.throws(() => new ContrastAPI({ fetch: fakeFetch(), onRateLimit: 1 }), TypeError);
  });
});

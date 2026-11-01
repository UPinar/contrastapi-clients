// lastRateLimit and onRateLimit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ContrastAPI, NotFoundError, RateLimitError } from "../src/index.js";
import { sequence, json, apiError, RL_HEADERS } from "./fake_fetch.js";

const EXPECTED = {
  limit: 100,
  remaining: 97,
  resetAt: new Date(1767225600 * 1000),
  resetHuman: "2026-01-01 00:00:00 UTC",
};

test("null before any response", () => {
  assert.equal(new ContrastAPI({ fetch: sequence() }).lastRateLimit, null);
});

test("parsed from the four headers, frozen", async () => {
  const client = new ContrastAPI({ fetch: sequence(() => json(200, {}, RL_HEADERS)) });
  await client.health();
  const rl = client.lastRateLimit;
  assert.deepEqual(rl, EXPECTED);
  assert.ok(rl.resetAt instanceof Date);
  assert.ok(Object.isFrozen(rl));
});

test("limit and remaining are not swapped", async () => {
  const client = new ContrastAPI({
    fetch: sequence(() => json(200, {}, { ...RL_HEADERS, "X-RateLimit-Limit": "50", "X-RateLimit-Remaining": "0" })),
  });
  await client.health();
  assert.equal(client.lastRateLimit.limit, 50);
  assert.equal(client.lastRateLimit.remaining, 0);
});

test("kept when a later response carries none (zero-cost call)", async () => {
  const client = new ContrastAPI({ fetch: sequence(() => json(200, {}, RL_HEADERS), () => json(200, {})) });
  await client.health();
  const first = client.lastRateLimit;
  await client.health();
  assert.equal(client.lastRateLimit, first);
});

for (const [name, change] of [
  ["missing Limit", { "X-RateLimit-Limit": undefined }],
  ["missing Remaining", { "X-RateLimit-Remaining": undefined }],
  ["missing Reset-Machine", { "X-RateLimit-Reset-Machine": undefined }],
  ["missing Reset-Human", { "X-RateLimit-Reset-Human": undefined }],
  ["Limit not an integer", { "X-RateLimit-Limit": "1.5" }],
  ["Remaining negative", { "X-RateLimit-Remaining": "-1" }],
  ["Remaining empty", { "X-RateLimit-Remaining": "" }],
  ["Reset-Machine a date", { "X-RateLimit-Reset-Machine": "2026-01-01" }],
]) {
  test(`unchanged when ${name}`, async () => {
    const headers = { ...RL_HEADERS, "X-RateLimit-Limit": "7" };
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined) delete headers[k];
      else headers[k] = v;
    }
    const seen = [];
    const client = new ContrastAPI({
      fetch: sequence(() => json(200, {}, RL_HEADERS), () => json(200, {}, headers)),
      onRateLimit: (info) => seen.push(info),
    });
    await client.health();
    await client.health();
    assert.deepEqual(client.lastRateLimit, EXPECTED);
    assert.equal(seen.length, 1);
  });
}

test("a later valid reading replaces the earlier one", async () => {
  const client = new ContrastAPI({
    fetch: sequence(
      () => json(200, {}, RL_HEADERS),
      () => json(200, {}, { ...RL_HEADERS, "X-RateLimit-Remaining": "96" }),
    ),
  });
  await client.health();
  await client.health();
  assert.equal(client.lastRateLimit.remaining, 96);
});

test("onRateLimit gets the same frozen object", async () => {
  const seen = [];
  const client = new ContrastAPI({ fetch: sequence(() => json(200, {}, RL_HEADERS)), onRateLimit: (i) => seen.push(i) });
  await client.health();
  assert.equal(seen.length, 1);
  assert.equal(seen[0], client.lastRateLimit);
});

test("onRateLimit throwing or rejecting is swallowed", async () => {
  const c1 = new ContrastAPI({
    fetch: sequence(() => json(200, { a: 1 }, RL_HEADERS)),
    onRateLimit: () => {
      throw new Error("callback bug");
    },
  });
  assert.deepEqual(await c1.health(), { a: 1 });
  assert.deepEqual(c1.lastRateLimit, EXPECTED);

  let unhandled = 0;
  const onUnhandled = () => unhandled++;
  process.on("unhandledRejection", onUnhandled);
  const c2 = new ContrastAPI({
    fetch: sequence(() => json(200, { a: 2 }, RL_HEADERS)),
    onRateLimit: async () => {
      throw new Error("async callback bug");
    },
  });
  assert.deepEqual(await c2.health(), { a: 2 });
  await new Promise((r) => setTimeout(r, 20));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled, 0);
});

test("an error response updates lastRateLimit and carries its reading", async () => {
  const client = new ContrastAPI({
    fetch: sequence(() => apiError(429, "rate_limited", "slow", { ...RL_HEADERS, "X-RateLimit-Remaining": "0" })),
  });
  await assert.rejects(client.health(), (e) => {
    assert.ok(e instanceof RateLimitError);
    assert.deepEqual(e.rateLimit, { ...EXPECTED, remaining: 0 });
    return true;
  });
  assert.equal(client.lastRateLimit.remaining, 0);
});

test("an error without the headers has rateLimit null and keeps lastRateLimit", async () => {
  const client = new ContrastAPI({
    fetch: sequence(() => json(200, {}, RL_HEADERS), () => apiError(404, "not_found", "no")),
  });
  await client.health();
  await assert.rejects(client.health(), (e) => e instanceof NotFoundError && e.rateLimit === null);
  assert.deepEqual(client.lastRateLimit, EXPECTED);
});

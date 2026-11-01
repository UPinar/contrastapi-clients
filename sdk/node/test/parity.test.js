// Rules the Node and Python SDKs share: each test pins one rule the two used to apply differently.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { Session } from "node:inspector/promises";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ContrastAPI,
  ContrastAPIError,
  APIConnectionError,
  APITimeoutError,
  BadRequestError,
  RateLimitError,
} from "../src/index.js";
import { isUnderBase } from "../src/client.js";
import { fakeFetch, json, text, apiError, KEY, RL_HEADERS } from "./fake_fetch.js";

const SAVED_ENV = process.env.CONTRASTAPI_API_KEY;
beforeEach(() => {
  delete process.env.CONTRASTAPI_API_KEY;
});
after(() => {
  if (SAVED_ENV === undefined) delete process.env.CONTRASTAPI_API_KEY;
  else process.env.CONTRASTAPI_API_KEY = SAVED_ENV;
});

/** Reads the #private fields of `obj` through the inspector, which sees what no public API shows. */
async function privateFields(obj) {
  const session = new Session();
  session.connect();
  try {
    globalThis.__parityProbe = obj;
    const { result } = await session.post("Runtime.evaluate", { expression: "globalThis.__parityProbe" });
    const props = await session.post("Runtime.getProperties", { objectId: result.objectId, ownProperties: true });
    return Object.fromEntries((props.privateProperties ?? []).map((p) => [p.name, p.value?.value]));
  } finally {
    delete globalThis.__parityProbe;
    session.disconnect();
  }
}

async function reject(answer, run = (c) => c.health(), options = {}) {
  const fetch = fakeFetch(answer);
  const client = new ContrastAPI({ fetch, ...options });
  let error;
  try {
    await run(client);
  } catch (e) {
    error = e;
  }
  assert.ok(error, "the call did not throw");
  return { error, fetch, client };
}

function bytesResponse(status, bytes, headers = {}) {
  return new Response(new Uint8Array(bytes), { status, headers });
}

describe("parity: 429 without a usable Retry-After", () => {
  for (const headers of [{}, { "Retry-After": "1.5" }, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }]) {
    test(`429 with ${JSON.stringify(headers)} is thrown at once`, async () => {
      const { error, fetch } = await reject(() => apiError(429, "rate_limited", "slow", headers), undefined, {
        maxRetries: 3,
      });
      assert.equal(error.constructor, RateLimitError);
      assert.equal(fetch.calls.length, 1);
      assert.equal(error.retryAfter, null);
    });
  }
});

describe("parity: 3xx is refused", () => {
  for (const status of [300, 301, 304, 308, 399]) {
    test(`HTTP ${status} -> APIConnectionError redirect refused`, async () => {
      const { error, client } = await reject(
        () => new Response(null, { status, headers: { Location: "https://evil.example/", ...RL_HEADERS } }),
      );
      assert.equal(error.constructor, APIConnectionError);
      assert.equal(error.message, "redirect refused");
      assert.equal(error.status, null);
      assert.equal(client.lastRateLimit.remaining, 97);
    });
  }
  test("HTTP 299 is a success and 400 an error", async () => {
    const fetch = fakeFetch(() => json(299, { ok: 1 }));
    assert.deepEqual(await new ContrastAPI({ fetch }).health(), { ok: 1 });
    const { error } = await reject(() => apiError(400, "bad", "no"));
    assert.equal(error.constructor, BadRequestError);
  });
  test("fetch is asked not to follow a redirect", async () => {
    const fetch = fakeFetch();
    await new ContrastAPI({ fetch }).health();
    assert.equal(fetch.calls[0].init.redirect, "manual");
  });
});

describe("parity: base URL", () => {
  const refused = [
    "https://api.contrastcyber.com\n",
    "\thttps://api.contrastcyber.com",
    " https://api.contrastcyber.com",
    "https://api.contrastcyber.com/a b",
    "https://api.contrastcyber.com/\u007f",
    "https://api.contrastcyber.com/\u0000",
    "https://example.com\\@api.contrastcyber.com",
    "https://api.contrastcyber.com\\x",
    "https://@example.com",
    "https://@api.contrastcyber.com",
    "https:example.com",
    "https:/example.com",
    "https:///health",
    "http://127.1",
    "http://[0:0:0:0:0:0:0:1]",
    "HTTP://example.com",
    "ftp://localhost",
    "https://example.com:99999",
    "https://[::1",
  ];
  for (const base of refused) {
    test(`baseUrl ${JSON.stringify(base)} is refused`, () => {
      assert.throws(
        () => new ContrastAPI({ baseUrl: base, fetch: fakeFetch() }),
        (e) => e instanceof TypeError && /^baseUrl /.test(e.message),
      );
    });
  }
  const keyed = [
    ["HTTPS://API.CONTRASTCYBER.COM", true],
    ["HTTP://LOCALHOST:8080", true],
    ["https://localhost", true],
    ["https://127.1", false],
    ["https://[0:0:0:0:0:0:0:1]:8443", false],
    ["https://api.contrastcyber.%63om", false],
    ["https://example.com", false],
  ];
  for (const [base, sent] of keyed) {
    test(`baseUrl ${base}: the key is ${sent ? "" : "not "}sent`, async () => {
      const fetch = fakeFetch();
      await new ContrastAPI({ baseUrl: base, apiKey: KEY, fetch }).health();
      assert.equal(fetch.calls[0].init.headers["X-API-Key"], sent ? KEY : undefined);
    });
  }
});

describe("parity: path and query values", () => {
  const bad = [
    ["an object", { a: 1 }],
    ["an array", ["x"]],
    ["a function", () => "x"],
    ["a symbol", Symbol("x")],
    ["a Date", new Date(0)],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["a lone high surrogate", "a\ud800"],
    ["a lone low surrogate", "\udc00b"],
  ];
  for (const [label, value] of bad) {
    test(`path value ${label} is refused before any request`, async () => {
      const fetch = fakeFetch();
      await assert.rejects(new ContrastAPI({ fetch }).cveLookup({ cve_id: value }), TypeError);
      assert.equal(fetch.calls.length, 0);
    });
    test(`query value ${label} is refused before any request`, async () => {
      const fetch = fakeFetch();
      await assert.rejects(new ContrastAPI({ fetch }).cveSearch({ vendor: value }), TypeError);
      assert.equal(fetch.calls.length, 0);
    });
    test(`raw query value ${label} is refused before any request`, async () => {
      const fetch = fakeFetch();
      await assert.rejects(new ContrastAPI({ fetch }).request("GET", "/x", { query: { v: value } }), TypeError);
      assert.equal(fetch.calls.length, 0);
    });
  }
  test("a bigint and a surrogate pair are written as text", async () => {
    const fetch = fakeFetch();
    await new ContrastAPI({ fetch }).cveSearch({ vendor: "😀", limit: 12n });
    assert.equal(fetch.calls[0].url, "https://api.contrastcyber.com/cve_search?vendor=%F0%9F%98%80&limit=12");
  });
  test("a query name with a lone surrogate is refused before any request", async () => {
    const fetch = fakeFetch();
    await assert.rejects(new ContrastAPI({ fetch }).request("GET", "/x", { query: { "a\ud800": "1" } }), TypeError);
    assert.equal(fetch.calls.length, 0);
  });
  test("a query keeps only unreserved characters; space is %20", async () => {
    const fetch = fakeFetch();
    await new ContrastAPI({ fetch }).request("GET", "/x", { query: { "a b~": "a b~*'!()-._+" } });
    assert.equal(fetch.calls[0].url, "https://api.contrastcyber.com/x?a%20b~=a%20b~%2A%27%21%28%29-._%2B");
  });
});

describe("parity: API key", () => {
  test("the env key loses ASCII spaces at both ends", async () => {
    process.env.CONTRASTAPI_API_KEY = ` \t\n\v\f\r${KEY}\r\n `;
    const fetch = fakeFetch();
    await new ContrastAPI({ fetch }).health();
    assert.equal(fetch.calls[0].init.headers["X-API-Key"], KEY);
  });
  for (const edge of [" ", "﻿", " ", "\u001c"]) {
    test(`an env key with ${JSON.stringify(edge)} at an end is refused without echo`, () => {
      process.env.CONTRASTAPI_API_KEY = edge + KEY;
      assert.throws(
        () => new ContrastAPI({ fetch: fakeFetch() }),
        (e) => e instanceof TypeError && !e.message.includes(KEY),
      );
    });
  }
  test("an explicit key is not trimmed", () => {
    assert.throws(() => new ContrastAPI({ apiKey: ` ${KEY}`, fetch: fakeFetch() }), TypeError);
  });
  test("the key is stored only when it will be sent", async () => {
    const untrusted = new ContrastAPI({ apiKey: KEY, baseUrl: "https://example.com", fetch: fakeFetch() });
    assert.equal((await privateFields(untrusted))["#apiKey"], null);
    const trusted = new ContrastAPI({ apiKey: KEY, fetch: fakeFetch() });
    assert.equal((await privateFields(trusted))["#apiKey"], KEY);
    const vouched = new ContrastAPI({ apiKey: KEY, baseUrl: "https://example.com", trustHost: true, fetch: fakeFetch() });
    assert.equal((await privateFields(vouched))["#apiKey"], KEY);
  });
});

describe("parity: cleaning server text", () => {
  test("C1 controls leave code and message", async () => {
    const { error } = await reject(() => apiError(400, "a\u009bb\u0085", "x\u0080y\u009fz "));
    assert.equal(error.code, "ab");
    assert.equal(error.message, "xyz ");
  });
  test("the message cap counts code points, so a pair is never split", async () => {
    const { error } = await reject(() => apiError(400, "c", "a".repeat(299) + "😀😀"));
    assert.equal(error.message, "a".repeat(299) + "😀");
  });
  test("resetHuman is cleaned and capped", async () => {
    const fetch = fakeFetch(() =>
      json(200, {}, { ...RL_HEADERS, "X-RateLimit-Reset-Human": "\u001b[31m2026\u0085" + "x".repeat(400) }),
    );
    const client = new ContrastAPI({ fetch });
    await client.health();
    assert.equal(client.lastRateLimit.resetHuman, "[31m2026" + "x".repeat(292));
  });
  test("format characters and lone surrogates leave code and message", async () => {
    const { error } = await reject(() =>
      apiError(400, "a\u202eb\ufeffc\ud800", "x\u202ey\u200bz\u00ad\udc00\u2066w\ud83d\ude00"),
    );
    assert.equal(error.code, "abc");
    assert.equal(error.message, "xyzw\ud83d\ude00");
  });
  test("resetHuman drops a format character", async () => {
    const fetch = fakeFetch(() => json(200, {}, { ...RL_HEADERS, "X-RateLimit-Reset-Human": "2026\u00ad-01" }));
    const client = new ContrastAPI({ fetch });
    await client.health();
    assert.equal(client.lastRateLimit.resetHuman, "2026-01");
  });
  test("an empty resetHuman gives no rate-limit reading", async () => {
    const fetch = fakeFetch(() => json(200, {}, { ...RL_HEADERS, "X-RateLimit-Reset-Human": "" }));
    const client = new ContrastAPI({ fetch });
    await client.health();
    assert.equal(client.lastRateLimit, null);
  });
});

describe("parity: rate-limit bounds", () => {
  const cases = [
    ["X-RateLimit-Limit", "9007199254740991", true],
    ["X-RateLimit-Limit", "9007199254740992", false],
    ["X-RateLimit-Remaining", "9007199254740991", true],
    ["X-RateLimit-Remaining", "9007199254740992", false],
    ["X-RateLimit-Reset-Machine", "253402300799", true],
    ["X-RateLimit-Reset-Machine", "253402300800", false],
  ];
  for (const [name, value, read] of cases) {
    test(`${name} ${value} is ${read ? "read" : "refused"}`, async () => {
      const fetch = fakeFetch(() => json(200, {}, { ...RL_HEADERS, [name]: value }));
      const client = new ContrastAPI({ fetch });
      await client.health();
      assert.equal(client.lastRateLimit !== null, read);
    });
  }
});

describe("parity: response body", () => {
  for (const body of ["1", "null", '"x"', "true"]) {
    test(`a 200 body ${body} is refused`, async () => {
      const { error } = await reject(() => text(200, body));
      assert.equal(error.constructor, ContrastAPIError);
      assert.equal(error.message, "response is not a JSON object or array (HTTP 200)");
    });
  }
  test("an array body is returned", async () => {
    assert.deepEqual(await new ContrastAPI({ fetch: fakeFetch(() => json(200, [1])) }).health(), [1]);
  });
  test("a body that is not UTF-8 is refused", async () => {
    const bytes = [...new TextEncoder().encode('{"a":"')].concat([0xff], [...new TextEncoder().encode('"}')]);
    const { error } = await reject(() => bytesResponse(200, bytes));
    assert.equal(error.message, "response is not a JSON object or array (HTTP 200)");
  });
  test("a UTF-8 BOM is dropped", async () => {
    const bytes = [0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')];
    assert.deepEqual(await new ContrastAPI({ fetch: fakeFetch(() => bytesResponse(200, bytes)) }).health(), { a: 1 });
  });
  test("an error body that is not UTF-8 gives no code and no message", async () => {
    const raw = new TextEncoder().encode('{"error":{"code":"c","message":"m"}}');
    const broken = [...raw.slice(0, 19), 0xff, ...raw.slice(19)];
    const { error } = await reject(() => bytesResponse(400, broken));
    assert.equal(error.code, null);
    assert.equal(error.message, "HTTP 400");
  });
  test("the body cap error names the cap and keeps the reading", async () => {
    const big = new Uint8Array(16 * 1024 * 1024 + 1);
    const { error, client } = await reject(() => new Response(big, { status: 200, headers: RL_HEADERS }));
    assert.equal(error.message, "response body exceeds 16777216 bytes");
    assert.equal(error.rateLimit.remaining, 97);
    assert.equal(client.lastRateLimit.remaining, 97);
  });
});

describe("parity: request body", () => {
  const bad = [
    ["NaN", { x: NaN }],
    ["Infinity in an array", { x: [1, Infinity] }],
    ["a function", { x: () => 1 }],
    ["a symbol", { x: Symbol("s") }],
    ["a Map", new Map([["a", 1]])],
    ["a nested Set", { x: new Set([1]) }],
    ["a top-level NaN", NaN],
  ];
  for (const [label, body] of bad) {
    test(`a body with ${label} is refused before any request`, async () => {
      const fetch = fakeFetch();
      await assert.rejects(new ContrastAPI({ fetch }).request("POST", "/x", { body }), TypeError);
      assert.equal(fetch.calls.length, 0);
    });
  }
  test("a required body argument that is null is refused before any request", async () => {
    const fetch = fakeFetch();
    await assert.rejects(new ContrastAPI({ fetch }).cveLookupBulk({ cve_ids: null }), /missing required argument/);
    assert.equal(fetch.calls.length, 0);
  });
  test("call() refuses a non-finite body value too", async () => {
    const fetch = fakeFetch();
    await assert.rejects(new ContrastAPI({ fetch }).cveLookupBulk({ cve_ids: [NaN] }), TypeError);
    assert.equal(fetch.calls.length, 0);
  });
  test("a null body sends no body", async () => {
    const fetch = fakeFetch();
    await new ContrastAPI({ fetch }).request("POST", "/x", { body: null });
    assert.equal(fetch.calls[0].init.body, undefined);
    assert.equal(fetch.calls[0].init.headers["Content-Type"], undefined);
  });
  test("a Date body value is written through toJSON", async () => {
    const fetch = fakeFetch();
    await new ContrastAPI({ fetch }).request("POST", "/x", { body: { d: new Date(0), n: null, s: "x" } });
    assert.equal(fetch.calls[0].init.body, '{"d":"1970-01-01T00:00:00.000Z","n":null,"s":"x"}');
  });
});

describe("parity: raw request() arguments", () => {
  for (const method of ["GE T", "G1", "", "GET\n", "ÄET"]) {
    test(`method ${JSON.stringify(method)} is refused`, async () => {
      const fetch = fakeFetch();
      await assert.rejects(new ContrastAPI({ fetch }).request(method, "/x"), TypeError);
      assert.equal(fetch.calls.length, 0);
    });
  }
  test("a lower-case method is sent upper-case", async () => {
    const fetch = fakeFetch();
    await new ContrastAPI({ fetch }).request("patch", "/x");
    assert.equal(fetch.calls[0].init.method, "PATCH");
  });
  for (const path of ["/a b", "/a?b=1", "/a#b", "/a\\b", "/a\n", "/a\u007f", "/a\u0000", "/\t"]) {
    test(`path ${JSON.stringify(path)} is refused`, async () => {
      const fetch = fakeFetch();
      await assert.rejects(new ContrastAPI({ fetch }).request("GET", path), TypeError);
      assert.equal(fetch.calls.length, 0);
    });
  }
  for (const [label, query] of [
    ["an array", ["a"]],
    ["a Map", new Map([["a", "1"]])],
    ["a string", "a=1"],
    ["a function", () => ({})],
  ]) {
    test(`query ${label} is refused`, async () => {
      const fetch = fakeFetch();
      await assert.rejects(new ContrastAPI({ fetch }).request("GET", "/x", { query }), TypeError);
      assert.equal(fetch.calls.length, 0);
    });
  }
  test("a query with a null prototype is accepted", async () => {
    const fetch = fakeFetch();
    const query = Object.assign(Object.create(null), { a: "1" });
    await new ContrastAPI({ fetch }).request("GET", "/x", { query });
    assert.equal(fetch.calls[0].url, "https://api.contrastcyber.com/x?a=1");
  });
});

/** trackedBody returns a body stream that counts its reads and notes a cancel. */
function trackedBody(textBody) {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream(
    {
      pull(controller) {
        state.pulls++;
        controller.enqueue(new TextEncoder().encode(textBody));
        controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

describe("parity: response encoding", () => {
  test("every request asks for identity", async () => {
    const fetch = fakeFetch();
    const client = new ContrastAPI({ fetch });
    await client.health();
    await client.cveLookupBulk({ cve_ids: ["CVE-2021-44228"] });
    await client.request("POST", "/x", { body: { a: 1 } });
    for (const call of fetch.calls) assert.equal(call.init.headers["Accept-Encoding"], "identity");
  });
  const refused = ["gzip", "gzip, gzip", "br", "deflate", "zstd", "x-gzip", "", "identity, gzip", "gzip, identity",
    "identity, identity"];
  for (const encoding of refused) {
    test(`Content-Encoding ${JSON.stringify(encoding)} is refused and its body is not read`, async () => {
      const { stream, state } = trackedBody('{"a":1}');
      const { error, client } = await reject(
        () => new Response(stream, { status: 200, headers: { "Content-Encoding": encoding, ...RL_HEADERS } }),
      );
      assert.equal(error.constructor, ContrastAPIError);
      assert.equal(error.message, "response has a Content-Encoding other than identity");
      assert.equal(error.status, 200);
      assert.equal(error.rateLimit.remaining, 97);
      assert.equal(client.lastRateLimit.remaining, 97);
      assert.equal(state.pulls, 0);
      assert.equal(state.cancelled, true);
    });
  }
  for (const encoding of ["identity", "IDENTITY", "Identity"]) {
    test(`Content-Encoding ${encoding} is read`, async () => {
      const fetch = fakeFetch(() => json(200, { a: 1 }, { "Content-Encoding": encoding }));
      assert.deepEqual(await new ContrastAPI({ fetch }).health(), { a: 1 });
    });
  }
  test("an encoded 429 is refused as encoded and not retried", async () => {
    const { error, fetch } = await reject(
      () => apiError(429, "rate_limited", "slow", { "Content-Encoding": "gzip", "Retry-After": "0" }),
      undefined,
      { maxRetries: 3 },
    );
    assert.equal(error.constructor, ContrastAPIError);
    assert.equal(error.status, 429);
    assert.equal(fetch.calls.length, 1);
  });
});

describe("parity: a path with a dot segment is refused before any request", () => {
  const base = "https://api.contrastcyber.com/v9";
  const DOT_MESSAGE = "request path must not hold a . or .. segment";
  const sentPaths = ["/x", "//x", "/.well/x", "/x..y", "/x.", "/...", "/x/.x", "/%252e/x", "/%252e%252e/x", "/a%2eb"];
  const refusedPaths = [
    "/.", "/..", "/x/.", "/x/..", "/./x", "/../x", "/a/./b", "/./../x", "/../v9", "/../v9/x", "/../v9x/a",
    "/../v9%2Fx", "/%2e/x", "/%2E/x", "/%2e%2e/x", "/%2E%2E/x", "/.%2e/x", "/.%2E/x", "/%2e./x", "/%2E%2e/x",
  ];
  for (const rawPath of sentPaths) {
    test(`raw path ${rawPath} is sent`, async () => {
      const fetch = fakeFetch();
      await new ContrastAPI({ baseUrl: base, apiKey: KEY, fetch }).request("GET", rawPath);
      assert.equal(fetch.calls.length, 1);
      assert.equal(new URL(fetch.calls[0].url).pathname, "/v9" + rawPath);
    });
  }
  for (const rawPath of refusedPaths) {
    test(`raw path ${rawPath} is refused`, async () => {
      const fetch = fakeFetch();
      const run = new ContrastAPI({ baseUrl: base, apiKey: KEY, fetch }).request("GET", rawPath);
      await assert.rejects(run, { name: "TypeError", message: DOT_MESSAGE });
      assert.equal(fetch.calls.length, 0);
    });
  }
  test("a %2e path that climbs back into the base path is refused", async () => {
    const fetch = fakeFetch();
    const run = new ContrastAPI({ baseUrl: "https://api.contrastcyber.com/v1", fetch }).request("GET", "/../%2e%2e/v1/x");
    await assert.rejects(run, { name: "TypeError", message: DOT_MESSAGE });
    assert.equal(fetch.calls.length, 0);
  });
  test("a raw path that climbs above the root is refused under a root base", async () => {
    const fetch = fakeFetch();
    await assert.rejects(new ContrastAPI({ fetch }).request("GET", "/../x"), { name: "TypeError", message: DOT_MESSAGE });
    assert.equal(fetch.calls.length, 0);
  });
  for (const value of [".", ".."]) {
    test(`a path value ${value} is refused`, async () => {
      const fetch = fakeFetch();
      const run = new ContrastAPI({ baseUrl: base, fetch }).cveLookup({ cve_id: value });
      await assert.rejects(run, { name: "TypeError", message: DOT_MESSAGE });
      assert.equal(fetch.calls.length, 0);
    });
  }
  for (const value of ["%2e", ".%2E"]) {
    test(`a path value ${value} is encoded and sent`, async () => {
      const fetch = fakeFetch();
      await new ContrastAPI({ baseUrl: base, fetch }).cveLookup({ cve_id: value });
      assert.equal(fetch.calls.length, 1);
      assert.equal(new URL(fetch.calls[0].url).pathname, "/v9/cve_lookup/" + value.replace("%", "%25"));
    });
  }
  test("dots in the query are sent", async () => {
    const fetch = fakeFetch();
    await new ContrastAPI({ baseUrl: base, fetch }).request("GET", "/x", { query: { "..": "/../%2e%2e/." } });
    assert.equal(fetch.calls.length, 1);
    assert.equal(new URL(fetch.calls[0].url).search, "?..=%2F..%2F%252e%252e%2F.");
  });
  test("a percent-encoded dot in the base path is not a dot segment", async () => {
    const fetch = fakeFetch();
    await new ContrastAPI({ baseUrl: "https://api.contrastcyber.com/a%2eb", fetch }).request("GET", "/x");
    assert.equal(fetch.calls.length, 1);
  });
  for (const baseUrl of [
    "https://api.contrastcyber.com/.",
    "https://api.contrastcyber.com/v1/..",
    "https://api.contrastcyber.com/v1/../v2",
    "https://api.contrastcyber.com/v1/./",
    "https://api.contrastcyber.com/%2e%2E/v1",
    "https://api.contrastcyber.com/v1/.%2e/",
  ]) {
    test(`baseUrl ${baseUrl} is refused`, () => {
      assert.throws(() => new ContrastAPI({ baseUrl }), {
        name: "TypeError",
        message: "baseUrl path must not hold a . or .. segment",
      });
    });
  }
});

describe("parity: the request URL stays under the base URL", () => {
  const urls = [
    ["https://api.contrastcyber.com/x", "https://api.contrastcyber.com", true],
    ["https://api.contrastcyber.com@evil.example/steal", "https://api.contrastcyber.com", false],
    ["https://api.contrastcyber.com.evil.example/x", "https://api.contrastcyber.com", false],
    ["http://api.contrastcyber.com/x", "https://api.contrastcyber.com", false],
    ["https://api.contrastcyber.com:8443/x", "https://api.contrastcyber.com", false],
    ["https://api.contrastcyber.com:443/x", "https://api.contrastcyber.com", true],
    ["https://API.contrastcyber.com/x", "https://api.contrastcyber.com", true],
    ["https://api.contrastcyber.com/v9/x", "https://api.contrastcyber.com/v9", true],
    ["https://api.contrastcyber.com/v9", "https://api.contrastcyber.com/v9", false],
    ["https://api.contrastcyber.com/v9x/a", "https://api.contrastcyber.com/v9", false],
  ];
  for (const [url, root, under] of urls) {
    test(`${url} is ${under ? "" : "not "}under ${root}`, () => {
      assert.equal(isUnderBase(url, root), under);
    });
  }
  test("a table path that leaves the base origin is refused before any request", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "contrastapi-parity-"));
    try {
      cpSync(fileURLToPath(new URL("../src/", import.meta.url)), dir, { recursive: true });
      const file = path.join(dir, "operations.js");
      const original = readFileSync(file, "utf8");
      const tampered = original.replace('path: "/health",', 'path: "@evil.example/steal",');
      assert.notEqual(tampered, original);
      writeFileSync(file, tampered);
      const { ContrastAPI: Tampered } = await import(pathToFileURL(path.join(dir, "client.js")).href);
      const fetch = fakeFetch();
      await assert.rejects(new Tampered({ apiKey: KEY, fetch }).health(), {
        name: "TypeError",
        message: "request URL is not under baseUrl",
      });
      assert.equal(fetch.calls.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parity: the timeout bounds the wait for the response headers", () => {
  test("a fetch that never answers ends with APITimeoutError at timeoutMs", async () => {
    const answer = (n, url, init) =>
      new Promise((resolve, rejectFetch) => {
        init.signal.addEventListener("abort", () => rejectFetch(init.signal.reason));
      });
    // AbortSignal.timeout does not keep the event loop alive; a socket would. This timer stands in for it.
    const keepAlive = setTimeout(() => {}, 10000);
    try {
      const started = Date.now();
      const { error } = await reject(answer, undefined, { timeoutMs: 1000 });
      assert.equal(error.constructor, APITimeoutError);
      assert.ok(Date.now() - started < 5000);
    } finally {
      clearTimeout(keepAlive);
    }
  });
});

describe("parity: encoded 5xx and retried answers, private-use text", () => {
  for (const status of [503, 500]) {
    test(`an encoded ${status} is refused as encoded`, async () => {
      const { stream, state } = trackedBody('{"error":{"code":"upstream_busy","message":"m"}}');
      const { error, fetch } = await reject(
        () => new Response(stream, { status, headers: { "Content-Encoding": "gzip", "Retry-After": "0" } }),
      );
      assert.equal(error.constructor, ContrastAPIError);
      assert.equal(error.message, "response has a Content-Encoding other than identity");
      assert.equal(error.status, status);
      assert.equal(state.pulls, 0);
      assert.equal(fetch.calls.length, 1);
    });
  }
  test("an encoded answer after a busy retry is refused and its body is not read", async () => {
    const { stream, state } = trackedBody('{"a":1}');
    const { error, fetch } = await reject((n) =>
      n === 1
        ? apiError(503, "upstream_busy", "busy", { "Retry-After": "0" })
        : new Response(stream, { status: 200, headers: { "Content-Encoding": "gzip" } }),
    );
    assert.equal(error.constructor, ContrastAPIError);
    assert.equal(error.message, "response has a Content-Encoding other than identity");
    assert.equal(fetch.calls.length, 2);
    assert.equal(state.pulls, 0);
  });
  test("a private-use character stays in the message", async () => {
    const { error } = await reject(() => apiError(400, "c", "a\ue000b"));
    assert.equal(error.message, "a\ue000b");
  });
});

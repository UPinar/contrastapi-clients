// URL building, headers, key policy, construction guards.
import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ContrastAPI } from "../src/index.js";
import { fakeFetch, json, KEY } from "./fake_fetch.js";

const SAVED_ENV = process.env.CONTRASTAPI_API_KEY;
beforeEach(() => {
  delete process.env.CONTRASTAPI_API_KEY;
});
after(() => {
  if (SAVED_ENV === undefined) delete process.env.CONTRASTAPI_API_KEY;
  else process.env.CONTRASTAPI_API_KEY = SAVED_ENV;
});

async function firstCall(options, run) {
  const fetch = fakeFetch();
  const client = new ContrastAPI({ fetch, ...options });
  await run(client);
  assert.equal(fetch.calls.length, 1);
  return fetch.calls[0];
}

describe("base URL", () => {
  test("default base URL", async () => {
    const c = await firstCall({}, (cl) => cl.health());
    assert.equal(c.url, "https://api.contrastcyber.com/health");
    assert.equal(c.init.method, "GET");
  });

  const accepted = [
    ["https://example.com", "https://example.com/health"],
    ["https://example.com/", "https://example.com/health"],
    ["https://example.com//", "https://example.com/health"],
    ["https://example.com/api/", "https://example.com/api/health"],
    ["https://example.com:8443/api", "https://example.com:8443/api/health"],
    ["http://localhost:8080", "http://localhost:8080/health"],
    ["http://127.0.0.1:8080/", "http://127.0.0.1:8080/health"],
    ["http://[::1]:8080", "http://[::1]:8080/health"],
  ];
  for (const [base, url] of accepted) {
    test(`baseUrl ${base} -> ${url}`, async () => {
      const c = await firstCall({ baseUrl: base }, (cl) => cl.health());
      assert.equal(c.url, url);
    });
  }

  const refused = [
    "http://example.com",
    "http://localhost.example.com",
    "http://127.0.0.2",
    "http://api.contrastcyber.com",
    "ftp://example.com",
    "not a url",
    "",
    "https://user:pass@example.com",
    "https://user@example.com",
    "https://:pass@example.com",
    "https://example.com/?a=1",
    "https://example.com?",
    "https://example.com/#frag",
    "https://example.com#",
  ];
  for (const base of refused) {
    test(`baseUrl ${JSON.stringify(base)} is refused`, () => {
      assert.throws(
        () => new ContrastAPI({ baseUrl: base, fetch: fakeFetch() }),
        (e) => e instanceof TypeError && /^baseUrl /.test(e.message),
      );
    });
  }

  test("non-string baseUrl is refused, a URL object too", () => {
    for (const base of [42, new URL("https://example.com")]) {
      assert.throws(
        () => new ContrastAPI({ baseUrl: base, fetch: fakeFetch() }),
        (e) => e instanceof TypeError && /^baseUrl /.test(e.message),
      );
    }
  });
});

describe("path, query and body", () => {
  const paths = [
    ["CVE-2021-44228", "/cve_lookup/CVE-2021-44228"],
    ["::1", "/cve_lookup/::1"],
    ["user@example.com", "/cve_lookup/user@example.com"],
    ["a/b", "/cve_lookup/a%2Fb"],
    ["100%", "/cve_lookup/100%25"],
    ["a b", "/cve_lookup/a%20b"],
    ["x?y#z", "/cve_lookup/x%3Fy%23z"],
    ["!$&'()*+,;=:@-._~", "/cve_lookup/!$&'()*+,;=:@-._~"],
    ["\"<>[]\\^`{|}", "/cve_lookup/%22%3C%3E%5B%5D%5C%5E%60%7B%7C%7D"],
    ["ü€", "/cve_lookup/%C3%BC%E2%82%AC"],
    ["\n\u007f", "/cve_lookup/%0A%7F"],
    [12, "/cve_lookup/12"],
  ];
  for (const [value, path] of paths) {
    test(`path arg ${JSON.stringify(value)} -> ${path}`, async () => {
      const c = await firstCall({}, (cl) => cl.cveLookup({ cve_id: value }));
      assert.equal(c.url, "https://api.contrastcyber.com" + path);
    });
  }

  test("query follows params order, booleans, numbers, omission", async () => {
    const c = await firstCall({}, (cl) =>
      cl.cveSearch({
        limit: 5,
        known_ransomware: false,
        in_kev: true,
        product: null,
        vendor: undefined,
        min_cvss: 7.5,
        severity: "HIGH",
      }),
    );
    assert.equal(
      c.url,
      "https://api.contrastcyber.com/cve_search?severity=HIGH&min_cvss=7.5&in_kev=true&known_ransomware=false&limit=5",
    );
    assert.equal(c.init.body, undefined);
  });

  test("query values are percent-encoded, space as %20", async () => {
    const c = await firstCall({}, (cl) => cl.cveSearch({ vendor: "a b&c=d" }));
    assert.equal(c.url, "https://api.contrastcyber.com/cve_search?vendor=a%20b%26c%3Dd");
  });

  test("empty query adds no question mark", async () => {
    const c = await firstCall({}, (cl) => cl.cveSearch());
    assert.equal(c.url, "https://api.contrastcyber.com/cve_search");
    const d = await firstCall({}, (cl) => cl.cveSearch({ vendor: null, product: undefined }));
    assert.equal(d.url, "https://api.contrastcyber.com/cve_search");
  });

  test("offset 0 and empty string are sent", async () => {
    const c = await firstCall({}, (cl) => cl.cveSearch({ vendor: "", offset: 0 }));
    assert.equal(c.url, "https://api.contrastcyber.com/cve_search?vendor=&offset=0");
  });

  test("body args go as a JSON object with Content-Type", async () => {
    const c = await firstCall({}, (cl) => cl.cveLookupBulk({ cve_ids: ["CVE-1", "CVE-2"] }));
    assert.equal(c.url, "https://api.contrastcyber.com/cve_lookup_bulk");
    assert.equal(c.init.method, "POST");
    assert.equal(c.init.body, '{"cve_ids":["CVE-1","CVE-2"]}');
    assert.equal(c.init.headers["Content-Type"], "application/json");
  });
});

describe("headers and fetch init", () => {
  test("GET sends Accept, Accept-Encoding identity, User-Agent, redirect manual, a live signal and no Content-Type", async () => {
    const c = await firstCall({}, (cl) => cl.health());
    assert.deepEqual(c.init.headers, {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "User-Agent": "contrastapi-node/2.0.0",
    });
    assert.equal(c.init.redirect, "manual");
    assert.ok(c.init.signal instanceof AbortSignal);
    assert.equal(c.init.signal.aborted, false);
    assert.equal(c.init.body, undefined);
  });

  test("User-Agent version matches package.json", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const c = await firstCall({}, (cl) => cl.health());
    assert.equal(c.init.headers["User-Agent"], `contrastapi-node/${pkg.version}`);
  });
});

describe("key policy", () => {
  const sends = [
    [{}, true],
    [{ baseUrl: "https://api.contrastcyber.com/" }, true],
    [{ baseUrl: "https://API.ContrastCyber.com" }, true],
    [{ baseUrl: "http://localhost:3000" }, true],
    [{ baseUrl: "https://localhost" }, true],
    [{ baseUrl: "http://127.0.0.1:3000" }, true],
    [{ baseUrl: "http://[::1]:3000" }, true],
    [{ baseUrl: "https://example.com" }, false],
    [{ baseUrl: "https://api.contrastcyber.com.evil.example" }, false],
    [{ baseUrl: "https://evil.example/api.contrastcyber.com" }, false],
    [{ baseUrl: "https://evil.api.contrastcyber.com" }, false],
    [{ baseUrl: "https://localhost.evil.example" }, false],
    [{ baseUrl: "https://127.0.0.1.evil.example" }, false],
    [{ baseUrl: "https://example.com", trustHost: true }, true],
    [{ baseUrl: "https://example.com", trustHost: "true" }, false],
    [{ baseUrl: "https://example.com", trustHost: 1 }, false],
    [{ baseUrl: "https://example.com", trustHost: false }, false],
  ];
  for (const [opts, sent] of sends) {
    test(`${JSON.stringify(opts)} ${sent ? "sends" : "withholds"} the key`, async () => {
      const c = await firstCall({ apiKey: KEY, ...opts }, (cl) => cl.health());
      assert.equal(c.init.headers["X-API-Key"], sent ? KEY : undefined);
      assert.equal(Object.keys(c.init.headers).length, sent ? 4 : 3);
    });
  }

  test("no key configured sends no header", async () => {
    const c = await firstCall({}, (cl) => cl.health());
    assert.equal(c.init.headers["X-API-Key"], undefined);
  });

  test("env fallback when apiKey is undefined", async () => {
    process.env.CONTRASTAPI_API_KEY = "sk_env_1";
    const c = await firstCall({}, (cl) => cl.health());
    assert.equal(c.init.headers["X-API-Key"], "sk_env_1");
    const d = await firstCall({ apiKey: undefined }, (cl) => cl.health());
    assert.equal(d.init.headers["X-API-Key"], "sk_env_1");
  });

  test("explicit key wins over env", async () => {
    process.env.CONTRASTAPI_API_KEY = "sk_env_1";
    const c = await firstCall({ apiKey: "sk_explicit" }, (cl) => cl.health());
    assert.equal(c.init.headers["X-API-Key"], "sk_explicit");
  });

  test("explicit empty key means no key even with env set", async () => {
    process.env.CONTRASTAPI_API_KEY = "sk_env_1";
    const c = await firstCall({ apiKey: "" }, (cl) => cl.health());
    assert.equal(c.init.headers["X-API-Key"], undefined);
  });

  test("env key is trimmed", async () => {
    process.env.CONTRASTAPI_API_KEY = "  sk_env_2\n";
    const c = await firstCall({}, (cl) => cl.health());
    assert.equal(c.init.headers["X-API-Key"], "sk_env_2");
  });

  test("empty env means no key", async () => {
    process.env.CONTRASTAPI_API_KEY = "";
    const c = await firstCall({}, (cl) => cl.health());
    assert.equal(c.init.headers["X-API-Key"], undefined);
  });

  test("a key with a control character or a non-string key is refused without echoing it", () => {
    for (const bad of ["sk_a\nX-Evil: 1", "sk\u0000", "sk ü", "sk a", "sk\u007f", "sk\u0080"]) {
      assert.throws(
        () => new ContrastAPI({ apiKey: bad, fetch: fakeFetch() }),
        (e) => e instanceof TypeError && !e.message.includes("sk"),
      );
    }
    assert.throws(() => new ContrastAPI({ apiKey: 123, fetch: fakeFetch() }), TypeError);
  });
});

describe("default fetch", () => {
  test("globalThis.fetch is used when no fetch is given", async (t) => {
    const spy = t.mock.method(globalThis, "fetch", async () => json(200, { g: 1 }));
    const client = new ContrastAPI();
    assert.deepEqual(await client.health(), { g: 1 });
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(spy.mock.calls[0].arguments[0], "https://api.contrastcyber.com/health");
  });
});

describe("timeout", () => {
  const cases = [
    [undefined, 30000],
    [999, 1000],
    [1000, 1000],
    [1001, 1001],
    [119999, 119999],
    [120000, 120000],
    [120001, 120000],
    [0, 1000],
    [-5, 1000],
    [NaN, 30000],
    [Infinity, 30000],
    [-Infinity, 30000],
    ["5000", 30000],
  ];
  for (const [given, used] of cases) {
    test(`timeoutMs ${String(given)} -> ${used}`, async (t) => {
      const spy = t.mock.method(AbortSignal, "timeout");
      await firstCall({ timeoutMs: given }, (cl) => cl.health());
      assert.equal(spy.mock.calls.length, 1);
      assert.deepEqual(spy.mock.calls[0].arguments, [used]);
    });
  }

  test("each attempt gets its own timeout signal", async (t) => {
    const spy = t.mock.method(AbortSignal, "timeout");
    const fetch = fakeFetch();
    const client = new ContrastAPI({ fetch });
    await client.health();
    await client.health();
    assert.equal(spy.mock.calls.length, 2);
    assert.notEqual(fetch.calls[0].init.signal, fetch.calls[1].init.signal);
  });
});

describe("raw request()", () => {
  test("query object and JSON body", async () => {
    const c = await firstCall({ apiKey: KEY }, (cl) =>
      cl.request("POST", "/raw/path", { query: { a: 1, b: true, c: null, d: undefined, e: false }, body: { k: [1] } }),
    );
    assert.equal(c.url, "https://api.contrastcyber.com/raw/path?a=1&b=true&e=false");
    assert.equal(c.init.method, "POST");
    assert.equal(c.init.body, '{"k":[1]}');
    assert.equal(c.init.headers["Content-Type"], "application/json");
    assert.equal(c.init.headers["X-API-Key"], KEY);
    assert.equal(c.init.redirect, "manual");
  });

  test("no query and no body", async () => {
    const c = await firstCall({}, (cl) => cl.request("GET", "/health"));
    assert.equal(c.url, "https://api.contrastcyber.com/health");
    assert.equal(c.init.body, undefined);
    assert.equal(c.init.headers["Content-Type"], undefined);
  });

  test("withholds the key from an untrusted host", async () => {
    const c = await firstCall({ apiKey: KEY, baseUrl: "https://example.com" }, (cl) => cl.request("GET", "/x"));
    assert.equal(c.init.headers["X-API-Key"], undefined);
  });

  test("path without a leading slash is a TypeError before any fetch", async () => {
    const fetch = fakeFetch();
    const client = new ContrastAPI({ fetch });
    for (const p of ["health", "", "https://evil.example/x", 5]) {
      await assert.rejects(client.request("GET", p), (e) => e instanceof TypeError && /must start with/.test(e.message));
    }
    assert.equal(fetch.calls.length, 0);
  });

  test("method must be a non-empty string; it is upper-cased", async () => {
    const fetch = fakeFetch();
    const client = new ContrastAPI({ fetch });
    for (const m of ["", 5, undefined]) {
      await assert.rejects(client.request(m, "/x"), (e) => e instanceof TypeError && /method/.test(e.message));
    }
    assert.equal(fetch.calls.length, 0);
    await client.request("post", "/x");
    assert.equal(fetch.calls[0].init.method, "POST");
  });

  test("query null is no query; a non-object query is a TypeError", async () => {
    const fetch = fakeFetch();
    const client = new ContrastAPI({ fetch });
    await client.request("GET", "/x", { query: null });
    assert.equal(fetch.calls[0].url, "https://api.contrastcyber.com/x");
    await assert.rejects(client.request("GET", "/x", { query: "ab" }), (e) => e instanceof TypeError && /query/.test(e.message));
    assert.equal(fetch.calls.length, 1);
  });

  test("a null body sends no body", async () => {
    const c = await firstCall({}, (cl) => cl.request("POST", "/x", { body: null }));
    assert.equal(c.init.body, undefined);
    assert.equal(c.init.headers["Content-Type"], undefined);
  });

  test("returns the parsed body", async () => {
    const fetch = fakeFetch(() => json(200, { hello: "world" }));
    const client = new ContrastAPI({ fetch });
    assert.deepEqual(await client.request("GET", "/x"), { hello: "world" });
  });
});

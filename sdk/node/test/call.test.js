// call() argument checks, generated methods, exports.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as sdk from "../src/index.js";
import { ContrastAPI } from "../src/index.js";
import { installOperationMethods, buildRequest } from "../src/client.js";
import { OPERATIONS } from "../src/operations.js";
import { fakeFetch, json } from "./fake_fetch.js";

describe("exports", () => {
  test("src/index.js exports the client and every error class", () => {
    assert.deepEqual(Object.keys(sdk).sort(), [
      "APIConnectionError",
      "APITimeoutError",
      "AuthenticationError",
      "BadRequestError",
      "ContrastAPI",
      "ContrastAPIError",
      "NotFoundError",
      "RateLimitError",
      "UpstreamError",
    ]);
  });

  test("the package name resolves to src/index.js", async () => {
    const self = await import("contrastapi");
    assert.equal(self.ContrastAPI, ContrastAPI);
  });

  test("OPERATIONS is frozen at every level", () => {
    assert.ok(Object.isFrozen(OPERATIONS));
    for (const op of Object.values(OPERATIONS)) {
      assert.ok(Object.isFrozen(op));
      assert.ok(Object.isFrozen(op.params));
      for (const p of op.params) assert.ok(Object.isFrozen(p));
    }
  });
});

describe("call() refuses before any fetch", () => {
  const bad = [
    ["unknown operation", () => ["nope", {}], /nope/],
    ["inherited name as operation", () => ["toString", {}], /toString/],
    ["args is an array", () => ["cve_lookup", ["CVE-1"]], /plain object/],
    ["args is null", () => ["cve_lookup", null], /plain object/],
    ["args is a string", () => ["cve_lookup", "CVE-1"], /plain object/],
    ["args is a Date", () => ["health", new Date()], /plain object/],
    ["unknown key", () => ["cve_lookup", { cve_id: "CVE-1", bogus: 1 }], /bogus/],
    ["unknown key on health", () => ["health", { verbose: true }], /verbose/],
    ["missing required", () => ["cve_lookup", {}], /cve_id/],
    ["required is undefined", () => ["cve_lookup", { cve_id: undefined }], /cve_id/],
    ["required is null", () => ["cve_lookup", { cve_id: null }], /cve_id/],
    ["missing required body", () => ["cve_lookup_bulk", {}], /cve_ids/],
  ];
  for (const [name, args, msg] of bad) {
    test(name, async () => {
      const fetch = fakeFetch();
      const client = new ContrastAPI({ fetch });
      await assert.rejects(client.call(...args()), (e) => e instanceof TypeError && msg.test(e.message));
      assert.equal(fetch.calls.length, 0);
    });
  }

  test("a null-prototype args object is accepted", async () => {
    const fetch = fakeFetch();
    const client = new ContrastAPI({ fetch });
    const args = Object.create(null);
    args.cve_id = "CVE-1";
    await client.call("cve_lookup", args);
    assert.equal(fetch.calls[0].url, "https://api.contrastcyber.com/cve_lookup/CVE-1");
  });

  test("args may be omitted for an operation without required params", async () => {
    const fetch = fakeFetch(() => json(200, { status: "ok" }));
    const client = new ContrastAPI({ fetch });
    assert.deepEqual(await client.call("health"), { status: "ok" });
    assert.equal(fetch.calls.length, 1);
  });
});

describe("buildRequest on a synthetic operation", () => {
  const op = {
    method: "PUT",
    path: "/a/{x}/b/{y}",
    params: [
      { name: "y", in: "path", required: true },
      { name: "x", in: "path", required: true },
      { name: "q", in: "query", required: false },
      { name: "b1", in: "body", required: true },
      { name: "b2", in: "body", required: false },
      { name: "b3", in: "body", required: false },
    ],
  };

  test("every path param is filled, optional body params left out", () => {
    const r = buildRequest("syn", op, { x: "1/2", y: "$&", q: false, b1: 0, b2: null });
    assert.equal(r.method, "PUT");
    assert.equal(r.path, "/a/1%2F2/b/$&");
    assert.equal(r.search.toString(), "q=false");
    assert.deepEqual(r.body, { b1: 0 });
  });

  test("an operation without body params has no body", () => {
    const r = buildRequest("syn", { method: "GET", path: "/p", params: [{ name: "q", in: "query", required: false }] }, {});
    assert.equal(r.body, undefined);
    assert.equal(r.search.toString(), "");
  });

  test("a body operation whose optional params are all left out sends {}", () => {
    const r = buildRequest("syn", { method: "POST", path: "/p", params: [{ name: "b", in: "body", required: false }] }, {});
    assert.deepEqual(r.body, {});
  });

  test("undefined args is a TypeError naming the shape", () => {
    assert.throws(() => buildRequest("syn", op, undefined), (e) => e instanceof TypeError && /plain object/.test(e.message));
  });

  test("false and 0 satisfy a required param", () => {
    const r = buildRequest("syn", op, { x: 0, y: false, b1: false });
    assert.equal(r.path, "/a/0/b/false");
    assert.deepEqual(r.body, { b1: false });
  });
});

describe("generated methods", () => {
  test("every operation is installed on the prototype", () => {
    for (const op of Object.values(OPERATIONS)) {
      assert.equal(typeof ContrastAPI.prototype[op.methodName], "function", op.methodName);
    }
  });

  test("cveLookup(args) is call('cve_lookup', args)", async () => {
    const fetch = fakeFetch(() => json(200, { cve_id: "CVE-2021-44228" }));
    const client = new ContrastAPI({ fetch });
    assert.deepEqual(await client.cveLookup({ cve_id: "CVE-2021-44228" }), { cve_id: "CVE-2021-44228" });
    assert.equal(fetch.calls[0].url, "https://api.contrastcyber.com/cve_lookup/CVE-2021-44228");
  });

  test("installOperationMethods forwards the operation id and args", () => {
    class Probe {
      call(id, args) {
        return [id, args];
      }
    }
    installOperationMethods(Probe.prototype, { my_op: { methodName: "myOp" } });
    assert.deepEqual(new Probe().myOp({ a: 1 }), ["my_op", { a: 1 }]);
    assert.equal(Object.getOwnPropertyDescriptor(Probe.prototype, "myOp").enumerable, false);
  });

  for (const name of ["call", "request", "lastRateLimit", "constructor", "cveLookup", "toString", "__proto__"]) {
    test(`a methodName colliding with ${name} throws and installs nothing`, () => {
      const before = Object.getOwnPropertyNames(ContrastAPI.prototype).sort();
      const callBefore = ContrastAPI.prototype.call;
      assert.throws(
        () =>
          installOperationMethods(ContrastAPI.prototype, {
            a_first: { methodName: "aFirstFresh" },
            z_bad: { methodName: name },
          }),
        (e) => e instanceof Error && e.message.includes(name),
      );
      assert.deepEqual(Object.getOwnPropertyNames(ContrastAPI.prototype).sort(), before);
      assert.equal(ContrastAPI.prototype.call, callBefore);
    });
  }

  test("two operations with one methodName throw", () => {
    class Probe {
      call() {}
    }
    assert.throws(
      () => installOperationMethods(Probe.prototype, { a: { methodName: "same" }, b: { methodName: "same" } }),
      /same/,
    );
    assert.equal(Probe.prototype.same, undefined);
  });
});

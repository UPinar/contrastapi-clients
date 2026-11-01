// The generated operation table against the committed OpenAPI document.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OPERATIONS } from "../src/operations.js";

const document = JSON.parse(readFileSync(new URL("../../openapi.json", import.meta.url), "utf8"));

function documentOperationIds() {
  const ids = [];
  for (const item of Object.values(document.paths)) {
    for (const op of Object.values(item)) {
      const content = op.requestBody?.content ?? {};
      if (Object.keys(content).join() === "application/octet-stream") continue;
      ids.push(op.operationId);
    }
  }
  return ids;
}

describe("OPERATIONS", () => {
  test("holds every JSON operation of the document, in document order", () => {
    assert.deepEqual(Object.keys(OPERATIONS), documentOperationIds());
    assert.ok(Object.keys(OPERATIONS).length > 4);
  });

  test("every entry has methodName, method, path and params", () => {
    for (const [id, op] of Object.entries(OPERATIONS)) {
      assert.deepEqual(Object.keys(op), ["methodName", "method", "path", "params"], id);
      assert.equal(typeof op.methodName, "string", id);
      assert.ok(op.method === "GET" || op.method === "POST", id);
      assert.ok(op.path.startsWith("/"), id);
      assert.ok(Array.isArray(op.params), id);
      for (const p of op.params) {
        assert.deepEqual(Object.keys(p), ["name", "in", "required"], id);
        assert.ok(["path", "query", "body"].includes(p.in), `${id}.${p.name}`);
        assert.equal(typeof p.required, "boolean", `${id}.${p.name}`);
      }
    }
  });

  test("path placeholders equal the path params", () => {
    for (const [id, op] of Object.entries(OPERATIONS)) {
      const placeholders = [...op.path.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).sort();
      const pathParams = op.params.filter((p) => p.in === "path").map((p) => p.name).sort();
      assert.deepEqual(placeholders, pathParams, id);
      for (const p of op.params.filter((q) => q.in === "path")) assert.equal(p.required, true, id);
    }
  });

  test("image_inspect takes raw bytes and is left out", () => {
    assert.ok(documentOperationIds().length < JSON.stringify(document.paths).split('"operationId"').length - 1);
    assert.equal(Object.hasOwn(OPERATIONS, "image_inspect"), false);
  });

  test("cve_lookup takes include_ghsa as an optional query param", () => {
    assert.deepEqual(OPERATIONS.cve_lookup.params, [
      { name: "cve_id", in: "path", required: true },
      { name: "include_ghsa", in: "query", required: false },
    ]);
  });

  test("method names are the camelCase of the operation ids", () => {
    for (const [id, op] of Object.entries(OPERATIONS)) {
      assert.equal(op.methodName, id.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()), id);
    }
  });
});

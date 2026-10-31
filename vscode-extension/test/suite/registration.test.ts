import * as assert from "assert";
import {
  buildServerDefinitionHeaders,
  isRegistrationEnabled,
  mcpServerUrl,
} from "../../src/mcp/registration";

const SAMPLE = "sample-0417";

let passed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.log("registration.test.ts");

test("the production host over https gets the key", () => {
  assert.deepStrictEqual(buildServerDefinitionHeaders("https://api.contrastcyber.com", SAMPLE), { Authorization: `Bearer ${SAMPLE}` });
  assert.deepStrictEqual(buildServerDefinitionHeaders("https://api.contrastcyber.com/", SAMPLE), { Authorization: `Bearer ${SAMPLE}` });
});

test("this machine over plain http gets the key", () => {
  assert.deepStrictEqual(buildServerDefinitionHeaders("http://localhost:8714", SAMPLE), { Authorization: `Bearer ${SAMPLE}` });
  assert.deepStrictEqual(buildServerDefinitionHeaders("http://127.0.0.1:8714/", SAMPLE), { Authorization: `Bearer ${SAMPLE}` });
});

test("look-alike and other hosts never get the key", () => {
  for (const base of [
    "https://api.contrastcyber.com.evil.example",
    "https://evilapi.contrastcyber.com",
    "https://contrastcyber.com",
    "https://api.contrastcyber.com@evil.example",
    "https://localhost.evil.example",
    "https://example.org",
  ]) {
    assert.deepStrictEqual(buildServerDefinitionHeaders(base, SAMPLE), {}, base);
  }
});

test("the production host over plain http does not get the key", () => {
  assert.deepStrictEqual(buildServerDefinitionHeaders("http://api.contrastcyber.com", SAMPLE), {});
});

test("an empty key or an unparseable URL gives no header", () => {
  assert.deepStrictEqual(buildServerDefinitionHeaders("https://api.contrastcyber.com", ""), {});
  assert.deepStrictEqual(buildServerDefinitionHeaders("http://localhost:8714", ""), {});
  assert.deepStrictEqual(buildServerDefinitionHeaders("not a url", SAMPLE), {});
  assert.deepStrictEqual(buildServerDefinitionHeaders("", SAMPLE), {});
});

test("each call returns a fresh object", () => {
  const a = buildServerDefinitionHeaders("https://api.contrastcyber.com", SAMPLE);
  a.Authorization = "changed";
  assert.deepStrictEqual(buildServerDefinitionHeaders("https://api.contrastcyber.com", SAMPLE), { Authorization: `Bearer ${SAMPLE}` });
});

test("mcpServerUrl appends /mcp to an allowed base URL", () => {
  assert.strictEqual(mcpServerUrl("https://api.contrastcyber.com"), "https://api.contrastcyber.com/mcp");
  assert.strictEqual(mcpServerUrl("https://api.contrastcyber.com///"), "https://api.contrastcyber.com/mcp");
  assert.strictEqual(mcpServerUrl("http://localhost:8714/"), "http://localhost:8714/mcp");
  assert.strictEqual(mcpServerUrl("https://mirror.example.net/base"), "https://mirror.example.net/base/mcp");
});

test("mcpServerUrl refuses plain http to another host and unparseable text", () => {
  assert.strictEqual(mcpServerUrl("http://api.contrastcyber.com"), undefined);
  assert.strictEqual(mcpServerUrl("ftp://api.contrastcyber.com"), undefined);
  assert.strictEqual(mcpServerUrl("not a url"), undefined);
});

test("the key is trimmed, so a key stored with spaces by an older version still authenticates", () => {
  assert.deepStrictEqual(buildServerDefinitionHeaders("https://api.contrastcyber.com", ` ${SAMPLE}\n`), { Authorization: `Bearer ${SAMPLE}` });
  assert.deepStrictEqual(buildServerDefinitionHeaders("https://api.contrastcyber.com", " \t"), {});
});

test("isRegistrationEnabled is true only for the exact value on", () => {
  assert.strictEqual(isRegistrationEnabled("on"), true);
  for (const v of ["off", "ON", "On", " on", "", undefined, true, 1]) {
    assert.strictEqual(isRegistrationEnabled(v), false, String(v));
  }
});

console.log(`\nAll ${passed} registration tests passed.`);

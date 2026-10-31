import * as assert from "assert";
import { detectIndicator } from "../../src/context/detectors";

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.log("detectors.test.ts");

test("detects CVE IDs", () => {
  assert.strictEqual(detectIndicator("CVE-2024-3094"), "cve");
  assert.strictEqual(detectIndicator("cve-2023-44487"), "cve");
  assert.strictEqual(detectIndicator("CVE-2024-12345"), "cve");
});

test("detects CWE IDs", () => {
  assert.strictEqual(detectIndicator("CWE-79"), "cwe");
  assert.strictEqual(detectIndicator("cwe-89"), "cwe");
  assert.strictEqual(detectIndicator("CWE-502"), "cwe");
});

test("detects ATLAS technique IDs", () => {
  assert.strictEqual(detectIndicator("AML.T0043"), "atlas");
  assert.strictEqual(detectIndicator("aml.t0051.000"), "atlas");
  assert.strictEqual(detectIndicator("AML.T0024.001"), "atlas");
});

test("detects ATLAS case study IDs", () => {
  assert.strictEqual(detectIndicator("AML.CS0000"), "atlas_case_study");
  assert.strictEqual(detectIndicator("aml.cs0021"), "atlas_case_study");
});

test("detects D3FEND defense IDs", () => {
  assert.strictEqual(detectIndicator("D3-NTA"), "d3fend");
  assert.strictEqual(detectIndicator("d3-mfa"), "d3fend");
  assert.strictEqual(detectIndicator("D3-FBA"), "d3fend");
});

test("detects ATT&CK technique IDs", () => {
  assert.strictEqual(detectIndicator("T1566"), "attack_technique");
  assert.strictEqual(detectIndicator("T1059.001"), "attack_technique");
});

test("detects IPv4 addresses", () => {
  assert.strictEqual(detectIndicator("8.8.8.8"), "ip");
  assert.strictEqual(detectIndicator("192.168.1.1"), "ip");
  assert.strictEqual(detectIndicator("255.255.255.255"), "ip");
  assert.strictEqual(detectIndicator("0.0.0.0"), "ip");
});

test("rejects invalid IPv4", () => {
  assert.strictEqual(detectIndicator("256.1.1.1"), "unknown");
  assert.strictEqual(detectIndicator("8.8.8"), "unknown");
});

test("detects SHA-256 hashes", () => {
  assert.strictEqual(
    detectIndicator("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
    "hash_sha256",
  );
});

test("detects SHA-1 hashes", () => {
  assert.strictEqual(
    detectIndicator("da39a3ee5e6b4b0d3255bfef95601890afd80709"),
    "hash_sha1",
  );
});

test("detects MD5 hashes", () => {
  assert.strictEqual(
    detectIndicator("d41d8cd98f00b204e9800998ecf8427e"),
    "hash_md5",
  );
});

test("detects URLs", () => {
  assert.strictEqual(detectIndicator("https://evil.com/phishing"), "url");
  assert.strictEqual(detectIndicator("http://example.com"), "url");
});

test("detects email addresses", () => {
  assert.strictEqual(detectIndicator("user@example.com"), "email");
  assert.strictEqual(detectIndicator("test@sub.domain.org"), "email");
});

test("detects domains", () => {
  assert.strictEqual(detectIndicator("example.com"), "domain");
  assert.strictEqual(detectIndicator("sub.example.co.uk"), "domain");
});

test("returns unknown for unrecognized input", () => {
  assert.strictEqual(detectIndicator("hello world"), "unknown");
  assert.strictEqual(detectIndicator(""), "unknown");
  assert.strictEqual(detectIndicator("  "), "unknown");
  assert.strictEqual(detectIndicator("random-text-123"), "unknown");
});

test("trims whitespace", () => {
  assert.strictEqual(detectIndicator("  8.8.8.8  "), "ip");
  assert.strictEqual(detectIndicator("\tCVE-2024-3094\n"), "cve");
});

test("hash length priority: SHA-256 > SHA-1 > MD5", () => {
  assert.strictEqual(
    detectIndicator("a".repeat(64)),
    "hash_sha256",
  );
  assert.strictEqual(
    detectIndicator("a".repeat(40)),
    "hash_sha1",
  );
  assert.strictEqual(
    detectIndicator("a".repeat(32)),
    "hash_md5",
  );
});

console.log("\nAll detector tests passed.");

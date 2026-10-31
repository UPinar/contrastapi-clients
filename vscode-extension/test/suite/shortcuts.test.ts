import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { TOOL_SHORTCUTS, missingToolMessage } from "../../src/commands/shortcuts";
import { McpTool } from "../../src/mcp/client";

const SNAPSHOT_PATH = path.join(__dirname, "../../../claude-desktop-extension/tools_list.json");
const SNAPSHOT_NAMES = new Set(
  (JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as { result: { tools: McpTool[] } }).result.tools.map((t) => t.name),
);

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

console.log("shortcuts.test.ts");

test("missingToolMessage says the list has not loaded when there is no list", () => {
  const message = missingToolMessage("CVE Lookup", false);
  assert.ok(!message.includes("no longer available"), message);
  assert.ok(message.includes("has not loaded"), message);
  assert.ok(message.includes("Check your connection"), message);
});

test("missingToolMessage says the tool is gone when a loaded list lacks it", () => {
  assert.strictEqual(missingToolMessage("CVE Lookup", true), "CVE Lookup is no longer available on this server.");
});

test("every shortcut names a tool of the snapshot and a distinct command", () => {
  const expected: [string, string][] = [
    ["contrastapi.cveLookup", "cve_lookup"],
    ["contrastapi.ipLookup", "ip_lookup"],
    ["contrastapi.dnsLookup", "dns_lookup"],
    ["contrastapi.sslCheck", "ssl_check"],
    ["contrastapi.packageCheck", "package_check"],
  ];
  assert.deepStrictEqual(TOOL_SHORTCUTS.map((s) => [s.command, s.toolName]), expected);
  for (const s of TOOL_SHORTCUTS) {
    assert.ok(SNAPSHOT_NAMES.has(s.toolName), s.toolName);
    assert.ok(s.title.length > 0);
  }
  assert.deepStrictEqual(
    TOOL_SHORTCUTS.map((s) => s.title),
    ["CVE Lookup", "IP Lookup", "DNS Lookup", "SSL Check", "Package Check"],
  );
});

console.log(`\nAll ${passed} shortcuts tests passed.`);

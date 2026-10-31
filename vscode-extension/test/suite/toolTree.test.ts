import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { MCP_CATEGORY_META_KEY, McpTool } from "../../src/mcp/client";
import { toolPickItems } from "../../src/views/toolPick";
import { CATEGORY_ORDER, OTHER_CATEGORY, firstSentence, groupToolsByCategory, toolLabel } from "../../src/views/toolTree";

const SNAPSHOT_PATH = path.join(__dirname, "../../../claude-desktop-extension/tools_list.json");
const SNAPSHOT_TOOLS = (
  JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as { result: { tools: McpTool[] } }
).result.tools;

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

function mk(name: string, category?: unknown, title?: string): McpTool {
  const tool: McpTool = { name, inputSchema: { type: "object", properties: {} } };
  if (category !== undefined) {
    tool._meta = { [MCP_CATEGORY_META_KEY]: category };
  }
  if (title !== undefined) {
    tool.title = title;
  }
  return tool;
}

console.log("toolTree.test.ts");

test("OTHER_CATEGORY is Other", () => {
  assert.strictEqual(OTHER_CATEGORY, "Other");
});

test("CATEGORY_ORDER is the server's home page section order", () => {
  assert.deepStrictEqual(CATEGORY_ORDER, [
    "CVE Intelligence",
    "Package Vulnerabilities (SBOM)",
    "Credential Checks",
    "Domain Intelligence",
    "IP Intelligence",
    "Threat Defense",
    "Monitoring",
    "Operations",
  ]);
});

test("known categories follow CATEGORY_ORDER, unknown ones follow in first-seen order, Other comes last", () => {
  const groups = groupToolsByCategory([
    mk("ops_first", "Operations"),
    mk("zulu_first", "Zulu Feeds"),
    mk("no_meta"),
    mk("cve_first", "CVE Intelligence"),
    mk("number_meta", 42),
    mk("alpha_only", "Alpha Intel"),
    mk("zulu_second", "Zulu Feeds"),
    mk("ip_only", "IP Intelligence"),
    mk("cve_second", "CVE Intelligence"),
  ]);
  assert.deepStrictEqual(
    groups.map((g) => [g.category, g.tools.map((t) => t.name)]),
    [
      ["CVE Intelligence", ["cve_first", "cve_second"]],
      ["IP Intelligence", ["ip_only"]],
      ["Operations", ["ops_first"]],
      ["Zulu Feeds", ["zulu_first", "zulu_second"]],
      ["Alpha Intel", ["alpha_only"]],
      ["Other", ["no_meta", "number_meta"]],
    ],
  );
});

test("a server category named Other merges with the fallback group and stays last", () => {
  const groups = groupToolsByCategory([mk("named_other", "Other"), mk("bare"), mk("y_tool", "Yankee"), mk("m_tool", "Monitoring")]);
  assert.deepStrictEqual(
    groups.map((g) => [g.category, g.tools.map((t) => t.name)]),
    [
      ["Monitoring", ["m_tool"]],
      ["Yankee", ["y_tool"]],
      ["Other", ["named_other", "bare"]],
    ],
  );
});

test("an empty list gives no groups and no Other node", () => {
  assert.deepStrictEqual(groupToolsByCategory([]), []);
  assert.deepStrictEqual(groupToolsByCategory([mk("solo", "Solo")]).map((g) => g.category), ["Solo"]);
});

test("the snapshot keeps every tool once and needs no Other group", () => {
  const groups = groupToolsByCategory(SNAPSHOT_TOOLS);
  const flat = groups.flatMap((g) => g.tools.map((t) => t.name)).sort();
  assert.deepStrictEqual(flat, SNAPSHOT_TOOLS.map((t) => t.name).sort());
  const names = groups.map((g) => g.category);
  assert.ok(!names.includes(OTHER_CATEGORY));
  assert.deepStrictEqual(names, [...CATEGORY_ORDER]);
  for (const group of groups) {
    const serverOrder = SNAPSHOT_TOOLS.filter((t) => group.tools.includes(t)).map((t) => t.name);
    assert.deepStrictEqual(group.tools.map((t) => t.name), serverOrder);
  }
});

test("the Run Tool list shows the snapshot's tools in the sidebar's category order", () => {
  const items = toolPickItems(SNAPSHOT_TOOLS);
  assert.strictEqual(items.length, SNAPSHOT_TOOLS.length);
  const runs = items.map((i) => i.description).filter((c, i, all) => i === 0 || all[i - 1] !== c);
  assert.deepStrictEqual(runs, [...CATEGORY_ORDER]);
  assert.deepStrictEqual(
    items.map((i) => i.tool.name),
    groupToolsByCategory(SNAPSHOT_TOOLS).flatMap((g) => g.tools.map((t) => t.name)),
  );
});

test("the Run Tool list puts an unknown category after the known ones and Other last", () => {
  const items = toolPickItems([mk("bare"), mk("z_tool", "Zulu Feeds"), mk("t_tool", "Threat Defense")]);
  assert.deepStrictEqual(
    items.map((i) => [i.label, i.description]),
    [
      ["t_tool", "Threat Defense"],
      ["z_tool", "Zulu Feeds"],
      ["bare", "Other"],
    ],
  );
});

test("toolLabel prefers the title and falls back to the name", () => {
  assert.strictEqual(toolLabel(mk("ssl_probe", "X", "TLS Probe")), "TLS Probe");
  assert.strictEqual(toolLabel(mk("ssl_probe", "X")), "ssl_probe");
  assert.strictEqual(toolLabel(mk("ssl_probe", "X", "")), "ssl_probe");
});

test("firstSentence cuts at the first sentence end followed by space", () => {
  assert.strictEqual(firstSentence("Alpha runs first. Beta runs second."), "Alpha runs first.");
  assert.strictEqual(firstSentence("Is it listed? Then go."), "Is it listed?");
  assert.strictEqual(firstSentence("Stop now! Later more."), "Stop now!");
  assert.strictEqual(firstSentence("Line one.\nLine two."), "Line one.");
  assert.strictEqual(firstSentence("Version 1.2 ships (max 50). Rest"), "Version 1.2 ships (max 50).");
  assert.strictEqual(firstSentence("  Padded start. Tail"), "Padded start.");
  assert.strictEqual(firstSentence("No end mark here"), "No end mark here");
  assert.strictEqual(firstSentence("Ends with a dot."), "Ends with a dot.");
  assert.strictEqual(firstSentence(""), "");
  assert.strictEqual(firstSentence(undefined), "");
});

test("firstSentence on a snapshot description", () => {
  const health = SNAPSHOT_TOOLS.find((t) => t.name === "health");
  assert.ok(health);
  assert.strictEqual(
    firstSentence(health.description),
    "Database freshness: CVE/KEV/CWE counts and latest entries, and the sync state of each upstream feed.",
  );
});

console.log(`\nAll ${passed} tool tree tests passed.`);

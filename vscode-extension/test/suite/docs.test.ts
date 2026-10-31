import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { TOOL_CACHE_MAX_AGE_MS } from "../../src/cache/toolCache";
import { TOOL_SHORTCUTS } from "../../src/commands/shortcuts";
import { McpTool } from "../../src/mcp/client";
import { WATCHLIST_SHOWN_EVENT_MAX } from "../../src/watch/eventStore";
import { WATCHLIST_EDIT_TOOL, watchEndpoints } from "../../src/watch/watchable";

interface Manifest {
  version: string;
  engines: { vscode: string };
  contributes: {
    commands: { command: string; title: string; category?: string }[];
    configuration: { properties: Record<string, { default?: unknown }> };
  };
}

const ROOT = path.join(__dirname, "../..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as Manifest;
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const CHANGELOG = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const SETTINGS_SOURCE = fs.readFileSync(path.join(ROOT, "src/utils/settings.ts"), "utf8");
const SNAPSHOT_TOOLS = (
  JSON.parse(fs.readFileSync(path.join(ROOT, "../claude-desktop-extension/tools_list.json"), "utf8")) as { result: { tools: McpTool[] } }
).result.tools;

/** The CHANGELOG's newest section: from its first "## " heading up to the next one. */
const NEWEST_RELEASE = CHANGELOG.split(/^## /m)[1] ?? "";

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

function engineVersion(): string {
  const match = /^\^(\d+\.\d+)\.\d+$/.exec(MANIFEST.engines.vscode);
  assert.ok(match, `engines.vscode ${MANIFEST.engines.vscode} is not ^X.Y.Z`);
  return match[1];
}

function titleOf(command: string): string {
  const found = MANIFEST.contributes.commands.find((c) => c.command === command);
  assert.ok(found, `${command} is not in package.json`);
  return found.title;
}

console.log("docs.test.ts");

test("README's event limit is WATCHLIST_SHOWN_EVENT_MAX", () => {
  assert.ok(README.includes(`at most ${WATCHLIST_SHOWN_EVENT_MAX} events`));
});

test("README and the newest CHANGELOG section give TOOL_CACHE_MAX_AGE_MS in hours", () => {
  const hours = `${TOOL_CACHE_MAX_AGE_MS / 3_600_000} hours`;
  assert.ok(README.includes(`older than ${hours}`), README);
  assert.ok(NEWEST_RELEASE.includes(`older than ${hours}`), NEWEST_RELEASE);
});

test("README and the newest CHANGELOG section name the engine's VS Code version", () => {
  const needed = `VS Code ${engineVersion()} or newer`;
  assert.ok(README.includes(needed));
  assert.ok(NEWEST_RELEASE.includes(needed));
});

test("the newest CHANGELOG section is package.json's version", () => {
  assert.ok(NEWEST_RELEASE.startsWith(`${MANIFEST.version} `), NEWEST_RELEASE.slice(0, 40));
});

test("README lists the palette shortcuts of TOOL_SHORTCUTS, in its order", () => {
  const titles = TOOL_SHORTCUTS.map((s) => s.title);
  const list = `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
  assert.ok(README.includes(`direct commands for ${list}.`), list);
});

test("every 'ContrastAPI: <title>' in README is a command title", () => {
  const titles = new Set(MANIFEST.contributes.commands.map((c) => c.title));
  const named = [...README.matchAll(/`ContrastAPI: ([^`]+)`/g)].map((m) => m[1]);
  assert.ok(named.length > 0);
  assert.deepStrictEqual(named.filter((t) => !titles.has(t)), []);
});

test("the commands README names in bold are titled that way in package.json", () => {
  const commands: Record<string, string> = {
    "Fetch New Events": "contrastapi.watchlistFetchNewEvents",
    "Refresh Watchlist": "contrastapi.watchlistRefresh",
  };
  for (const [shown, command] of Object.entries(commands)) {
    assert.ok(README.includes(`**${shown}**`), shown);
    const title = titleOf(command);
    assert.ok(title === shown || title.startsWith(`${shown} (`), `${command}: ${title}`);
  }
});

test("README's Watch button examples are the server titles of tools the watchlist watches", () => {
  const sentence = /get the button, for example ([^.]+)\./.exec(README);
  assert.ok(sentence, "no Watch button example sentence");
  const named = sentence[1].split(/, | and /);
  const edit = SNAPSHOT_TOOLS.find((t) => t.name === WATCHLIST_EDIT_TOOL);
  assert.ok(edit, `snapshot has no ${WATCHLIST_EDIT_TOOL}`);
  const endpoints = watchEndpoints(edit);
  const titles = new Set(SNAPSHOT_TOOLS.filter((t) => endpoints.includes(t.name)).map((t) => t.title));
  assert.ok(named.length > 1, sentence[1]);
  assert.deepStrictEqual(named.filter((t) => !titles.has(t)), []);
});

test("README documents every setting and the default base URL", () => {
  const properties = MANIFEST.contributes.configuration.properties;
  for (const key of Object.keys(properties)) {
    assert.ok(README.includes(`- \`${key}\`:`), key);
  }
  const fromSource = /DEFAULT_BASE_URL = "([^"]+)"/.exec(SETTINGS_SOURCE)?.[1];
  assert.strictEqual(properties["contrastapi.baseUrl"].default, fromSource);
  assert.ok(README.includes(`The default is \`${fromSource}\`.`));
});

console.log(`\nAll ${passed} docs tests passed.`);

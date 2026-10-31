import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

interface Command {
  command: string;
  title: string;
  category?: string;
}

interface Manifest {
  version: string;
  engines: { vscode: string };
  devDependencies: Record<string, string>;
  contributes: {
    commands: Command[];
    configuration: { properties: Record<string, { scope?: string }> };
  };
}

interface Lock {
  version: string;
  packages: Record<string, { version?: string; devDependencies?: Record<string, string> }>;
}

const ROOT = path.join(__dirname, "../..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as Manifest;
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as Lock;

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

console.log("manifest.test.ts");

test("no command title repeats its category, so the palette shows the prefix once", () => {
  const doubled = MANIFEST.contributes.commands
    .filter((c) => c.category !== undefined && c.title.startsWith(`${c.category}:`))
    .map((c) => c.command);
  assert.deepStrictEqual(doubled, []);
});

test("the @types/vscode range starts at the engine's VS Code version", () => {
  assert.strictEqual(MANIFEST.devDependencies["@types/vscode"], MANIFEST.engines.vscode);
});

test("package-lock.json's root entry matches package.json", () => {
  assert.strictEqual(LOCK.version, MANIFEST.version);
  assert.strictEqual(LOCK.packages[""].version, MANIFEST.version);
  assert.strictEqual(LOCK.packages[""].devDependencies?.["@types/vscode"], MANIFEST.devDependencies["@types/vscode"]);
});

test("contrastapi.baseUrl and contrastapi.mcp.register are application settings, so a workspace cannot set them", () => {
  const properties = MANIFEST.contributes.configuration.properties;
  for (const key of ["contrastapi.baseUrl", "contrastapi.mcp.register"]) {
    assert.strictEqual(properties[key]?.scope, "application", key);
  }
});

console.log(`\nAll ${passed} manifest tests passed.`);

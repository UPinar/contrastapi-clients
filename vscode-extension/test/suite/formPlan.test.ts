import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { FormStep, FormSteps, buildFormSteps, parseStepValue } from "../../src/forms/schemaForm";
import {
  OptionalMenuItem,
  applyStepAnswer,
  argumentSummary,
  argumentValueText,
  optionalMenuItems,
  stepChoices,
  stepInputValue,
} from "../../src/forms/formPlan";
import { McpTool } from "../../src/mcp/client";

const SNAPSHOT_PATH = path.join(__dirname, "../../../claude-desktop-extension/tools_list.json");
const SNAPSHOT_TOOLS = (
  JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as { result: { tools: McpTool[] } }
).result.tools;

function tool(name: string): McpTool {
  const found = SNAPSHOT_TOOLS.find((t) => t.name === name);
  assert.ok(found, `snapshot has no tool ${name}`);
  return found;
}

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

console.log("formPlan.test.ts");

const SAMPLER: McpTool = {
  name: "kind_sampler",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "what to look for" },
      tags: { type: "array", items: { type: "string" }, description: "comma-separated tags" },
      pins: { type: "array", items: { type: "object" }, description: "JSON array of pin objects" },
      depth: { type: "integer", description: "1-9" },
      ratio: { type: "number", description: "0.0-1.0" },
      mode: { type: "string", enum: ["fast", "deep", "exhaustive"] },
      strict: { type: "boolean" },
      purge: { type: "boolean", const: true, description: "drops the cached pins" },
      note: { type: "string" },
    },
    required: ["query"],
  },
};

function samplerStep(field: string): FormStep {
  const found = buildFormSteps(SAMPLER).optional.find((s) => s.field === field);
  assert.ok(found, `sampler has no optional step ${field}`);
  return found;
}

function menuOf(form: FormSteps, values: Record<string, unknown>): Map<string, OptionalMenuItem> {
  return new Map(optionalMenuItems(form, values).map((item) => [item.label, item]));
}

test("optionalMenuItems lists every optional step in schema order, each unset one with its prompt", () => {
  const form = buildFormSteps(tool("cve_search"));
  const items = optionalMenuItems(form, {});
  assert.deepStrictEqual(
    items.map((i) => i.label),
    form.optional.map((s) => s.field),
  );
  for (const item of items) {
    assert.strictEqual(item.description, undefined, item.label);
    assert.strictEqual(item.detail, item.step.prompt, item.label);
    assert.strictEqual(item.step.field, item.label);
  }
  assert.strictEqual(menuOf(form, {}).get("cwe_id")?.detail, "e.g. CWE-79");
});

test("optionalMenuItems keeps a set step in the menu and shows its value", () => {
  const form = buildFormSteps(tool("cve_search"));
  const values = { severity: "CRITICAL", limit: 37, in_kev: false, offset: 0 };
  const items = optionalMenuItems(form, values);
  assert.deepStrictEqual(
    items.map((i) => i.label),
    form.optional.map((s) => s.field),
  );
  const menu = menuOf(form, values);
  assert.strictEqual(menu.get("severity")?.description, "= CRITICAL ✓");
  assert.strictEqual(menu.get("limit")?.description, "= 37 ✓");
  assert.strictEqual(menu.get("in_kev")?.description, "= false ✓");
  assert.strictEqual(menu.get("offset")?.description, "= 0 ✓");
  assert.strictEqual(menu.get("severity")?.detail, "severity");
  assert.strictEqual(menu.get("product")?.description, undefined);
  assert.strictEqual(menu.get("min_epss")?.detail, "0.0-1.0");
});

test("optionalMenuItems ignores inherited object keys", () => {
  const form = buildFormSteps(tool("cve_search"));
  const args = Object.create({ severity: "LOW" }) as Record<string, unknown>;
  assert.strictEqual(menuOf(form, args).get("severity")?.description, undefined);
});

test("argumentValueText renders each step kind", () => {
  assert.strictEqual(argumentValueText(samplerStep("note"), "north-ridge"), "north-ridge");
  assert.strictEqual(argumentValueText(samplerStep("depth"), 7), "7");
  assert.strictEqual(argumentValueText(samplerStep("ratio"), 0.65), "0.65");
  assert.strictEqual(argumentValueText(samplerStep("mode"), "deep"), "deep");
  assert.strictEqual(argumentValueText(samplerStep("strict"), true), "true");
  assert.strictEqual(argumentValueText(samplerStep("strict"), false), "false");
  assert.strictEqual(argumentValueText(samplerStep("tags"), ["alpha", "beta", "gamma"]), "alpha, beta, gamma");
  assert.strictEqual(argumentValueText(samplerStep("pins"), [{ k: "v" }]), '[{"k":"v"}]');
  assert.strictEqual(argumentValueText(samplerStep("purge"), true), "true");
  const menu = menuOf(buildFormSteps(SAMPLER), { tags: ["alpha", "beta"], purge: true, ratio: 0.65 });
  assert.strictEqual(menu.get("tags")?.description, "= alpha, beta ✓");
  assert.strictEqual(menu.get("purge")?.description, "= true ✓");
  assert.strictEqual(menu.get("ratio")?.description, "= 0.65 ✓");
});

test("argumentValueText shortens JSON to 40 characters", () => {
  const pins = samplerStep("pins");
  const exact = [{ k: "x".repeat(30) }];
  assert.strictEqual(JSON.stringify(exact).length, 40);
  assert.strictEqual(argumentValueText(pins, exact), JSON.stringify(exact));
  const over = [{ k: "y".repeat(31) }];
  const shown = argumentValueText(pins, over);
  assert.strictEqual(shown.length, 40);
  assert.strictEqual(shown, `${JSON.stringify(over).slice(0, 39)}…`);
  const longNote = "z".repeat(60);
  assert.strictEqual(argumentValueText(samplerStep("note"), longNote), longNote);
});

test("argumentSummary is empty when nothing is set", () => {
  assert.strictEqual(argumentSummary({}, buildFormSteps(tool("cve_search"))), "");
});

test("argumentSummary follows the schema order, not the order the values were set", () => {
  const form = buildFormSteps(tool("cve_search"));
  const values = { limit: 37, sort: "epss", min_cvss: 8.7, severity: "CRITICAL" };
  assert.strictEqual(argumentSummary(values, form), "severity=CRITICAL · min_cvss=8.7 · sort=epss · limit=37");
});

test("argumentSummary includes the required fields and renders each value like the menu", () => {
  const form = buildFormSteps(SAMPLER);
  const values = { strict: false, query: "lantern", pins: [{ k: "y".repeat(31) }] };
  assert.strictEqual(
    argumentSummary(values, form),
    `query=lantern · pins=${JSON.stringify(values.pins).slice(0, 39)}… · strict=false`,
  );
});

test("argumentSummary ignores keys the form has no step for", () => {
  const values = { depth: 4, unknown_key: "x", tags: ["alpha", "beta"] };
  assert.strictEqual(argumentSummary(values, buildFormSteps(SAMPLER)), "tags=alpha, beta · depth=4");
});

test("argumentSummary shortens past 80 characters", () => {
  const form = buildFormSteps(SAMPLER);
  const exact = { query: "q".repeat(74) };
  assert.strictEqual(argumentSummary(exact, form), `query=${"q".repeat(74)}`);
  assert.strictEqual(argumentSummary(exact, form).length, 80);
  const over = argumentSummary({ query: "q".repeat(75) }, form);
  assert.strictEqual(over.length, 80);
  assert.strictEqual(over, `query=${"q".repeat(73)}…`);
});

test("applyStepAnswer sets a value and an undefined answer removes the key", () => {
  const form = buildFormSteps(tool("cve_search"));
  const args: Record<string, unknown> = { severity: "CRITICAL", limit: 37 };
  applyStepAnswer(args, "offset", 0);
  assert.deepStrictEqual(args, { severity: "CRITICAL", limit: 37, offset: 0 });
  const severity = form.optional.find((s) => s.field === "severity");
  assert.ok(severity);
  const cleared = parseStepValue(severity, "");
  assert.ok(cleared.ok);
  applyStepAnswer(args, "severity", cleared.value);
  assert.deepStrictEqual(args, { limit: 37, offset: 0 });
  assert.ok(!Object.prototype.hasOwnProperty.call(args, "severity"));
  assert.strictEqual(menuOf(form, args).get("severity")?.description, undefined);
  assert.strictEqual(argumentSummary(args, form), "limit=37 · offset=0");
  applyStepAnswer(args, "absent_key", undefined);
  assert.deepStrictEqual(args, { limit: 37, offset: 0 });
});

test("stepInputValue prefills the full value and parses back to it", () => {
  const cases: [string, unknown, string][] = [
    ["note", "north-ridge", "north-ridge"],
    ["depth", 7, "7"],
    ["ratio", 0.65, "0.65"],
    ["tags", ["alpha", "beta", "gamma"], "alpha, beta, gamma"],
    ["pins", [{ k: "y".repeat(31) }], JSON.stringify([{ k: "y".repeat(31) }])],
  ];
  for (const [field, value, text] of cases) {
    const step = samplerStep(field);
    assert.strictEqual(stepInputValue(step, value), text, field);
    const back = parseStepValue(step, stepInputValue(step, value));
    assert.ok(back.ok, field);
    assert.deepStrictEqual(back.value, value, field);
  }
  assert.strictEqual(stepInputValue(samplerStep("note"), undefined), "");
});

test("stepChoices offers the options alone when the step is unset", () => {
  assert.deepStrictEqual(stepChoices(samplerStep("mode"), undefined), [
    { label: "fast" },
    { label: "deep" },
    { label: "exhaustive" },
  ]);
  assert.deepStrictEqual(stepChoices(samplerStep("strict"), undefined), [{ label: "true" }, { label: "false" }]);
});

test("stepChoices puts (clear) first and marks the current option", () => {
  assert.deepStrictEqual(stepChoices(samplerStep("mode"), "exhaustive"), [
    { label: "(clear)", clear: true },
    { label: "fast" },
    { label: "deep" },
    { label: "exhaustive", description: "(current)" },
  ]);
  assert.deepStrictEqual(stepChoices(samplerStep("strict"), false), [
    { label: "(clear)", clear: true },
    { label: "true" },
    { label: "false", description: "(current)" },
  ]);
  assert.deepStrictEqual(stepChoices(samplerStep("purge"), true), [
    { label: "(clear)", clear: true },
    { label: "true", description: "(current)" },
  ]);
});

console.log(`\nAll ${passed} form plan tests passed.`);

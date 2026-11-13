import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { FormStep, buildFormSteps, parseStepValue } from "../../src/forms/schemaForm";
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

function stepOf(steps: FormStep[], field: string): FormStep {
  const found = steps.find((s) => s.field === field);
  assert.ok(found, `no step for ${field}`);
  return found;
}

function accept(step: FormStep, raw: string, expected: unknown): void {
  const r = parseStepValue(step, raw);
  assert.ok(r.ok, `${step.kind} ${JSON.stringify(raw)} refused: ${r.ok ? "" : r.message}`);
  assert.deepStrictEqual(r.value, expected);
}

function refuse(step: FormStep, raw: string): void {
  const r = parseStepValue(step, raw);
  assert.ok(!r.ok, `${step.kind} ${JSON.stringify(raw)} accepted as ${JSON.stringify(r.ok && r.value)}`);
  assert.ok(r.message.length > 0);
}

function step(kind: FormStep["kind"], required: boolean, options?: string[]): FormStep {
  const s: FormStep = { field: "f", prompt: "f", required, kind };
  if (options) {
    s.options = options;
  }
  return s;
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

console.log("schemaForm.test.ts");

test("cve_search: every step optional, schema order, const fields not fixed", () => {
  const form = buildFormSteps(tool("cve_search"));
  assert.strictEqual(form.required.length, 0);
  assert.deepStrictEqual(
    form.optional.map((s) => s.field),
    [
      "severity", "vendor", "product", "cwe_id", "min_cvss", "min_epss", "in_kev",
      "known_ransomware", "has_nuclei_template", "published_after", "published_before",
      "include_rejected", "sort", "limit", "offset",
    ],
  );
  assert.ok(form.optional.every((s) => s.required === false));
  assert.deepStrictEqual(form.fixed, {});
  assert.strictEqual(form.confirm, false);
});

test("cve_search: kinds text / integer / number / enum / boolean", () => {
  const steps = buildFormSteps(tool("cve_search")).optional;
  assert.strictEqual(stepOf(steps, "vendor").kind, "text");
  assert.strictEqual(stepOf(steps, "limit").kind, "integer");
  assert.strictEqual(stepOf(steps, "min_cvss").kind, "number");
  assert.strictEqual(stepOf(steps, "in_kev").kind, "boolean");
  const severity = stepOf(steps, "severity");
  assert.strictEqual(severity.kind, "enum");
  assert.deepStrictEqual(severity.options, ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]);
  assert.deepStrictEqual(stepOf(steps, "sort").options, ["published_time", "epss", "cvss"]);
  assert.strictEqual(stepOf(steps, "vendor").options, undefined);
});

test("prompt = property description and its limits, else the property name", () => {
  const steps = buildFormSteps(tool("cve_search")).optional;
  assert.strictEqual(stepOf(steps, "limit").prompt, "Minimum 1. Maximum 100. Default 20.");
  assert.strictEqual(stepOf(steps, "min_epss").prompt, "Minimum 0. Maximum 1.");
  assert.strictEqual(stepOf(steps, "vendor").prompt, "At most 128 characters.");
  assert.strictEqual(stepOf(steps, "include_rejected").prompt, "Also list the CVEs that NVD marks Rejected");
  assert.strictEqual(stepOf(steps, "severity").prompt, "severity");
});

test("limit text: the cases shared with the SDK generator give the same text", () => {
  const shared = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../../sdk/gen/limit_text_cases.json"), "utf8"),
  ) as { cases: [Record<string, unknown>, string | null, string][] };
  assert.ok(shared.cases.length > 10);
  for (const [schema, description, text] of shared.cases) {
    const prop = description === null ? schema : { ...schema, description };
    const t = { name: "t", inputSchema: { type: "object", properties: { f: prop } } } as unknown as McpTool;
    const expected = text === "" ? "f" : text;
    assert.strictEqual(buildFormSteps(t).optional[0].prompt, expected, JSON.stringify(prop));
  }
});

test("limit text: a value the SDK generator refuses adds no sentence", () => {
  const cases: Record<string, unknown>[] = [
    { type: "integer", minimum: "1" },
    { type: "integer", maximum: true },
    { type: "integer", default: "20" },
    { type: "boolean", default: true },
    { type: "string", maxLength: "3" },
    { type: "array", items: { type: "string" }, minItems: false },
  ];
  for (const prop of cases) {
    const t = { name: "t", inputSchema: { type: "object", properties: { f: prop } } } as unknown as McpTool;
    assert.strictEqual(buildFormSteps(t).optional[0].prompt, "f", JSON.stringify(prop));
  }
});

test("limit text: each schema limit becomes one sentence after the description", () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ type: "integer", description: "Count", minimum: 1 }, "Count. Minimum 1."],
    [{ type: "integer", description: "Count.", maximum: 9 }, "Count. Maximum 9."],
    [{ type: "integer", description: "Count?", default: 0 }, "Count? Default 0."],
    [{ type: "string", maxLength: 64 }, "At most 64 characters."],
    [{ type: "string", enum: ["a"], maxLength: 8 }, "f"],
    [{ type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 }, "1 to 50 items."],
    [{ type: "array", items: { type: "string" }, minItems: 2 }, "At least 2 items."],
    [{ type: "array", items: { type: "string" }, maxItems: 9 }, "At most 9 items."],
    [{ type: "integer", description: "Count" }, "Count"],
    [{ type: "integer" }, "f"],
  ];
  for (const [prop, prompt] of cases) {
    const t = { name: "t", inputSchema: { type: "object", properties: { f: prop } } } as unknown as McpTool;
    assert.strictEqual(buildFormSteps(t).optional[0].prompt, prompt, JSON.stringify(prop));
  }
});

test("cve_search: an optional const:true property is an opt-in enum step, not fixed", () => {
  const steps = buildFormSteps(tool("cve_search")).optional;
  const s = stepOf(steps, "known_ransomware");
  assert.strictEqual(s.kind, "enum");
  assert.deepStrictEqual(s.options, ["true"]);
  accept(s, "true", true);
  accept(s, "", undefined);
  refuse(s, "false");
});

test("watchlist_edit: enums, destructive → confirm, clear:true is never fixed", () => {
  const form = buildFormSteps(tool("watchlist_edit"));
  assert.strictEqual(form.confirm, true);
  assert.deepStrictEqual(form.fixed, {});
  assert.strictEqual(form.required.length, 0);
  assert.deepStrictEqual(stepOf(form.optional, "action").options, ["add", "remove"]);
  assert.deepStrictEqual(stepOf(form.optional, "endpoint").options, [
    "cve_lookup", "kev_lookup", "cve_exploit", "product_exposure", "cve_search", "dns_lookup", "ssl_check",
    "whois_lookup", "headers_check", "cert_search", "package_check", "ip_lookup",
  ]);
  assert.strictEqual(stepOf(form.optional, "clear").kind, "enum");
  assert.strictEqual(stepOf(form.optional, "packages").kind, "json");
  assert.deepStrictEqual(form.optional.slice(-2).map((s) => s.field), ["clear", "packages"]);
});

test("watchlist_events: destructiveHint false → no confirm", () => {
  assert.strictEqual(buildFormSteps(tool("watchlist_events")).confirm, false);
});

test("cve_lookup_bulk: array of strings → required stringList", () => {
  const form = buildFormSteps(tool("cve_lookup_bulk"));
  assert.deepStrictEqual(form.optional, []);
  assert.strictEqual(form.required.length, 1);
  assert.strictEqual(form.required[0].field, "cve_ids");
  assert.strictEqual(form.required[0].kind, "stringList");
  assert.strictEqual(form.required[0].required, true);
});

test("package_check_bulk: array of objects → required json", () => {
  const form = buildFormSteps(tool("package_check_bulk"));
  assert.strictEqual(form.required.length, 1);
  assert.strictEqual(form.required[0].field, "items");
  assert.strictEqual(form.required[0].kind, "json");
  assert.strictEqual(
    form.required[0].prompt,
    "Packages, each with its ecosystem, name and exact version. 1 to 500 items.",
  );
});

test("package_check: required and optional split, each in schema order", () => {
  const form = buildFormSteps(tool("package_check"));
  assert.deepStrictEqual(form.required.map((s) => s.field), ["ecosystem", "name"]);
  assert.deepStrictEqual(form.optional.map((s) => s.field), ["version", "limit", "offset"]);
});

test("health: no properties → no steps", () => {
  const form = buildFormSteps(tool("health"));
  assert.deepStrictEqual(form, { required: [], optional: [], fixed: {}, confirm: false });
});

test("a required const property goes into fixed with its value, not a step", () => {
  const form = buildFormSteps({
    name: "synthetic",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", const: "strict" },
        version: { type: "integer", const: 2 },
        target: { type: "string", description: "Target" },
      },
      required: ["mode", "version", "target"],
    },
    annotations: { destructiveHint: false },
  });
  assert.deepStrictEqual(form.fixed, { mode: "strict", version: 2 });
  assert.deepStrictEqual(form.required.map((s) => s.field), ["target"]);
  assert.deepStrictEqual(form.optional, []);
  assert.strictEqual(form.confirm, false);
});

test("every snapshot tool builds without throwing; steps cover every non-fixed property", () => {
  for (const t of SNAPSHOT_TOOLS) {
    const form = buildFormSteps(t);
    const props = Object.keys(t.inputSchema.properties ?? {});
    const covered = [...form.required, ...form.optional].map((s) => s.field).concat(Object.keys(form.fixed));
    assert.deepStrictEqual(covered.sort(), props.slice().sort(), t.name);
  }
});

test("text: trimmed; empty refused when required, omitted when optional", () => {
  accept(step("text", true), "  example.com  ", "example.com");
  refuse(step("text", true), "");
  refuse(step("text", true), "   ");
  accept(step("text", false), "   ", undefined);
});

test("integer: integer literals only", () => {
  const s = step("integer", true);
  accept(s, "50", 50);
  accept(s, " 0 ", 0);
  accept(s, "-3", -3);
  accept(s, "9007199254740991", 9007199254740991);
  refuse(s, "9007199254740992");
  refuse(s, "1.5");
  refuse(s, "1.0");
  refuse(s, "1e3");
  refuse(s, "0x10");
  refuse(s, "abc");
  refuse(s, "");
  accept(step("integer", false), "", undefined);
});

test("number: finite decimals only", () => {
  const s = step("number", true);
  accept(s, "7.5", 7.5);
  accept(s, "0", 0);
  accept(s, "-0.25", -0.25);
  accept(s, "10", 10);
  refuse(s, "Infinity");
  refuse(s, "1e400");
  refuse(s, "NaN");
  refuse(s, "abc");
  refuse(s, "0x10");
  refuse(s, "");
  accept(step("number", false), " ", undefined);
});

test("enum: must be one of the options (case-sensitive)", () => {
  const s = step("enum", true, ["CRITICAL", "HIGH"]);
  accept(s, "HIGH", "HIGH");
  accept(s, " CRITICAL ", "CRITICAL");
  refuse(s, "high");
  refuse(s, "LOW");
  refuse(s, "");
  accept(step("enum", false, ["CRITICAL", "HIGH"]), "", undefined);
});

test("boolean: exactly true / false", () => {
  const s = step("boolean", true);
  accept(s, "true", true);
  accept(s, "false", false);
  accept(s, " false ", false);
  refuse(s, "yes");
  refuse(s, "TRUE");
  refuse(s, "1");
  refuse(s, "");
  accept(step("boolean", false), "", undefined);
});

test("stringList: comma-separated, trimmed, empty parts dropped, at least one", () => {
  const s = step("stringList", true);
  accept(s, "CVE-2021-44228, CVE-2014-0160 ,,", ["CVE-2021-44228", "CVE-2014-0160"]);
  accept(s, "one", ["one"]);
  refuse(s, ", ,  ");
  refuse(s, "");
  accept(step("stringList", false), " , ", undefined);
});

test("json: a non-empty array of objects", () => {
  const s = step("json", true);
  accept(s, '[{"ecosystem":"npm","name":"lodash","version":"4.17.20"}]', [
    { ecosystem: "npm", name: "lodash", version: "4.17.20" },
  ]);
  refuse(s, '{"ecosystem":"npm"}');
  refuse(s, "[1,2]");
  refuse(s, "[]");
  refuse(s, "[null]");
  refuse(s, "[[]]");
  refuse(s, "not json");
  refuse(s, "");
  accept(step("json", false), "", undefined);
});

console.log(`\nAll ${passed} schema form tests passed.`);

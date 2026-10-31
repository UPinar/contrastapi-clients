import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { generateNonce, renderResult } from "../../src/views/resultHtml";

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

const CSS = "https://sample.webview.test/result.css";
const NONCE = "n0nce5ample";
const CSP = "https://sample.webview.test";

/** HOSTILE is server text that would close the script tag and add an element if it reached the page raw. */
const HOSTILE = "</script><img src=x onerror=alert(1)>";

/** Renders a page whose title, keys, values, summary and table carry HOSTILE, plus two hostile links. */
function hostilePage(): string {
  const data = {
    summary: HOSTILE,
    [HOSTILE]: HOSTILE,
    link: 'https://x.test/"onmouseover="alert(1)',
    js: "javascript:alert(1)",
    rows: [{ [HOSTILE]: HOSTILE }],
  };
  return renderResult(HOSTILE, data, CSS, NONCE, CSP);
}

console.log("resultHtml.test.ts");

test("no watch label: no Watch button and no watch message", () => {
  const html = renderResult("CVE Lookup", { cve_id: "CVE-2023-34362" }, CSS, NONCE, CSP);
  assert.ok(html.includes('id="copyBtn"'));
  assert.ok(!html.includes('id="watchBtn"'));
  assert.ok(!html.includes("'watch'"));
});

test("a watch label renders the Watch button next to Copy JSON", () => {
  const html = renderResult("CVE Lookup", { cve_id: "CVE-2023-34362" }, CSS, NONCE, CSP, "★ Watch CVE-2023-34362");
  assert.ok(html.includes('id="watchBtn"'));
  assert.ok(html.includes(">★ Watch CVE-2023-34362</button>"));
  assert.ok(html.indexOf('id="watchBtn"') < html.indexOf('id="copyBtn"'));
  assert.ok(html.includes("type: 'watch'"));
});

test("the watch label is escaped", () => {
  const html = renderResult("Product Exposure", {}, CSS, NONCE, CSP, '★ Watch <img src=x onerror="go()"> & co');
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("★ Watch &lt;img src=x onerror=&quot;go()&quot;&gt; &amp; co"));
});

test("the page keeps default-src 'none', the nonce-only script policy and the stylesheet link", () => {
  const html = renderResult("CVE Lookup", {}, CSS, NONCE, CSP, "★ Watch this search");
  assert.ok(html.includes("default-src 'none';"), "default-src");
  assert.ok(html.includes(`script-src 'nonce-${NONCE}'`));
  assert.ok(html.includes(`<script nonce="${NONCE}">`));
  assert.ok(html.includes(`href="${CSS}"`));
});

test("server text in the title, keys, values, summary, tables, raw JSON and script data never becomes markup", () => {
  const html = hostilePage();
  const low = html.toLowerCase();
  assert.ok(!low.includes("<img"), "raw <img");
  assert.strictEqual(low.split("</script>").length, 2, "one </script>");
  assert.ok(html.includes("default-src 'none';"), "default-src");
});

test("a link keeps its quotes escaped, and only http or https text becomes a link", () => {
  const html = hostilePage();
  assert.ok(!html.includes('"onmouseover="'), "href breakout");
  assert.ok(!html.includes('href="javascript:'), "javascript: link");
});

test("the Watch button's later label is set with textContent, never innerHTML", () => {
  const html = renderResult("t", {}, CSS, NONCE, CSP, "★ Watch x");
  assert.ok(html.includes("watchBtn.textContent = msg.label"), "label via textContent");
  assert.ok(!html.includes("innerHTML"), "no innerHTML");
});

test("generateNonce gives 128 random bits as hex, new on every call", () => {
  const a = generateNonce();
  const b = generateNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notStrictEqual(a, b);
});

test("result.css sizes follow the editor font: rem everywhere, px only for 1px border lines", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../resources/webview/result.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /html \{\s*font-size: var\(--vscode-editor-font-size, 13px\);\s*\}/, "root font size is the editor's");
  const rules = css.replace(/html \{[^}]*\}/, "");
  const pxLines = rules.split("\n").filter((line) => /\d+px/.test(line));
  const nonBorder = pxLines.filter((line) => !/^\s*border(-(top|right|bottom|left))?: 1px /.test(line));
  assert.deepStrictEqual(nonBorder, [], "a px size outside a 1px border line");
  assert.ok(/\d(\.\d+)?rem/.test(rules), "rem sizes present");
});

console.log(`\nAll ${passed} result html tests passed.`);

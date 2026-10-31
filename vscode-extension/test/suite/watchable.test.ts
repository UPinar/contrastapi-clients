import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { McpTool } from "../../src/mcp/client";
import { buildFormSteps } from "../../src/forms/schemaForm";
import {
  PRICING_URL,
  addArgumentsFor,
  addFormTool,
  eventDetail,
  eventGroups,
  eventLabel,
  eventTime,
  isProKeyRefusal,
  itemCountMessage,
  itemLabel,
  listedItems,
  removeArgumentsFor,
  watchButtonLabel,
  watchEndpoints,
  watchItemFor,
  watchableFields,
  watchingLabel,
  watchlistUnavailableNotice,
} from "../../src/watch/watchable";

const SNAPSHOT_PATH = path.join(__dirname, "../../../claude-desktop-extension/tools_list.json");
const SNAPSHOT_TOOLS = (
  JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")) as { result: { tools: McpTool[] } }
).result.tools;

function snapshotTool(name: string): McpTool {
  const tool = SNAPSHOT_TOOLS.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`snapshot has no ${name}`);
  }
  return tool;
}

const EDIT = snapshotTool("watchlist_edit");

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

function mkTool(name: string, props: string[], required: string[] = []): McpTool {
  const properties: Record<string, { type: "string" }> = {};
  for (const p of props) {
    properties[p] = { type: "string" };
  }
  return { name, inputSchema: { type: "object", properties, required } };
}

console.log("watchable.test.ts");

test("watchEndpoints reads the endpoint enum of watchlist_edit", () => {
  assert.deepStrictEqual(watchEndpoints(EDIT), [
    "cve_lookup",
    "kev_lookup",
    "cve_exploit",
    "product_exposure",
    "cve_search",
    "dns_lookup",
    "ssl_check",
  ]);
});

test("watchEndpoints of a tool without an endpoint enum is empty", () => {
  assert.deepStrictEqual(watchEndpoints(mkTool("watchlist_edit", ["endpoint"])), []);
});

test("watchableFields on the snapshot: each endpoint gets its fields", () => {
  const fields = (name: string): string[] => watchableFields(EDIT, snapshotTool(name));
  assert.deepStrictEqual(fields("cve_search"), [
    "vendor",
    "product",
    "severity",
    "cwe_id",
    "min_cvss",
    "min_epss",
    "in_kev",
    "known_ransomware",
  ]);
  assert.deepStrictEqual(fields("cve_lookup"), ["cve_id"]);
  assert.deepStrictEqual(fields("kev_lookup"), ["cve_id"]);
  assert.deepStrictEqual(fields("cve_exploit"), ["cve_id"]);
  assert.deepStrictEqual(fields("product_exposure"), ["vendor", "product"]);
  assert.deepStrictEqual(fields("dns_lookup"), ["domain"]);
  assert.deepStrictEqual(fields("ssl_check"), ["domain"]);
});

test("watchableFields drops cve_search pagination and sort", () => {
  const fields = watchableFields(EDIT, snapshotTool("cve_search"));
  for (const dropped of ["limit", "offset", "sort", "published_after", "published_before", "has_nuclei_template"]) {
    assert.ok(!fields.includes(dropped), dropped);
  }
});

test("watchableFields never offers action, endpoint or clear", () => {
  const sneaky = mkTool("cve_lookup", ["action", "endpoint", "clear", "cve_id"]);
  assert.deepStrictEqual(watchableFields(EDIT, sneaky), ["cve_id"]);
});

test("watchableFields is empty for a tool outside the endpoint enum, even with shared properties", () => {
  assert.deepStrictEqual(watchableFields(EDIT, mkTool("domain_report", ["domain"])), []);
  assert.deepStrictEqual(watchableFields(EDIT, snapshotTool("watchlist_edit")), []);
});

test("watchItemFor takes the watchable fields of the call and drops the rest", () => {
  const item = watchItemFor(
    snapshotTool("cve_lookup"),
    { cve_id: "CVE-2023-34362", include_ghsa: true },
    EDIT,
  );
  assert.deepStrictEqual(item, { endpoint: "cve_lookup", fields: { cve_id: "CVE-2023-34362" } });
});

test("watchItemFor keeps cve_search filters and drops its paging", () => {
  const item = watchItemFor(
    snapshotTool("cve_search"),
    { severity: "HIGH", vendor: "progress", min_epss: 0.37, in_kev: false, limit: 7, offset: 14, sort: "epss" },
    EDIT,
  );
  assert.deepStrictEqual(item, {
    endpoint: "cve_search",
    fields: { severity: "HIGH", vendor: "progress", min_epss: 0.37, in_kev: false },
  });
});

test("watchItemFor: a cve_search with no filter is still an item", () => {
  assert.deepStrictEqual(watchItemFor(snapshotTool("cve_search"), { limit: 3 }, EDIT), {
    endpoint: "cve_search",
    fields: {},
  });
});

test("watchItemFor skips a field whose value is undefined", () => {
  assert.deepStrictEqual(watchItemFor(snapshotTool("cve_search"), { cwe_id: undefined, vendor: "fortinet" }, EDIT), {
    endpoint: "cve_search",
    fields: { vendor: "fortinet" },
  });
});

test("watchItemFor is undefined when a required watchable field is missing", () => {
  assert.strictEqual(watchItemFor(snapshotTool("product_exposure"), { vendor: "progress" }, EDIT), undefined);
  assert.strictEqual(watchItemFor(snapshotTool("product_exposure"), { product: "moveit_transfer" }, EDIT), undefined);
  assert.strictEqual(watchItemFor(snapshotTool("dns_lookup"), {}, EDIT), undefined);
});

test("watchItemFor is undefined for a tool that is not watchable", () => {
  assert.strictEqual(watchItemFor(snapshotTool("whois_lookup"), { domain: "watch-sample.test" }, EDIT), undefined);
});

test("watchItemFor refuses a value that breaks the const of watchlist_edit", () => {
  assert.strictEqual(watchItemFor(snapshotTool("cve_search"), { known_ransomware: false }, EDIT), undefined);
  assert.deepStrictEqual(watchItemFor(snapshotTool("cve_search"), { known_ransomware: true }, EDIT), {
    endpoint: "cve_search",
    fields: { known_ransomware: true },
  });
});

test("watchItemFor: a required field of the tool that is not watchable does not block", () => {
  const tool = mkTool("ssl_check", ["domain", "port"], ["domain", "port"]);
  assert.deepStrictEqual(watchItemFor(tool, { domain: "watch-sample.test" }, EDIT), {
    endpoint: "ssl_check",
    fields: { domain: "watch-sample.test" },
  });
});

test("addArgumentsFor builds the add call", () => {
  assert.deepStrictEqual(addArgumentsFor({ endpoint: "product_exposure", fields: { vendor: "progress", product: "moveit_transfer" } }), {
    action: "add",
    endpoint: "product_exposure",
    vendor: "progress",
    product: "moveit_transfer",
  });
});

test("addArgumentsFor: a field cannot override action or endpoint, and clear never goes out", () => {
  assert.deepStrictEqual(
    addArgumentsFor({
      endpoint: "dns_lookup",
      fields: { action: "remove", endpoint: "ssl_check", clear: true, domain: "watch-sample.test" },
    }),
    { action: "add", endpoint: "dns_lookup", domain: "watch-sample.test" },
  );
});

test("watchButtonLabel per item kind", () => {
  assert.strictEqual(watchButtonLabel({ endpoint: "kev_lookup", fields: { cve_id: "CVE-2023-34362" } }), "★ Watch CVE-2023-34362");
  assert.strictEqual(
    watchButtonLabel({ endpoint: "product_exposure", fields: { vendor: "progress", product: "moveit_transfer" } }),
    "★ Watch progress moveit_transfer",
  );
  assert.strictEqual(watchButtonLabel({ endpoint: "ssl_check", fields: { domain: "watch-sample.test" } }), "★ Watch watch-sample.test");
  assert.strictEqual(
    watchButtonLabel({ endpoint: "cve_search", fields: { vendor: "progress", product: "moveit_transfer" } }),
    "★ Watch this search",
  );
  assert.strictEqual(watchButtonLabel({ endpoint: "cve_search", fields: {} }), "★ Watch this search");
});

test("itemLabel per listed item", () => {
  assert.strictEqual(itemLabel({ endpoint: "cve_exploit", cve_id: "CVE-2022-47966" }), "CVE-2022-47966");
  assert.strictEqual(itemLabel({ endpoint: "dns_lookup", domain: "watch-sample.test" }), "watch-sample.test");
  assert.strictEqual(
    itemLabel({ endpoint: "product_exposure", vendor: "zoho", product: "manageengine", product_has_cves: true }),
    "zoho manageengine",
  );
  assert.strictEqual(
    itemLabel({ endpoint: "cve_search", severity: "CRITICAL", min_cvss: 8.1, in_kev: true }),
    "CVE search: severity=CRITICAL, min_cvss=8.1, in_kev=true",
  );
  assert.strictEqual(itemLabel({ endpoint: "cve_search", vendor: "zoho" }), "CVE search: vendor=zoho");
  assert.strictEqual(itemLabel({ endpoint: "cve_search" }), "CVE search: every CVE");
  assert.strictEqual(itemLabel({ endpoint: "kev_lookup" }), "kev_lookup");
});

test("removeArgumentsFor drops answer-only members such as product_has_cves", () => {
  const listed = { endpoint: "product_exposure", vendor: "zoho", product: "manageengine", product_has_cves: true };
  const expected = { action: "remove", endpoint: "product_exposure", vendor: "zoho", product: "manageengine" };
  assert.deepStrictEqual(removeArgumentsFor(listed, EDIT, snapshotTool("product_exposure")), expected);
  assert.deepStrictEqual(removeArgumentsFor(listed, EDIT), expected);
});

test("removeArgumentsFor keeps only the fields of that endpoint's tool", () => {
  const listed = { endpoint: "dns_lookup", domain: "watch-sample.test", cve_id: "CVE-2022-47966", clear: true };
  assert.deepStrictEqual(removeArgumentsFor(listed, EDIT, snapshotTool("dns_lookup")), {
    action: "remove",
    endpoint: "dns_lookup",
    domain: "watch-sample.test",
  });
});

test("removeArgumentsFor never sends clear or a listed action, even without the endpoint's tool", () => {
  const listed = { endpoint: "cve_search", action: "add", clear: true, in_kev: false, cwe_id: "CWE-502" };
  assert.deepStrictEqual(removeArgumentsFor(listed, EDIT), {
    action: "remove",
    endpoint: "cve_search",
    in_kev: false,
    cwe_id: "CWE-502",
  });
});

test("addFormTool: product_exposure asks vendor and product, both required", () => {
  const form = buildFormSteps(addFormTool(EDIT, snapshotTool("product_exposure")));
  assert.deepStrictEqual(form.required.map((s) => s.field), ["vendor", "product"]);
  assert.deepStrictEqual(form.optional, []);
  assert.strictEqual(form.confirm, false);
  assert.deepStrictEqual(form.fixed, {});
});

test("addFormTool: cve_search asks only optional filters, typed from watchlist_edit", () => {
  const form = buildFormSteps(addFormTool(EDIT, snapshotTool("cve_search")));
  assert.deepStrictEqual(form.required, []);
  assert.deepStrictEqual(form.optional.map((s) => s.field).sort(), [
    "cwe_id",
    "in_kev",
    "known_ransomware",
    "min_cvss",
    "min_epss",
    "product",
    "severity",
    "vendor",
  ]);
  const byField = new Map(form.optional.map((s) => [s.field, s]));
  assert.strictEqual(byField.get("min_cvss")?.kind, "number");
  assert.strictEqual(byField.get("severity")?.kind, "enum");
  assert.strictEqual(byField.get("known_ransomware")?.constValue, true);
  assert.strictEqual(byField.get("vendor")?.prompt, "vendor of a product_exposure or cve_search item");
});

test("addFormTool: a required field of the tool that is not watchable is not asked", () => {
  const tool = addFormTool(EDIT, mkTool("ssl_check", ["domain", "port"], ["port", "domain"]));
  assert.deepStrictEqual(Object.keys(tool.inputSchema.properties ?? {}), ["domain"]);
  assert.deepStrictEqual(tool.inputSchema.required, ["domain"]);
});

test("addFormTool: cve_lookup asks cve_id only, not include_ghsa", () => {
  const tool = addFormTool(EDIT, snapshotTool("cve_lookup"));
  assert.deepStrictEqual(Object.keys(tool.inputSchema.properties ?? {}), ["cve_id"]);
  assert.deepStrictEqual(tool.inputSchema.required, ["cve_id"]);
  assert.strictEqual(tool.name, "cve_lookup");
  assert.strictEqual(tool.title, "Watch CVE Lookup");
});

const LIST_ANSWER = {
  items: [
    { endpoint: "product_exposure", vendor: "zoho", product: "manageengine", product_has_cves: true },
    "not an item",
    { endpoint: "ssl_check", domain: "watch-sample.test" },
  ],
  item_count: 2,
  item_limit: 64,
};

test("listedItems keeps the object items of an answer", () => {
  assert.deepStrictEqual(listedItems(LIST_ANSWER), [LIST_ANSWER.items[0], LIST_ANSWER.items[2]]);
  assert.deepStrictEqual(listedItems({ items: "nope" }), []);
  assert.deepStrictEqual(listedItems(undefined), []);
});

test("itemCountMessage and watchingLabel read item_count and item_limit", () => {
  assert.strictEqual(itemCountMessage(LIST_ANSWER), "Items 2/64");
  assert.strictEqual(watchingLabel(LIST_ANSWER), "✓ Watching · 2/64");
});

test("itemCountMessage falls back to the item list when the counts are missing", () => {
  assert.strictEqual(itemCountMessage({ items: [{ endpoint: "dns_lookup", domain: "watch-sample.test" }] }), "Items 1");
  assert.strictEqual(watchingLabel({}), "✓ Watching");
});

const ZOHO_SEARCH = { endpoint: "cve_search", vendor: "zoho" };

const SHARED_EVENT = { event: "kev_added", cve_id: "CVE-2022-47966", changed_at: "2026-10-28T09:10:11Z", previous: false, current: true };

const EVENTS_ANSWER = {
  limit: 20,
  cursor: null,
  repeat: true,
  next_cursor: "c-9",
  has_more: false,
  items: [
    {
      item: ZOHO_SEARCH,
      events: [
        { event: "cve_added", cve_id: "CVE-2022-35405", changed_at: "2026-10-30T11:22:33Z" },
        SHARED_EVENT,
        "not an event",
        { event: "epss_jump", cve_id: "CVE-2021-44515" },
      ],
    },
    { item: "not an item", events: [{ event: "orphan_event" }] },
    { item: { endpoint: "kev_lookup", cve_id: "CVE-2023-34362" }, events: "broken" },
    {
      item: { endpoint: "cve_lookup", cve_id: "CVE-2022-47966" },
      events: [{ ...SHARED_EVENT }],
    },
    null,
    { item: ["zoho"], events: [{ event: "array_item_event" }] },
    "broken entry",
    {
      item: { endpoint: "ssl_check", domain: "watch-sample.test" },
      events: [{ event: "cert_expiring", changed_at: "2026-10-29T04:05:06Z", previous: null, current: 7 }],
    },
  ],
  cves: {
    "CVE-2022-47966": { cvss_v3: 9.8 },
  },
  domains: {
    "watch-sample.test": { grade: "B" },
  },
};

const GROUPS = eventGroups(EVENTS_ANSWER);

function leaf(group: number, event: number): { item: Record<string, unknown>; event: Record<string, unknown> } {
  return { item: GROUPS[group].item, event: GROUPS[group].events[event] };
}

test("eventGroups keeps the answer's groups and events in order, as the server sent them", () => {
  assert.deepStrictEqual(
    GROUPS.map((g) => [g.item.endpoint, g.events.map((e) => e.event)]),
    [
      ["cve_search", ["cve_added", "kev_added", "epss_jump"]],
      ["cve_lookup", ["kev_added"]],
      ["ssl_check", ["cert_expiring"]],
    ],
  );
  assert.strictEqual(GROUPS[0].item, ZOHO_SEARCH);
  assert.strictEqual(GROUPS[0].events[1], SHARED_EVENT);
});

test("eventGroups keeps an event that matches two items under both items", () => {
  assert.deepStrictEqual(GROUPS[0].events[1], SHARED_EVENT);
  assert.deepStrictEqual(GROUPS[1].events[0], SHARED_EVENT);
  assert.deepStrictEqual(GROUPS[1].item, { endpoint: "cve_lookup", cve_id: "CVE-2022-47966" });
});

test("eventGroups skips an entry with a non-object item or a non-array events, and a non-object event", () => {
  const endpoints = GROUPS.map((g) => g.item.endpoint);
  assert.ok(!endpoints.includes("kev_lookup"));
  assert.strictEqual(GROUPS.length, 3);
  assert.ok(GROUPS.every((g) => g.events.every((e) => typeof e === "object" && e !== null && !Array.isArray(e))));
  assert.ok(!GROUPS.some((g) => Array.isArray(g.item)));
  assert.strictEqual(GROUPS[0].events.length, 3);
});

test("eventGroups of an answer without an items array is empty", () => {
  assert.deepStrictEqual(eventGroups({ limit: 20, has_more: true, cves: {} }), []);
  assert.deepStrictEqual(eventGroups({ items: "broken" }), []);
  assert.deepStrictEqual(eventGroups(null), []);
  assert.deepStrictEqual(eventGroups("watch-sample.test"), []);
});

test("eventLabel names the event type and its subject", () => {
  assert.strictEqual(eventLabel(leaf(0, 0)), "cve_added · CVE-2022-35405");
  assert.strictEqual(eventLabel(leaf(2, 0)), "cert_expiring · watch-sample.test");
  assert.strictEqual(
    eventLabel({ item: { endpoint: "product_exposure", vendor: "zoho", product: "manageengine" }, event: {} }),
    "event · zoho manageengine",
  );
});

test("eventLabel and eventDetail take a domain only from the item, because a domain event carries none", () => {
  const e = {
    item: { endpoint: "dns_lookup", domain: "watch-sample.test" },
    event: { event: "ns_changed", domain: "stray-sample.test" },
  };
  assert.strictEqual(eventLabel(e), "ns_changed · watch-sample.test");
  const answer = { domains: { "watch-sample.test": { grade: "B" }, "stray-sample.test": { grade: "F" } } };
  assert.deepStrictEqual(eventDetail(e, answer), { event: e.event, item: e.item, domain: { grade: "B" } });
});

test("eventTime returns a time member when the event has one", () => {
  assert.strictEqual(eventTime(leaf(0, 0).event), "2026-10-30T11:22:33Z");
  assert.strictEqual(eventTime(leaf(0, 2).event), undefined);
  assert.strictEqual(eventTime({ time: "2026-09-01" }), "2026-09-01");
  assert.strictEqual(eventTime({ seen_at: 5 }), undefined);
});

test("eventTime: a name that only ends in date is not a time member, and the first time member wins", () => {
  assert.strictEqual(eventTime({ candidate: "no", changed_at: "2026-10-01T00:00:00Z" }), "2026-10-01T00:00:00Z");
  assert.strictEqual(eventTime({ changed_at: "A", published_date: "B" }), "A");
});

test("eventDetail adds the cves or domains entry of the event's subject", () => {
  assert.deepStrictEqual(eventDetail(leaf(0, 1), EVENTS_ANSWER), {
    event: SHARED_EVENT,
    item: ZOHO_SEARCH,
    cve: { cvss_v3: 9.8 },
  });
  assert.deepStrictEqual(eventDetail(leaf(1, 0), EVENTS_ANSWER), {
    event: SHARED_EVENT,
    item: { endpoint: "cve_lookup", cve_id: "CVE-2022-47966" },
    cve: { cvss_v3: 9.8 },
  });
  assert.deepStrictEqual(eventDetail(leaf(0, 2), EVENTS_ANSWER), { event: leaf(0, 2).event, item: leaf(0, 2).item });
  assert.deepStrictEqual(eventDetail(leaf(2, 0), EVENTS_ANSWER), {
    event: leaf(2, 0).event,
    item: leaf(2, 0).item,
    domain: { grade: "B" },
  });
});

test("eventDetail ignores inherited names such as constructor", () => {
  const e = { item: { endpoint: "kev_lookup", cve_id: "constructor" }, event: { event: "kev_added" } };
  assert.deepStrictEqual(eventDetail(e, EVENTS_ANSWER), { event: e.event, item: e.item });
});

test("isProKeyRefusal spots the server's pricing link", () => {
  assert.strictEqual(isProKeyRefusal("watchlist needs a Pro API key: https://api.contrastcyber.com/pricing"), true);
  assert.strictEqual(isProKeyRefusal("watchlist holds at most 100 items"), false);
  assert.strictEqual(isProKeyRefusal("Provide vendor and product for a Pro-style SAMPLE item"), false);
  assert.strictEqual(PRICING_URL, "https://api.contrastcyber.com/pricing");
});

test("watchlistUnavailableNotice: a list that never loaded asks for a refresh, not 'not available'", () => {
  const notice = watchlistUnavailableNotice(false);
  for (const text of [notice.viewMessage, notice.warning]) {
    assert.ok(!text.includes("not available"), text);
    assert.ok(text.includes("tool list has not loaded"), text);
    assert.ok(text.includes("Check your connection"), text);
    assert.ok(text.includes("ContrastAPI: Refresh Tool List"), text);
    assert.strictEqual(text.split("ContrastAPI").length - 1, 1, text);
  }
});

test("watchlistUnavailableNotice: a loaded list without the watchlist tools says it is not available", () => {
  assert.deepStrictEqual(watchlistUnavailableNotice(true), {
    viewMessage: "Watchlist is not available on this server.",
    warning: "ContrastAPI: Watchlist is not available on this server.",
  });
});

console.log(`\nAll ${passed} watchable tests passed.`);

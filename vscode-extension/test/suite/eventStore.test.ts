import * as assert from "assert";
import { KeyValueStore } from "../../src/cache/toolCache";
import {
  SHOWN_EVENTS_KEY_PREFIX,
  ShownEventStore,
  ShownEvents,
  WATCHLIST_SHOWN_EVENT_MAX,
  emptyShownEvents,
  eventKey,
  itemKey,
  mergeShownEvents,
  parseShownEvents,
  shownEventCount,
} from "../../src/watch/eventStore";
import { WatchRecord, eventDetail } from "../../src/watch/watchable";

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  update(key: string, value: unknown): PromiseLike<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }
    return Promise.resolve();
  }
}

let passed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

const KEV_ITEM: WatchRecord = { endpoint: "kev_lookup", cve_id: "CVE-2024-31337" };
const SEARCH_ITEM: WatchRecord = { endpoint: "cve_search", vendor: "fixturevendor", min_cvss: 7.5 };
const SSL_ITEM: WatchRecord = { endpoint: "ssl_check", domain: "watch-sample.test" };

function kevEvent(cveId: string, changedAt: string): WatchRecord {
  return { event: "kev_added", changed_at: changedAt, cve_id: cveId, previous: null, current: null };
}

function answerOf(...groups: Array<{ item: WatchRecord; events: WatchRecord[] }>): unknown {
  return { limit: 100, next_cursor: "c-17", has_more: false, items: groups, cves: {}, domains: {} };
}

function shape(shown: ShownEvents): Array<[string, string[]]> {
  return shown.groups.map((g) => [itemKey(g.item), g.events.map((e) => `${String(e.cve_id ?? e.event)}@${String(e.changed_at)}`)]);
}

async function main(): Promise<void> {
  console.log("eventStore.test.ts");

  await test("WATCHLIST_SHOWN_EVENT_MAX is 500", () => {
    assert.strictEqual(WATCHLIST_SHOWN_EVENT_MAX, 500);
  });

  await test("itemKey ignores member order and tells different members or values apart", () => {
    assert.strictEqual(
      itemKey({ endpoint: "cve_search", vendor: "fixturevendor", min_cvss: 7.5 }),
      itemKey({ min_cvss: 7.5, vendor: "fixturevendor", endpoint: "cve_search" }),
    );
    assert.notStrictEqual(itemKey(SEARCH_ITEM), itemKey({ ...SEARCH_ITEM, min_cvss: 8.5 }));
    assert.notStrictEqual(itemKey(SEARCH_ITEM), itemKey({ ...SEARCH_ITEM, in_kev: true }));
    assert.notStrictEqual(itemKey(KEV_ITEM), itemKey({ ...KEV_ITEM, endpoint: "cve_exploit" }));
    assert.notStrictEqual(itemKey({ endpoint: "x", a: "1" }), itemKey({ endpoint: "x", a: 1 }));
  });

  await test("eventKey is the whole event: member order does not count, and a member that differs or is added gives another key", () => {
    const base = { event: "epss_jump", changed_at: "2026-10-15T08:09:10Z", cve_id: "CVE-2024-31337", previous: 0.12, current: 0.67 };
    const reordered = { current: 0.67, previous: 0.12, cve_id: "CVE-2024-31337", changed_at: "2026-10-15T08:09:10Z", event: "epss_jump" };
    assert.strictEqual(eventKey(base), eventKey(reordered));
    assert.notStrictEqual(eventKey(base), eventKey({ ...base, note: "extra member" }), "extra member");
    for (const [member, value] of [
      ["event", "kev_added"],
      ["changed_at", "2026-10-15T08:09:11Z"],
      ["cve_id", "CVE-2024-31338"],
      ["previous", 0.13],
      ["current", 0.68],
      ["check", "dmarc"],
      ["vendor", "othervendor"],
      ["product", "otherproduct"],
      ["valid_until", "2026-11-01T00:00:00Z"],
    ] as const) {
      assert.notStrictEqual(eventKey(base), eventKey({ ...base, [member]: value }), member);
    }
    const withMembers = { ...base, check: "spf", vendor: "fixturevendor", product: "widget", valid_until: "2026-12-01T00:00:00Z" };
    for (const [member, value] of [
      ["check", "dmarc"],
      ["vendor", "othervendor"],
      ["product", "otherproduct"],
      ["valid_until", "2026-11-01T00:00:00Z"],
    ] as const) {
      assert.notStrictEqual(eventKey(withMembers), eventKey({ ...withMembers, [member]: value }), `changed ${member}`);
    }
    assert.notStrictEqual(
      eventKey({ event: "cert_invalid", previous: { valid: true }, current: { valid: false } }),
      eventKey({ event: "cert_invalid", previous: { valid: false }, current: { valid: true } }),
    );
  });

  await test("eventKey ignores member order inside nested objects and inside arrays", () => {
    assert.strictEqual(eventKey({ event: "x", previous: { a: 1, b: 2 } }), eventKey({ event: "x", previous: { b: 2, a: 1 } }));
    assert.strictEqual(
      eventKey({ event: "x", current: [{ a: 1, b: 2 }, "y"] }),
      eventKey({ event: "x", current: [{ b: 2, a: 1 }, "y"] }),
    );
    assert.notStrictEqual(eventKey({ event: "x", current: ["a", "b"] }), eventKey({ event: "x", current: ["b", "a"] }), "array order counts");
  });

  await test("the first fetch fills an empty view newest first, groups by most recent event", () => {
    const answer = answerOf(
      { item: KEV_ITEM, events: [kevEvent("CVE-2024-31337", "2026-10-15T08:09:10Z")] },
      {
        item: SEARCH_ITEM,
        events: [kevEvent("CVE-2025-11111", "2026-10-14T01:02:03Z"), kevEvent("CVE-2025-22222", "2026-10-16T04:05:06Z")],
      },
    );
    const merged = mergeShownEvents(emptyShownEvents(), answer);
    assert.strictEqual(merged.added, 3);
    assert.deepStrictEqual(shape(merged.shown), [
      [itemKey(SEARCH_ITEM), ["CVE-2025-22222@2026-10-16T04:05:06Z", "CVE-2025-11111@2026-10-14T01:02:03Z"]],
      [itemKey(KEV_ITEM), ["CVE-2024-31337@2026-10-15T08:09:10Z"]],
    ]);
  });

  await test("an empty fetch keeps every shown event and adds none", () => {
    const shown = mergeShownEvents(
      emptyShownEvents(),
      answerOf({ item: KEV_ITEM, events: [kevEvent("CVE-2024-31337", "2026-10-15T08:09:10Z")] }),
    ).shown;
    for (const empty of [answerOf(), answerOf({ item: SEARCH_ITEM, events: [] }), undefined, { items: "broken" }]) {
      const merged = mergeShownEvents(shown, empty);
      assert.strictEqual(merged.added, 0);
      assert.deepStrictEqual(merged.shown, shown);
    }
  });

  await test("new events join their item's group, a new item gets a group, groups follow the newest event", () => {
    const first = mergeShownEvents(
      emptyShownEvents(),
      answerOf(
        { item: KEV_ITEM, events: [kevEvent("CVE-2024-31337", "2026-10-15T08:09:10Z")] },
        { item: SEARCH_ITEM, events: [kevEvent("CVE-2025-22222", "2026-10-16T04:05:06Z")] },
      ),
    ).shown;
    const second = mergeShownEvents(
      first,
      answerOf(
        { item: { cve_id: "CVE-2024-31337", endpoint: "kev_lookup" }, events: [kevEvent("CVE-2024-31337", "2026-10-17T10:11:12Z")] },
        {
          item: SSL_ITEM,
          events: [{ event: "cert_expiring", changed_at: "2026-10-16T09:00:00Z", previous: null, current: 6 }],
        },
      ),
    );
    assert.strictEqual(second.added, 2);
    assert.deepStrictEqual(shape(second.shown), [
      [itemKey(KEV_ITEM), ["CVE-2024-31337@2026-10-17T10:11:12Z", "CVE-2024-31337@2026-10-15T08:09:10Z"]],
      [itemKey(SSL_ITEM), ["cert_expiring@2026-10-16T09:00:00Z"]],
      [itemKey(SEARCH_ITEM), ["CVE-2025-22222@2026-10-16T04:05:06Z"]],
    ]);
  });

  await test("an event already shown under the same item is not added twice; a second item gets it, new first on a time tie", () => {
    const shared = kevEvent("CVE-2024-31337", "2026-10-15T08:09:10Z");
    const first = mergeShownEvents(emptyShownEvents(), answerOf({ item: KEV_ITEM, events: [shared] })).shown;
    const second = mergeShownEvents(
      first,
      answerOf(
        { item: KEV_ITEM, events: [{ current: null, previous: null, cve_id: "CVE-2024-31337", changed_at: "2026-10-15T08:09:10Z", event: "kev_added" }] },
        { item: SEARCH_ITEM, events: [{ ...shared }] },
      ),
    );
    assert.strictEqual(second.added, 1);
    assert.deepStrictEqual(shape(second.shown), [
      [itemKey(SEARCH_ITEM), ["CVE-2024-31337@2026-10-15T08:09:10Z"]],
      [itemKey(KEV_ITEM), ["CVE-2024-31337@2026-10-15T08:09:10Z"]],
    ]);
    assert.strictEqual(second.shown.groups[1].events[0], shared);
    const twice = mergeShownEvents(emptyShownEvents(), answerOf({ item: KEV_ITEM, events: [shared, { ...shared }] }));
    assert.strictEqual(twice.added, 1);
    assert.strictEqual(shownEventCount(twice.shown), 1);
  });

  await test("same-type events that differ only in check or vendor are all kept, and a second merge adds none", () => {
    const dnsItem: WatchRecord = { endpoint: "dns_lookup", domain: "watch-sample.test" };
    const degraded = (check: string): WatchRecord => ({
      event: "email_auth_degraded",
      changed_at: "2026-10-20T00:00:00Z",
      check,
      previous: "pass",
      current: "fail",
      detail: null,
    });
    const productAdded = (vendor: string): WatchRecord => ({
      event: "product_added",
      changed_at: "2026-10-21T00:00:00Z",
      cve_id: "CVE-2025-22222",
      previous: null,
      current: null,
      vendor,
      product: "widget",
    });
    const answer = answerOf(
      { item: dnsItem, events: [degraded("spf"), degraded("dmarc")] },
      { item: SEARCH_ITEM, events: [productAdded("fixturevendor"), productAdded("othervendor")] },
    );
    const first = mergeShownEvents(emptyShownEvents(), answer);
    assert.strictEqual(first.added, 4, "first merge");
    assert.strictEqual(shownEventCount(first.shown), 4, "first count");
    assert.deepStrictEqual(
      first.shown.groups.map((g) => g.events.map((e) => String(e.check ?? e.vendor))),
      [["fixturevendor", "othervendor"], ["spf", "dmarc"]],
    );
    const again = mergeShownEvents(first.shown, answer);
    assert.strictEqual(again.added, 0, "second merge");
    assert.strictEqual(shownEventCount(again.shown), 4, "second count");
  });

  await test("an event without a readable time counts as the oldest", () => {
    const merged = mergeShownEvents(
      emptyShownEvents(),
      answerOf({
        item: SSL_ITEM,
        events: [
          { event: "tls_downgraded", previous: "TLSv1.3", current: "TLSv1.2" },
          { event: "cert_listed", changed_at: "not a time", previous: null, current: true },
          { event: "cert_expiring", changed_at: "2026-10-12T00:00:00Z", previous: null, current: 9 },
        ],
      }),
      2,
    );
    assert.deepStrictEqual(
      merged.shown.groups[0].events.map((e) => e.event),
      ["cert_expiring", "tls_downgraded"],
    );
  });

  function batch(count: number, cveBase: number): WatchRecord[] {
    const start = Date.UTC(2026, 9, 1, 0, 0, 0);
    return Array.from({ length: count }, (_, i) =>
      kevEvent(`CVE-2026-${cveBase + i}`, new Date(start + i * 60_000).toISOString().replace(".000", "")),
    );
  }

  for (const count of [WATCHLIST_SHOWN_EVENT_MAX - 1, WATCHLIST_SHOWN_EVENT_MAX, WATCHLIST_SHOWN_EVENT_MAX + 1]) {
    await test(`the cap keeps at most WATCHLIST_SHOWN_EVENT_MAX events: ${count} fetched`, () => {
      const events = batch(count, 40000);
      const merged = mergeShownEvents(emptyShownEvents(), answerOf({ item: SEARCH_ITEM, events }));
      const kept = Math.min(count, WATCHLIST_SHOWN_EVENT_MAX);
      assert.strictEqual(shownEventCount(merged.shown), kept);
      assert.strictEqual(merged.added, kept);
      const ids = merged.shown.groups[0].events.map((e) => e.cve_id);
      assert.strictEqual(ids[0], `CVE-2026-${40000 + count - 1}`);
      assert.strictEqual(ids[ids.length - 1], `CVE-2026-${40000 + count - kept}`);
    });
  }

  await test("over the cap the oldest shown events go first, and an emptied group goes with them", () => {
    const old = mergeShownEvents(
      emptyShownEvents(),
      answerOf(
        { item: KEV_ITEM, events: [kevEvent("CVE-2024-31337", "2026-09-01T00:00:00Z")] },
        { item: SEARCH_ITEM, events: batch(WATCHLIST_SHOWN_EVENT_MAX - 1, 50000) },
      ),
    ).shown;
    assert.strictEqual(shownEventCount(old), WATCHLIST_SHOWN_EVENT_MAX);
    const merged = mergeShownEvents(
      old,
      answerOf({ item: SSL_ITEM, events: [{ event: "cert_invalid", changed_at: "2026-10-20T00:00:00Z", previous: null, current: true }] }),
    );
    assert.strictEqual(merged.added, 1);
    assert.strictEqual(shownEventCount(merged.shown), WATCHLIST_SHOWN_EVENT_MAX);
    assert.deepStrictEqual(merged.shown.groups.map((g) => itemKey(g.item)), [itemKey(SSL_ITEM), itemKey(SEARCH_ITEM)]);
  });

  await test("a fetch older than every kept event under a full cap adds nothing", () => {
    const full = mergeShownEvents(emptyShownEvents(), answerOf({ item: SEARCH_ITEM, events: batch(WATCHLIST_SHOWN_EVENT_MAX, 60000) })).shown;
    const merged = mergeShownEvents(full, answerOf({ item: KEV_ITEM, events: [kevEvent("CVE-2024-31337", "2026-01-01T00:00:00Z")] }));
    assert.strictEqual(merged.added, 0);
    assert.strictEqual(shownEventCount(merged.shown), WATCHLIST_SHOWN_EVENT_MAX);
  });

  await test("the cves and domains tables follow the shown events, so Open Event still finds them", () => {
    const first = mergeShownEvents(emptyShownEvents(), {
      items: [
        { item: KEV_ITEM, events: [kevEvent("CVE-2024-31337", "2026-09-01T00:00:00Z")] },
        { item: SSL_ITEM, events: [{ event: "cert_expiring", changed_at: "2026-10-02T00:00:00Z", previous: null, current: 5 }] },
      ],
      cves: { "CVE-2024-31337": { cvss_v3: 8.1 }, "CVE-2099-00001": { cvss_v3: 1.1 } },
      domains: { "watch-sample.test": { grade: "C" }, "unused.test": { grade: "A" } },
    }).shown;
    assert.deepStrictEqual(first.cves, { "CVE-2024-31337": { cvss_v3: 8.1 } });
    assert.deepStrictEqual(first.domains, { "watch-sample.test": { grade: "C" } });
    const event = { item: KEV_ITEM, event: first.groups[1].events[0] };
    assert.deepStrictEqual(eventDetail(event, first).cve, { cvss_v3: 8.1 });

    const second = mergeShownEvents(
      first,
      {
        items: [{ item: SEARCH_ITEM, events: [kevEvent("CVE-2025-22222", "2026-10-16T04:05:06Z")] }],
        cves: { "CVE-2025-22222": { cvss_v3: 9.3 } },
        domains: { "watch-sample.test": { grade: "A" } },
      },
      2,
    ).shown;
    assert.deepStrictEqual(second.cves, { "CVE-2025-22222": { cvss_v3: 9.3 } });
    assert.deepStrictEqual(second.domains, { "watch-sample.test": { grade: "A" } }, "a newer entry replaces an older one");
  });

  await test("a fetch keeps the stored cves entry of an older event that is still shown", () => {
    const first = mergeShownEvents(emptyShownEvents(), {
      items: [{ item: KEV_ITEM, events: [kevEvent("CVE-2024-31337", "2026-09-01T00:00:00Z")] }],
      cves: { "CVE-2024-31337": { cvss_v3: 8.1 } },
      domains: {},
    }).shown;
    const second = mergeShownEvents(first, {
      items: [{ item: SEARCH_ITEM, events: [kevEvent("CVE-2025-22222", "2026-10-01T00:00:00Z")] }],
      cves: { "CVE-2025-22222": { cvss_v3: 9.3 } },
      domains: {},
    }).shown;
    assert.deepStrictEqual(second.cves, { "CVE-2024-31337": { cvss_v3: 8.1 }, "CVE-2025-22222": { cvss_v3: 9.3 } });
  });

  await test("a table entry named __proto__ or constructor stays a plain member", () => {
    const merged = mergeShownEvents(emptyShownEvents(), {
      items: [{ item: { endpoint: "kev_lookup", cve_id: "__proto__" }, events: [{ event: "kev_added", changed_at: "2026-10-03T00:00:00Z" }] }],
      cves: JSON.parse('{"__proto__": {"cvss_v3": 4.4}}'),
      domains: {},
    }).shown;
    assert.strictEqual(Object.getPrototypeOf(merged.cves), Object.prototype);
    assert.deepStrictEqual(Object.keys(merged.cves), ["__proto__"]);
  });

  const STORED: ShownEvents = mergeShownEvents(emptyShownEvents(), {
    items: [{ item: KEV_ITEM, events: [kevEvent("CVE-2024-31337", "2026-10-15T08:09:10Z")] }],
    cves: { "CVE-2024-31337": { cvss_v3: 8.1 } },
    domains: {},
  }).shown;

  await test("parseShownEvents accepts a stored record and refuses every wrong shape", () => {
    const record = JSON.parse(JSON.stringify({ version: 1, ...STORED })) as Record<string, unknown>;
    assert.deepStrictEqual(parseShownEvents(record), STORED);
    const wrong: unknown[] = [
      undefined,
      null,
      "text",
      [STORED],
      { ...record, version: 2 },
      { groups: record.groups, cves: record.cves, domains: record.domains },
      { ...record, groups: "broken" },
      { ...record, groups: [{ item: "not an item", events: [] }] },
      { ...record, groups: [{ item: KEV_ITEM, events: "broken" }] },
      { ...record, groups: [{ item: KEV_ITEM, events: ["not an event"] }] },
      { ...record, groups: [null] },
      { ...record, cves: [] },
      { ...record, domains: null },
    ];
    for (const value of wrong) {
      assert.strictEqual(parseShownEvents(value), undefined, JSON.stringify(value));
    }
  });

  await test("ShownEventStore keeps one record per normalized base URL and clears it", async () => {
    const memory = new MemoryStore();
    const prod = new ShownEventStore(memory, "https://api.contrastcyber.com/");
    const local = new ShownEventStore(memory, "http://localhost:8080");
    assert.strictEqual(prod.loadShownEvents(), undefined);
    await prod.saveShownEvents(STORED);
    assert.deepStrictEqual([...memory.data.keys()], [`${SHOWN_EVENTS_KEY_PREFIX}https://api.contrastcyber.com`]);
    assert.deepStrictEqual(new ShownEventStore(memory, "https://api.contrastcyber.com").loadShownEvents(), STORED);
    assert.strictEqual(local.loadShownEvents(), undefined);
    memory.data.set(`${SHOWN_EVENTS_KEY_PREFIX}http://localhost:8080`, { version: 1, groups: "broken" });
    assert.strictEqual(local.loadShownEvents(), undefined);
    await prod.clear();
    assert.strictEqual(prod.loadShownEvents(), undefined);
    assert.strictEqual(SHOWN_EVENTS_KEY_PREFIX, "contrastapi.watchEvents:");
  });

  console.log(`\nAll ${passed} event store tests passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { KeyValueStore } from "../cache/toolCache";
import { normalizeBaseUrl } from "../mcp/client";
import { WatchEventGroup, WatchRecord, eventGroups, eventTime } from "./watchable";

/**
 * WATCHLIST_SHOWN_EVENT_MAX is the most events the watchlist view keeps.
 * An event shown under two items counts twice.
 * Over the limit the oldest events are dropped.
 */
export const WATCHLIST_SHOWN_EVENT_MAX = 500;

/** SHOWN_EVENTS_KEY_PREFIX starts the storage key of the shown events. The normalized base URL follows it. */
export const SHOWN_EVENTS_KEY_PREFIX = "contrastapi.watchEvents:";

const STORE_VERSION = 1;

/**
 * ShownEvents is what the watchlist view shows and keeps between sessions.
 * groups holds the events by item, newest first.
 * cves and domains hold the answer entries of those events, so Open Event still finds them later.
 */
export interface ShownEvents {
  groups: WatchEventGroup[];
  cves: Record<string, unknown>;
  domains: Record<string, unknown>;
}

/** MergedEvents is the result of a fetch merged into the shown events. added counts the new events that were kept. */
export interface MergedEvents {
  shown: ShownEvents;
  added: number;
}

interface ItemEvent {
  groupKey: string;
  item: WatchRecord;
  event: WatchRecord;
  fresh: boolean;
}

function isRecord(value: unknown): value is WatchRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Writes a value as JSON with every object's members sorted by name.
 * Two records with the same members then give the same text in any member order.
 * A missing value is written as null.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const members = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`);
    return `{${members.join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

/** Returns an empty ShownEvents, the state of a view that has shown nothing yet. */
export function emptyShownEvents(): ShownEvents {
  return { groups: [], cves: {}, domains: {} };
}

/**
 * Returns the identity of a watch item.
 * It is the item object's own members, the endpoint and its watchable fields, sorted by name.
 */
export function itemKey(item: WatchRecord): string {
  return stableJson(item);
}

/**
 * Returns the identity of an event.
 * It is every member of the event, sorted by name.
 * The server can write two events of one type with the same time and the same values.
 * Another member then tells them apart, such as check, vendor, product or valid_until.
 * A key on fewer members would drop the second event as already shown.
 */
export function eventKey(event: WatchRecord): string {
  return stableJson(event);
}

/** Returns how many events the view shows, counting an event once per item. */
export function shownEventCount(shown: ShownEvents): number {
  return shown.groups.reduce((sum, group) => sum + group.events.length, 0);
}

/** Returns an event's time in milliseconds. An event without a readable time counts as the oldest. */
function eventTimeMs(event: WatchRecord): number {
  const text = eventTime(event);
  const ms = text === undefined ? NaN : Date.parse(text);
  return Number.isFinite(ms) ? ms : -Infinity;
}

function answerTable(answer: unknown, table: string): Record<string, unknown> {
  const value = isRecord(answer) ? answer[table] : undefined;
  return isRecord(value) ? value : {};
}

/**
 * Keeps the table entries that the kept events name.
 * A newer entry replaces an older one with the same name.
 * Object.fromEntries writes a name such as __proto__ as a plain member.
 */
function keptTable(names: ReadonlySet<string>, older: Record<string, unknown>, newer: Record<string, unknown>): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [];
  for (const name of names) {
    if (hasOwn(newer, name)) {
      entries.push([name, newer[name]]);
    } else if (hasOwn(older, name)) {
      entries.push([name, older[name]]);
    }
  }
  return Object.fromEntries(entries);
}

function primitiveText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/**
 * Merges a watchlist_events answer into the shown events.
 * A new event of a shown item joins that item's group, and a new item gets a new group.
 * An event already shown under the same item is not added again.
 * Events are newest first, and groups follow their newest event.
 * Over max events the oldest are dropped, and a group left without events goes too.
 * Two events with the same time keep the new one first, then their earlier order.
 */
export function mergeShownEvents(shown: ShownEvents, answer: unknown, max = WATCHLIST_SHOWN_EVENT_MAX): MergedEvents {
  const seen = new Set<string>();
  const entries: ItemEvent[] = [];
  const take = (groups: readonly WatchEventGroup[], fresh: boolean): void => {
    for (const group of groups) {
      const groupKey = itemKey(group.item);
      for (const event of group.events) {
        const key = `${groupKey}\n${eventKey(event)}`;
        if (!seen.has(key)) {
          seen.add(key);
          entries.push({ groupKey, item: group.item, event, fresh });
        }
      }
    }
  };
  take(shown.groups, false);
  take(eventGroups(answer), true);
  entries.sort((a, b) => eventTimeMs(b.event) - eventTimeMs(a.event) || Number(b.fresh) - Number(a.fresh));
  const kept = entries.slice(0, Math.max(0, max));

  const groups = new Map<string, WatchEventGroup>();
  const cveNames = new Set<string>();
  const domainNames = new Set<string>();
  for (const entry of kept) {
    const group = groups.get(entry.groupKey);
    if (group) {
      group.events.push(entry.event);
    } else {
      groups.set(entry.groupKey, { item: entry.item, events: [entry.event] });
    }
    const cveId = primitiveText(entry.event.cve_id) || primitiveText(entry.item.cve_id);
    if (cveId !== "") {
      cveNames.add(cveId);
    }
    const domain = primitiveText(entry.item.domain);
    if (domain !== "") {
      domainNames.add(domain);
    }
  }
  return {
    shown: {
      groups: [...groups.values()],
      cves: keptTable(cveNames, shown.cves, answerTable(answer, "cves")),
      domains: keptTable(domainNames, shown.domains, answerTable(answer, "domains")),
    },
    added: kept.filter((e) => e.fresh).length,
  };
}

function isGroup(value: unknown): value is WatchEventGroup {
  return isRecord(value) && isRecord(value.item) && Array.isArray(value.events) && value.events.every(isRecord);
}

/**
 * Parses a stored value into ShownEvents.
 * A value with the wrong shape or another version parses as undefined.
 * An older extension version or a corrupt store then shows nothing, not a crash.
 */
export function parseShownEvents(value: unknown): ShownEvents | undefined {
  if (
    !isRecord(value)                ||
    value.version !== STORE_VERSION ||
    !Array.isArray(value.groups)    ||
    !value.groups.every(isGroup)    ||
    !isRecord(value.cves)           ||
    !isRecord(value.domains)
  ) {
    return undefined;
  }
  return { groups: value.groups, cves: value.cves, domains: value.domains };
}

/**
 * Keeps the shown watchlist events of one server between sessions.
 * The storage key holds the normalized base URL, so two servers never share a record.
 * The extension clears the record when the API key or the base URL changes.
 */
export class ShownEventStore {
  private readonly store: KeyValueStore;
  private readonly key: string;

  constructor(store: KeyValueStore, baseUrl: string) {
    this.store = store;
    this.key = SHOWN_EVENTS_KEY_PREFIX + normalizeBaseUrl(baseUrl);
  }

  /** Returns the stored record, or undefined when there is none or it has the wrong shape. */
  loadShownEvents(): ShownEvents | undefined {
    return parseShownEvents(this.store.get<unknown>(this.key));
  }

  /** Stores the shown events. */
  saveShownEvents(shown: ShownEvents): PromiseLike<void> {
    return this.store.update(this.key, { version: STORE_VERSION, ...shown });
  }

  /** Deletes the stored record. */
  clear(): PromiseLike<void> {
    return this.store.update(this.key, undefined);
  }
}

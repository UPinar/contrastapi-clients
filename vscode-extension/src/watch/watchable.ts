import { JsonSchemaProperty, McpTool } from "../mcp/client";
import { toolLabel } from "../views/toolTree";

/** WATCHLIST_EDIT_TOOL is the tool that lists, adds, removes and clears watch items. */
export const WATCHLIST_EDIT_TOOL = "watchlist_edit";

/** WATCHLIST_EVENTS_TOOL is the tool that reads the events of the watch items. */
export const WATCHLIST_EVENTS_TOOL = "watchlist_events";

/** PRICING_URL is the page that sells the Pro key the watchlist needs. */
export const PRICING_URL = "https://api.contrastcyber.com/pricing";

/** WatchRecord is one member of a server answer, kept as the server sent it. */
export type WatchRecord = Record<string, unknown>;

/** WatchItem is a watch item to add. It holds the tool it watches and that tool's watchable arguments. */
export interface WatchItem {
  endpoint: string;
  fields: Record<string, unknown>;
}

/** WatchEvent holds one event of a watchlist_events answer and the item it belongs to. */
export interface WatchEvent {
  item: WatchRecord;
  event: WatchRecord;
}

/** WatchEventGroup is one entry of a watchlist_events answer. It holds a watch item and the events that matched it. */
export interface WatchEventGroup {
  item: WatchRecord;
  events: WatchRecord[];
}

/** WatchlistUnavailableNotice holds the view message and the warning shown when the watchlist tools are missing. */
export interface WatchlistUnavailableNotice {
  viewMessage: string;
  warning: string;
}

const UNAVAILABLE_TEXT = "Watchlist is not available on this server.";

const NOT_LOADED_TEXT =
  "Watchlist cannot open yet. The tool list has not loaded. Check your connection, then run ContrastAPI: Refresh Tool List.";

/**
 * Returns what the watchlist view shows when the watchlist tools are missing.
 * An empty tool list means it never loaded, so the text asks for a refresh.
 * A loaded list without the tools means the server has no watchlist.
 * The not-loaded text already names ContrastAPI in its command, so its warning gets no prefix.
 */
export function watchlistUnavailableNotice(listLoaded: boolean): WatchlistUnavailableNotice {
  if (!listLoaded) {
    return { viewMessage: NOT_LOADED_TEXT, warning: NOT_LOADED_TEXT };
  }
  return { viewMessage: UNAVAILABLE_TEXT, warning: `ContrastAPI: ${UNAVAILABLE_TEXT}` };
}

const CONTROL_FIELDS = new Set(["action", "endpoint", "clear"]);
const SEARCH_ENDPOINT = "cve_search";
const TIME_MEMBER_REGEX = /^(?:time|at|date)$|_(?:at|time|date)$/;

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isRecord(value: unknown): value is WatchRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function editProperties(editTool: McpTool): Record<string, JsonSchemaProperty> {
  return editTool.inputSchema.properties ?? {};
}

/**
 * Returns the tool names watchlist_edit accepts as an endpoint.
 * The list comes from the tool's own schema, so a new server endpoint needs no extension release.
 */
export function watchEndpoints(editTool: McpTool): string[] {
  const values = editProperties(editTool).endpoint?.enum ?? [];
  return values.filter((v): v is string => typeof v === "string");
}

/**
 * Returns the arguments of a tool that a watch item can carry.
 * They are the properties both tools share, minus watchlist_edit's own controls.
 * A tool that is not in the endpoint enum gets none, even when it shares a name such as domain.
 * The order follows watchlist_edit's schema, so every form asks in the same order.
 */
export function watchableFields(editTool: McpTool, tool: McpTool): string[] {
  if (!watchEndpoints(editTool).includes(tool.name)) {
    return [];
  }
  const toolProps = tool.inputSchema.properties ?? {};
  return Object.keys(editProperties(editTool)).filter((f) => !CONTROL_FIELDS.has(f) && hasOwn(toolProps, f));
}

function requiredWatchable(tool: McpTool, fields: readonly string[]): string[] {
  const required = new Set(tool.inputSchema.required ?? []);
  return fields.filter((f) => required.has(f));
}

/**
 * Builds the watch item for a call that just ran.
 * The answer is undefined when the tool is not watchable.
 * It is also undefined when a required watchable field is missing, because the server would refuse the item.
 * A value that breaks a const of watchlist_edit gives undefined too.
 * The item then never watches more than the call asked for.
 * A cve_search with no filter is still an item: it watches every CVE event.
 */
export function watchItemFor(tool: McpTool, args: Record<string, unknown>, editTool: McpTool): WatchItem | undefined {
  if (!watchEndpoints(editTool).includes(tool.name)) {
    return undefined;
  }
  const fields = watchableFields(editTool, tool);
  const props = editProperties(editTool);
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (!hasOwn(args, field) || args[field] === undefined) {
      continue;
    }
    const prop = props[field];
    if (hasOwn(prop, "const") && args[field] !== prop.const) {
      return undefined;
    }
    picked[field] = args[field];
  }
  if (requiredWatchable(tool, fields).some((f) => !hasOwn(picked, f))) {
    return undefined;
  }
  return { endpoint: tool.name, fields: picked };
}

/**
 * Returns the watchlist_edit arguments that add an item.
 * addArgumentsFor drops item fields named action, endpoint or clear first.
 * No item field can then replace the action or the endpoint.
 */
export function addArgumentsFor(item: WatchItem): Record<string, unknown> {
  const fields = Object.fromEntries(Object.entries(item.fields).filter(([f]) => !CONTROL_FIELDS.has(f)));
  return { action: "add", endpoint: item.endpoint, ...fields };
}

function primitiveText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

/**
 * Returns the short name of a listed item for the watchlist tree.
 * A CVE item shows its ID, and a domain item its domain.
 * A product item shows vendor and product.
 * A cve_search item lists its filters, or says it watches every CVE.
 */
export function itemLabel(listed: WatchRecord): string {
  const endpoint = primitiveText(listed.endpoint);
  if (endpoint === SEARCH_ENDPOINT) {
    const filters = Object.entries(listed)
      .filter(([k, v]) => k !== "endpoint" && primitiveText(v) !== "")
      .map(([k, v]) => `${k}=${primitiveText(v)}`);
    return `CVE search: ${filters.length > 0 ? filters.join(", ") : "every CVE"}`;
  }
  const cveId = primitiveText(listed.cve_id);
  if (cveId !== "") {
    return cveId;
  }
  const domain = primitiveText(listed.domain);
  if (domain !== "") {
    return domain;
  }
  const vendor = primitiveText(listed.vendor);
  const product = primitiveText(listed.product);
  if (vendor !== "" && product !== "") {
    return `${vendor} ${product}`;
  }
  return endpoint;
}

/**
 * Returns the text of the result panel's Watch button.
 * A search's filters can be long, so a cve_search item reads "this search".
 */
export function watchButtonLabel(item: WatchItem): string {
  if (item.endpoint === SEARCH_ENDPOINT) {
    return "★ Watch this search";
  }
  return `★ Watch ${itemLabel({ ...item.fields, endpoint: item.endpoint })}`;
}

/**
 * Returns the watchlist_edit arguments that remove a listed item.
 * A listed item carries answer-only members such as product_has_cves.
 * The server refuses those members in a remove call.
 * Only the endpoint and that endpoint's watchable fields go back.
 * Without the endpoint's tool, every item field of watchlist_edit is kept.
 * That still drops the answer-only members.
 */
export function removeArgumentsFor(listed: WatchRecord, editTool: McpTool, endpointTool?: McpTool): Record<string, unknown> {
  const allowed =
    endpointTool !== undefined
      ? watchableFields(editTool, endpointTool)
      : Object.keys(editProperties(editTool)).filter((f) => !CONTROL_FIELDS.has(f));
  const args: Record<string, unknown> = { action: "remove", endpoint: listed.endpoint };
  for (const field of allowed) {
    if (hasOwn(listed, field)) {
      args[field] = listed[field];
    }
  }
  return args;
}

/**
 * Builds the tool the Add wizard's form asks from.
 * Its properties are the endpoint's watchable fields.
 * Each field keeps the schema that watchlist_edit gives it, so the form checks what the server checks.
 * Its required list is the endpoint tool's own required fields among them.
 * It has no annotations, so the form does not ask for a destructive-call confirmation.
 */
export function addFormTool(editTool: McpTool, endpointTool: McpTool): McpTool {
  const fields = watchableFields(editTool, endpointTool);
  const props = editProperties(editTool);
  return {
    name: endpointTool.name,
    title: `Watch ${toolLabel(endpointTool)}`,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(fields.map((f) => [f, props[f]])),
      required: requiredWatchable(endpointTool, fields),
    },
  };
}

/** Returns the items of a watchlist_edit answer, skipping any entry that is not an object. */
export function listedItems(answer: unknown): WatchRecord[] {
  if (!isRecord(answer) || !Array.isArray(answer.items)) {
    return [];
  }
  return answer.items.filter(isRecord);
}

function countText(answer: unknown): string {
  const record = isRecord(answer) ? answer : {};
  const count = typeof record.item_count === "number" ? record.item_count : listedItems(answer).length;
  return typeof record.item_limit === "number" ? `${count}/${record.item_limit}` : String(count);
}

/** Returns the watchlist view's message, such as "Items 3/100". */
export function itemCountMessage(answer: unknown): string {
  return `Items ${countText(answer)}`;
}

/**
 * Returns the Watch button's text after a successful add, such as "✓ Watching · 3/100".
 * An answer without counts gives a plain "✓ Watching".
 */
export function watchingLabel(answer: unknown): string {
  const record = isRecord(answer) ? answer : {};
  return typeof record.item_count === "number" ? `✓ Watching · ${countText(answer)}` : "✓ Watching";
}

/**
 * Returns the item groups of a watchlist_events answer in answer order.
 * The server already groups the events by item, and the tree shows that grouping as it is.
 * An event that matches two items stays under both items.
 * The answer is untrusted, so an entry without an item object or an events list is skipped.
 * An event that is not an object is skipped too.
 */
export function eventGroups(answer: unknown): WatchEventGroup[] {
  if (!isRecord(answer) || !Array.isArray(answer.items)) {
    return [];
  }
  const groups: WatchEventGroup[] = [];
  for (const entry of answer.items) {
    if (!isRecord(entry) || !isRecord(entry.item) || !Array.isArray(entry.events)) {
      continue;
    }
    groups.push({ item: entry.item, events: entry.events.filter(isRecord) });
  }
  return groups;
}

function eventCveId(e: WatchEvent): string {
  return primitiveText(e.event.cve_id) || primitiveText(e.item.cve_id);
}

function eventDomain(e: WatchEvent): string {
  return primitiveText(e.item.domain);
}

/**
 * Returns the tree label of an event: its type and its subject.
 * The server names the type in the member `event`.
 * A CVE event names its CVE in `cve_id`, and that ID is the subject.
 * A search item's events therefore name the CVE that matched.
 * A domain event has no subject member, so the item's own label is the subject.
 */
export function eventLabel(e: WatchEvent): string {
  const type = primitiveText(e.event.event) || "event";
  const subject = primitiveText(e.event.cve_id) || itemLabel(e.item);
  return `${type} · ${subject}`;
}

/**
 * Returns the time of an event, when it has one.
 * The first string member named time, at or date, or ending in _at, _time or _date, counts.
 */
export function eventTime(event: WatchRecord): string | undefined {
  for (const [key, value] of Object.entries(event)) {
    if (TIME_MEMBER_REGEX.test(key) && typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function ownEntry(answer: unknown, table: string, key: string): unknown {
  if (key === "" || !isRecord(answer)) {
    return undefined;
  }
  const entries = answer[table];
  return isRecord(entries) && hasOwn(entries, key) ? entries[key] : undefined;
}

/**
 * Returns what the result panel shows for one event.
 * The answer's cves and domains tables hold each subject once, so the event's entry is copied in.
 * Only own members count, so a subject named constructor finds nothing.
 */
export function eventDetail(e: WatchEvent, answer: unknown): Record<string, unknown> {
  const detail: Record<string, unknown> = { event: e.event, item: e.item };
  const cve = ownEntry(answer, "cves", eventCveId(e));
  if (cve !== undefined) {
    detail.cve = cve;
  }
  const domain = ownEntry(answer, "domains", eventDomain(e));
  if (domain !== undefined) {
    detail.domain = domain;
  }
  return detail;
}

/**
 * Tells whether a refusal is the server's "needs a Pro API key" answer.
 * That text links the pricing page, so the extension offers the same page as a button.
 */
export function isProKeyRefusal(message: string): boolean {
  return message.includes("/pricing");
}

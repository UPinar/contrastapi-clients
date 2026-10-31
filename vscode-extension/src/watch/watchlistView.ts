import * as vscode from "vscode";
import { askToolArguments } from "../forms/formRunner";
import { McpTool, ToolError } from "../mcp/client";
import { ToolSession, showCallError } from "../session";
import { ResultPanel } from "../views/resultPanel";
import { toolLabel } from "../views/toolTree";
import { ShownEventStore, ShownEvents, emptyShownEvents, mergeShownEvents, shownEventCount } from "./eventStore";
import {
  PRICING_URL,
  WATCHLIST_EDIT_TOOL,
  WATCHLIST_EVENTS_TOOL,
  WatchEvent,
  WatchEventGroup,
  WatchItem,
  WatchRecord,
  addArgumentsFor,
  addFormTool,
  eventDetail,
  eventLabel,
  eventTime,
  isProKeyRefusal,
  itemCountMessage,
  itemLabel,
  listedItems,
  removeArgumentsFor,
  watchEndpoints,
  watchingLabel,
  watchlistUnavailableNotice,
} from "./watchable";

const VIEW_ID = "contrastapi-watchlist";
const NO_KEY_MESSAGE = "The watchlist needs a Pro API key.";
const GET_PRO_KEY = "Get a Pro key";
const SET_API_KEY = "Set API Key";
const FETCH_LIMIT = 100;
const NO_NEW_EVENTS_MESSAGE = "ContrastAPI: No new events.";

type WatchNode =
  | { kind: "items" }
  | { kind: "events" }
  | { kind: "item"; listed: WatchRecord; index: number }
  | { kind: "group"; group: WatchEventGroup; index: number }
  | { kind: "event"; event: WatchEvent; index: number };

/** Offers the pricing page, because only a Pro key unlocks the watchlist. */
async function offerProKey(message: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(message, GET_PRO_KEY, SET_API_KEY);
  if (choice === GET_PRO_KEY) {
    await vscode.env.openExternal(vscode.Uri.parse(PRICING_URL));
  } else if (choice === SET_API_KEY) {
    await vscode.commands.executeCommand("contrastapi.setApiKey");
  }
}

/** Shows a failed watchlist call. The server's Pro-key refusal gets the pricing button. */
async function showWatchError(err: unknown): Promise<void> {
  if (err instanceof ToolError && isProKeyRefusal(err.message)) {
    const choice = await vscode.window.showErrorMessage(err.message, GET_PRO_KEY);
    if (choice === GET_PRO_KEY) {
      await vscode.env.openExternal(vscode.Uri.parse(PRICING_URL));
    }
    return;
  }
  await showCallError(err);
}

/**
 * Draws the watchlist view and runs every watchlist action.
 * The view loads when it first becomes visible.
 * A view that is already visible at start-up loads at once.
 * A hidden view makes no call, because each call spends a credit.
 * "Fetch New Events" moves the key's read position.
 * Clear deletes the position, and so does a remove that leaves no item.
 * The position is shared with every agent using the same key.
 * A fetch adds its new events to the shown ones, and an empty fetch keeps them.
 * The shown events are stored per server, so they come back in the next session.
 * The first open without a stored record reads the last batch again with repeat:true, which does not move the position.
 * Refresh reads the item list again and keeps the shown events.
 * Nothing polls in the background.
 */
export class WatchlistView implements vscode.TreeDataProvider<WatchNode>, vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly session: ToolSession;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly view: vscode.TreeView<WatchNode>;
  private readonly disposables: vscode.Disposable[] = [];
  private items: WatchRecord[] = [];
  private shown: ShownEvents = emptyShownEvents();
  private eventsRead = false;
  private epoch = 0;
  private loaded = false;
  private loading: Promise<void> | undefined;
  private noKeyOffered = false;
  private unavailableShown = false;

  /** Fires when the tree's content changes. */
  readonly onDidChangeTreeData: vscode.Event<void> = this.changed.event;

  constructor(context: vscode.ExtensionContext, session: ToolSession) {
    this.context = context;
    this.session = session;
    this.view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this });
    this.disposables.push(
      this.view,
      this.changed,
      this.view.onDidChangeVisibility((e) => {
        if (e.visible) {
          this.view.badge = undefined;
          void this.loadOnce();
        }
      }),
    );
    if (this.view.visible) {
      void this.loadOnce();
    }
  }

  getTreeItem(node: WatchNode): vscode.TreeItem {
    switch (node.kind) {
      case "items": {
        const item = new vscode.TreeItem(`Items (${this.items.length})`, vscode.TreeItemCollapsibleState.Expanded);
        item.id = "watch:items";
        return item;
      }
      case "events": {
        const item = new vscode.TreeItem("Events", vscode.TreeItemCollapsibleState.Expanded);
        item.id = "watch:events";
        item.description = String(this.eventCount());
        return item;
      }
      case "item": {
        const item = new vscode.TreeItem(itemLabel(node.listed), vscode.TreeItemCollapsibleState.None);
        const endpoint = typeof node.listed.endpoint === "string" ? node.listed.endpoint : "";
        const tool = this.session.findTool(endpoint);
        item.description = tool ? toolLabel(tool) : endpoint;
        item.contextValue = "watchItem";
        item.iconPath = new vscode.ThemeIcon("eye");
        return item;
      }
      case "group": {
        const state = node.group.events.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(itemLabel(node.group.item), state);
        item.description = String(node.group.events.length);
        item.iconPath = new vscode.ThemeIcon("eye");
        return item;
      }
      case "event": {
        const item = new vscode.TreeItem(eventLabel(node.event), vscode.TreeItemCollapsibleState.None);
        item.description = eventTime(node.event.event);
        item.iconPath = new vscode.ThemeIcon("bell");
        item.command = { command: "contrastapi.watchlistOpenEvent", title: "Open Event", arguments: [node] };
        return item;
      }
    }
  }

  getChildren(node?: WatchNode): WatchNode[] {
    if (!node) {
      return this.loaded || this.eventsRead || this.items.length > 0 ? [{ kind: "items" }, { kind: "events" }] : [];
    }
    if (node.kind === "items") {
      return this.items.map((listed, index) => ({ kind: "item", listed, index }));
    }
    if (node.kind === "events") {
      return this.shown.groups.map((group, index) => ({ kind: "group", group, index }));
    }
    if (node.kind === "group") {
      const item = node.group.item;
      return node.group.events.map((event, index) => ({ kind: "event", event: { item, event }, index }));
    }
    return [];
  }

  private eventCount(): number {
    return shownEventCount(this.shown);
  }

  /**
   * Forgets what the view shows, such as after a key change.
   * forgetEventsOf names the servers whose stored events are deleted too.
   * A call still running when the view resets is ignored when it answers.
   * A visible view loads again at once.
   * A hidden view loads when it is next shown.
   */
  async reset(forgetEventsOf: readonly (string | undefined)[] = []): Promise<void> {
    this.epoch++;
    this.loaded = false;
    this.noKeyOffered = false;
    this.items = [];
    this.shown = emptyShownEvents();
    this.eventsRead = false;
    this.view.message = undefined;
    this.unavailableShown = false;
    this.changed.fire();
    for (const baseUrl of forgetEventsOf) {
      if (baseUrl !== undefined) {
        await new ShownEventStore(this.context.globalState, baseUrl).clear();
      }
    }
    if (this.view.visible) {
      void this.loadOnce();
    }
  }

  private eventStore(): ShownEventStore {
    return new ShownEventStore(this.context.globalState, this.session.getBaseUrl());
  }

  /**
   * Shows why the watchlist is missing when the tool list lacks its tools.
   * A list that comes back with the tools loads the view again.
   */
  onToolsChanged(): void {
    if (!this.findTools()) {
      this.showUnavailable(false);
    } else if (this.unavailableShown) {
      void this.reset();
    }
  }

  /**
   * Sets the view's message for missing watchlist tools.
   * The text tells a tool list that never loaded apart from a server without a watchlist.
   */
  private showUnavailable(offer: boolean): void {
    const notice = watchlistUnavailableNotice(this.session.getTools().length > 0);
    this.view.message = notice.viewMessage;
    this.unavailableShown = true;
    if (offer) {
      void vscode.window.showWarningMessage(notice.warning);
    }
  }

  private findTools(): { edit: McpTool; events: McpTool } | undefined {
    const edit = this.session.findTool(WATCHLIST_EDIT_TOOL);
    const events = this.session.findTool(WATCHLIST_EVENTS_TOOL);
    return edit && events ? { edit, events } : undefined;
  }

  /**
   * Checks that the server has the watchlist and that a key is stored.
   * Without a key no call is made, so no credit is spent on a sure refusal.
   * offer false only sets the view's message.
   * The lazy load passes false, so a view switch does not show a notification every time.
   */
  private async ready(offer: boolean): Promise<{ edit: McpTool; events: McpTool } | undefined> {
    await this.session.ensureLoaded();
    const tools = this.findTools();
    if (!tools) {
      this.showUnavailable(offer);
      return undefined;
    }
    if (!(await this.session.hasApiKey())) {
      this.view.message = NO_KEY_MESSAGE;
      if (offer) {
        void offerProKey(NO_KEY_MESSAGE);
      }
      return undefined;
    }
    return tools;
  }

  private call(name: string, args: Record<string, unknown>): Thenable<unknown> {
    return vscode.window.withProgress({ location: { viewId: VIEW_ID } }, () => this.session.callTool(name, args));
  }

  private applyList(answer: unknown): void {
    this.items = listedItems(answer);
    this.view.message = itemCountMessage(answer);
    this.changed.fire();
  }

  private showEvents(shown: ShownEvents): void {
    this.shown = shown;
    this.eventsRead = true;
    this.changed.fire();
  }

  private loadOnce(): Promise<void> {
    if (this.loaded) {
      return Promise.resolve();
    }
    const offer = !this.noKeyOffered;
    this.noKeyOffered = true;
    return this.load(offer);
  }

  /**
   * Reads the item list again.
   * The first load shows the stored events, and makes no events call.
   * Without a stored record it reads the last batch with repeat:true, so the key's read position stays where it is.
   * Its answer is stored.
   * A later load keeps the shown events, so a repeat read never replaces events that a fetch added.
   * A fetch that ends while the repeat read runs is kept too, because the repeat answer is merged in.
   * Two loads at once share one set of calls.
   */
  load(offer = true): Promise<void> {
    if (!this.loading) {
      this.loading = this.loadNow(offer).finally(() => {
        this.loading = undefined;
      });
    }
    return this.loading;
  }

  private async loadNow(offer: boolean): Promise<void> {
    const tools = await this.ready(offer);
    if (!tools) {
      return;
    }
    const epoch = this.epoch;
    const store = this.eventStore();
    if (!this.eventsRead) {
      const stored = store.loadShownEvents();
      if (stored) {
        this.showEvents(stored);
      }
    }
    try {
      const list = await this.call(tools.edit.name, {});
      if (epoch !== this.epoch) {
        return;
      }
      this.applyList(list);
      this.loaded = true;
      if (this.eventsRead) {
        return;
      }
      const answer = await this.call(tools.events.name, { repeat: true });
      if (epoch !== this.epoch) {
        return;
      }
      this.showEvents(mergeShownEvents(this.shown, answer).shown);
      await store.saveShownEvents(this.shown);
    } catch (err: unknown) {
      await showWatchError(err);
    }
  }

  /**
   * Reads the events after the last batch, which moves the key's read position.
   * The position is shared with every agent using this key, so the command's title says so.
   * The new events join the shown ones, and the result is stored.
   * A fetch with no new event keeps the shown events and says so.
   * A hidden view shows the count of added events as a badge until it is opened.
   */
  async fetchNew(): Promise<void> {
    const tools = await this.ready(true);
    if (!tools) {
      return;
    }
    const epoch = this.epoch;
    const store = this.eventStore();
    try {
      const answer = await this.call(tools.events.name, { limit: FETCH_LIMIT });
      if (epoch !== this.epoch) {
        return;
      }
      const base = this.eventsRead ? this.shown : (store.loadShownEvents() ?? emptyShownEvents());
      const merged = mergeShownEvents(base, answer);
      const hasMore = typeof answer === "object" && answer !== null && (answer as WatchRecord).has_more === true;
      if (merged.added === 0) {
        this.showEvents(base);
        if (!hasMore) {
          void vscode.window.showInformationMessage(NO_NEW_EVENTS_MESSAGE);
        }
      } else {
        this.showEvents(merged.shown);
        await store.saveShownEvents(merged.shown);
        if (!this.view.visible) {
          this.view.badge = { value: merged.added, tooltip: `${merged.added} new watchlist events` };
        }
      }
      if (hasMore) {
        void vscode.window.showInformationMessage("ContrastAPI: more watchlist events are waiting. Fetch again to read them.");
      }
    } catch (err: unknown) {
      await showWatchError(err);
    }
  }

  /**
   * Adds one item and redraws the list from the answer.
   * The add answer already holds the whole list, so no second call is needed.
   * The answer is undefined when the item was not added.
   */
  async addItem(item: WatchItem): Promise<unknown> {
    const tools = await this.ready(true);
    if (!tools) {
      return undefined;
    }
    try {
      const answer = await this.call(tools.edit.name, addArgumentsFor(item));
      this.applyList(answer);
      return answer;
    } catch (err: unknown) {
      await showWatchError(err);
      return undefined;
    }
  }

  /** Runs the Watch button of the result panel, and returns the button's new text. */
  async watchFromPanel(item: WatchItem): Promise<string | undefined> {
    const answer = await this.addItem(item);
    return answer === undefined ? undefined : watchingLabel(answer);
  }

  /**
   * Asks for a new item: the endpoint first, then that endpoint's watchable fields.
   * The form is built from watchlist_edit's own property schemas, so it checks what the server checks.
   */
  async addWizard(): Promise<void> {
    const tools = await this.ready(true);
    if (!tools) {
      return;
    }
    const choices = watchEndpoints(tools.edit).flatMap((name) => {
      const tool = this.session.findTool(name);
      return tool ? [{ label: toolLabel(tool), description: name, tool }] : [];
    });
    const picked = await vscode.window.showQuickPick(choices, { placeHolder: "What should the watchlist watch?" });
    if (!picked) {
      return;
    }
    const fields = await askToolArguments(addFormTool(tools.edit, picked.tool), { doneLabel: "★ Add" });
    if (!fields) {
      return;
    }
    await this.addItem({ endpoint: picked.tool.name, fields });
  }

  /** Removes one listed item. Only the fields the server accepts go back. */
  async remove(node: WatchNode | undefined): Promise<void> {
    if (node?.kind !== "item") {
      return;
    }
    const tools = await this.ready(true);
    if (!tools) {
      return;
    }
    const endpoint = typeof node.listed.endpoint === "string" ? node.listed.endpoint : "";
    try {
      this.applyList(await this.call(tools.edit.name, removeArgumentsFor(node.listed, tools.edit, this.session.findTool(endpoint))));
    } catch (err: unknown) {
      await showWatchError(err);
    }
  }

  /** Deletes every item and the event position after a modal confirmation. */
  async clearAll(): Promise<void> {
    const tools = await this.ready(true);
    if (!tools) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      "Delete every watch item and the event read position? Agents using the same key lose them too.",
      { modal: true },
      "Clear All",
    );
    if (answer !== "Clear All") {
      return;
    }
    try {
      this.applyList(await this.call(tools.edit.name, { clear: true }));
      this.showEvents(emptyShownEvents());
      await this.eventStore().saveShownEvents(this.shown);
    } catch (err: unknown) {
      await showWatchError(err);
    }
  }

  /** Opens one event in the result panel with its CVE or domain entry. */
  openEvent(node: WatchNode | undefined): void {
    if (node?.kind !== "event") {
      return;
    }
    ResultPanel.show(this.context, eventLabel(node.event), eventDetail(node.event, this.shown));
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/**
 * Registers the watchlist view and its commands.
 */
export function registerWatchlist(context: vscode.ExtensionContext, session: ToolSession): WatchlistView {
  const view = new WatchlistView(context, session);
  session.setWatchHandler((item) => view.watchFromPanel(item));

  context.subscriptions.push(
    view,
    session.onDidChangeTools(() => view.onToolsChanged()),
    vscode.commands.registerCommand("contrastapi.watchlistAdd", () => view.addWizard()),
    vscode.commands.registerCommand("contrastapi.watchlistRefresh", () => view.load()),
    vscode.commands.registerCommand("contrastapi.watchlistFetchNewEvents", () => view.fetchNew()),
    vscode.commands.registerCommand("contrastapi.watchlistClear", () => view.clearAll()),
    vscode.commands.registerCommand("contrastapi.watchlistRemove", (node: WatchNode | undefined) => view.remove(node)),
    vscode.commands.registerCommand("contrastapi.watchlistOpenEvent", (node: WatchNode | undefined) => view.openEvent(node)),
  );
  return view;
}

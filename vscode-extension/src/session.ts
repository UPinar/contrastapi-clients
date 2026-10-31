import * as vscode from "vscode";
import { ToolCache } from "./cache/toolCache";
import { CLIENT_STARTING_MESSAGE, describeError, toolListRefreshWarning, toolListUnavailableWarning } from "./forms/errorNotice";
import { McpClient, McpTool } from "./mcp/client";
import { SecretStore } from "./utils/secrets";
import { readBaseUrl } from "./utils/settings";
import { StatusBar } from "./utils/statusBar";
import { ResultPanel, WatchOffer } from "./views/resultPanel";
import { toolLabel } from "./views/toolTree";
import { WATCHLIST_EDIT_TOOL, WatchItem, watchButtonLabel, watchItemFor } from "./watch/watchable";

/** Adds one watch item and returns the Watch button's new text, or undefined when nothing was added. */
export type WatchHandler = (item: WatchItem) => Promise<string | undefined>;

/**
 * Shows a failed call to the user.
 * A rejected key gets a "Set API Key" button, because a new key is the only fix.
 */
export async function showCallError(err: unknown): Promise<void> {
  const notice = describeError(err);
  if (!notice.offerSetApiKey) {
    await vscode.window.showErrorMessage(notice.message);
    return;
  }
  const choice = await vscode.window.showErrorMessage(notice.message, "Set API Key");
  if (choice === "Set API Key") {
    await vscode.commands.executeCommand("contrastapi.setApiKey");
  }
}

/**
 * Holds the MCP client and the server's tool list for the whole extension.
 * Every command reads tools from here, so the sidebar and the palette always agree.
 * The client is rebuilt when the key or the base URL changes.
 */
export class ToolSession implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly secrets: SecretStore;
  private readonly statusBar: StatusBar;
  private readonly changed = new vscode.EventEmitter<void>();
  private client: McpClient | undefined;
  private clientError = CLIENT_STARTING_MESSAGE;
  private baseUrl: string | undefined;
  private cache: ToolCache | undefined;
  private tools: McpTool[] = [];
  private refreshing: Promise<void> | undefined;
  private generation = 0;
  private watchHandler: WatchHandler | undefined;

  /** Fires when the tool list changes, so the sidebar redraws. */
  readonly onDidChangeTools: vscode.Event<void> = this.changed.event;

  constructor(context: vscode.ExtensionContext, secrets: SecretStore, statusBar: StatusBar) {
    this.context = context;
    this.secrets = secrets;
    this.statusBar = statusBar;
  }

  /**
   * Builds a new client from the current base URL and key.
   * A new base URL also switches to that server's cached tool list.
   * A refused base URL leaves no client.
   * A call then shows why.
   * A newer rebuild that finishes first wins, so a slow key read cannot restore an old client.
   */
  async rebuild(): Promise<void> {
    const generation = ++this.generation;
    const baseUrl = readBaseUrl();
    const apiKey = await this.secrets.getApiKey();
    if (generation !== this.generation) {
      return;
    }
    const version = String((this.context.extension.packageJSON as { version?: unknown }).version ?? "0.0.0");
    try {
      this.client = new McpClient({
        baseUrl,
        apiKey,
        userAgent: `contrastapi-vscode/${version}`,
        onRateLimit: (info) => this.statusBar.updateFromServer(info),
      });
    } catch (err: unknown) {
      this.client = undefined;
      this.clientError = err instanceof Error ? err.message : String(err);
    }
    if (baseUrl !== this.baseUrl) {
      this.baseUrl = baseUrl;
      this.cache = new ToolCache(this.context.globalState, baseUrl);
      this.tools = this.cache.readToolCache()?.tools ?? [];
      this.changed.fire();
    }
  }

  /** Returns the base URL of the current client, or the setting before the first rebuild. */
  getBaseUrl(): string {
    return this.baseUrl ?? readBaseUrl();
  }

  /** Returns the current tool list in the server's order. */
  getTools(): readonly McpTool[] {
    return this.tools;
  }

  /** Finds a tool of the current list by name. */
  findTool(name: string): McpTool | undefined {
    return this.tools.find((t) => t.name === name);
  }

  /**
   * Refreshes the list only when the cache is empty or older than its maximum age.
   * Each refresh spends a credit, so start-up does not refetch a fresh list.
   */
  async refreshIfStale(): Promise<void> {
    if (!this.cache || this.cache.isToolCacheStale(Date.now())) {
      await this.refresh();
    }
  }

  /**
   * Waits for a tool list when there is none yet.
   * A command run right after the first start then sees the tools and not an empty list.
   */
  async ensureLoaded(): Promise<void> {
    if (this.tools.length === 0) {
      await (this.refreshing ?? this.refresh());
    }
  }

  /**
   * Fetches tools/list and stores it.
   * A failed refresh keeps the old list and shows a warning, so a network error never empties the sidebar.
   * Two refreshes at once share one request.
   */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.fetchTools().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async fetchTools(): Promise<void> {
    const client = this.client;
    const cache = this.cache;
    if (!client || !cache) {
      void vscode.window.showWarningMessage(toolListUnavailableWarning(this.clientError));
      return;
    }
    try {
      const tools = await client.listTools();
      await cache.saveToolCache(tools, Date.now());
      if (cache === this.cache) {
        this.tools = tools;
        this.changed.fire();
      }
    } catch (err: unknown) {
      void vscode.window.showWarningMessage(toolListRefreshWarning(err));
    }
  }

  /** Tells whether SecretStorage holds a key, so a Pro-only call can be skipped before it spends a credit. */
  async hasApiKey(): Promise<boolean> {
    const key = await this.secrets.getApiKey();
    return key !== undefined && key !== "";
  }

  /**
   * Sets the code behind the result panel's Watch button.
   * The watchlist view owns the add call, so the session only hands the item over.
   */
  setWatchHandler(handler: WatchHandler): void {
    this.watchHandler = handler;
  }

  /**
   * Calls one tool and returns its answer without showing it.
   * The watchlist view uses it and draws the answer itself.
   * A missing client throws its reason, so the caller's error display shows it.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.client;
    if (!client) {
      throw new Error(this.clientError);
    }
    return client.callTool(name, args);
  }

  private watchOffer(tool: McpTool, args: Record<string, unknown>): WatchOffer | undefined {
    const handler = this.watchHandler;
    const editTool = this.findTool(WATCHLIST_EDIT_TOOL);
    if (!handler || !editTool) {
      return undefined;
    }
    const item = watchItemFor(tool, args, editTool);
    if (!item) {
      return undefined;
    }
    return { label: watchButtonLabel(item), add: () => handler(item) };
  }

  /**
   * Calls one tool and shows its answer in the result panel.
   * A watchable call gets a Watch button for the item it describes.
   * A failure goes to showCallError.
   * The watchlist view shows its own errors with showWatchError.
   * showWatchError adds a pricing button to the Pro-key refusal and passes every other error to showCallError.
   */
  async run(tool: McpTool, args: Record<string, unknown>): Promise<void> {
    const client = this.client;
    if (!client) {
      await showCallError(new Error(this.clientError));
      return;
    }
    const label = toolLabel(tool);
    try {
      const data = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `ContrastAPI: Running ${label}...` },
        () => client.callTool(tool.name, args),
      );
      ResultPanel.show(this.context, label, data, this.watchOffer(tool, args));
    } catch (err: unknown) {
      await showCallError(err);
    }
  }

  dispose(): void {
    this.changed.dispose();
  }
}

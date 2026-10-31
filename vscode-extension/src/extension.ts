import * as vscode from "vscode";
import { TOOL_SHORTCUTS, ToolShortcut, missingToolMessage } from "./commands/shortcuts";
import { runToolForm } from "./forms/formRunner";
import { registerMcpServerProvider } from "./mcp/registerProvider";
import { ToolSession } from "./session";
import { RateTracker } from "./utils/rateLimit";
import { SecretStore } from "./utils/secrets";
import { StatusBar } from "./utils/statusBar";
import { SidebarProvider } from "./views/sidebar";
import { toolPickItems } from "./views/toolPick";
import { registerWatchlist } from "./watch/watchlistView";

async function runTool(session: ToolSession): Promise<void> {
  await session.ensureLoaded();
  const tools = session.getTools();
  if (tools.length === 0) {
    return;
  }
  const picked = await vscode.window.showQuickPick(toolPickItems(tools), {
    placeHolder: "Pick a ContrastAPI tool",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked) {
    await runToolForm(session, picked.tool);
  }
}

async function runNamedTool(session: ToolSession, toolName: string, title: string): Promise<void> {
  await session.ensureLoaded();
  const tool = session.findTool(toolName);
  if (!tool) {
    void vscode.window.showWarningMessage(missingToolMessage(title, session.getTools().length > 0));
    return;
  }
  await runToolForm(session, tool);
}

function registerShortcut(context: vscode.ExtensionContext, session: ToolSession, shortcut: ToolShortcut): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(shortcut.command, () => runNamedTool(session, shortcut.toolName, shortcut.title)),
  );
}

/**
 * Wires the extension to the server's MCP tool list.
 * The cached list shows at once.
 * A stale or empty cache is refreshed in the background.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const secretStore = new SecretStore(context);
  const statusBar = new StatusBar(new RateTracker());
  context.subscriptions.push(statusBar);

  const session = new ToolSession(context, secretStore, statusBar);
  context.subscriptions.push(session);
  await session.rebuild();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("contrastapi-sidebar", new SidebarProvider(session)),
    vscode.commands.registerCommand("contrastapi.runTool", () => runTool(session)),
    vscode.commands.registerCommand("contrastapi.refreshTools", () => session.refresh()),
    vscode.commands.registerCommand("contrastapi.runToolFromTree", (toolName: unknown) =>
      typeof toolName === "string" ? runNamedTool(session, toolName, toolName) : undefined,
    ),
  );
  for (const shortcut of TOOL_SHORTCUTS) {
    registerShortcut(context, session, shortcut);
  }
  const watchlist = registerWatchlist(context, session);

  const mcpProvider = registerMcpServerProvider(context, secretStore);

  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.setApiKey", async () => {
      const key = (
        await vscode.window.showInputBox({
          prompt: "Enter your ContrastAPI key",
          password: true,
          ignoreFocusOut: true,
        })
      )?.trim();
      if (key) {
        await secretStore.setApiKey(key);
        await session.rebuild();
        mcpProvider?.notifyChanged();
        void vscode.window.showInformationMessage("ContrastAPI: API key saved");
      }
    }),
    vscode.commands.registerCommand("contrastapi.clearApiKey", async () => {
      await secretStore.clearApiKey();
      await session.rebuild();
      mcpProvider?.notifyChanged();
      void vscode.window.showInformationMessage("ContrastAPI: API key cleared");
    }),
    secretStore.onDidChangeApiKey(() => {
      void session.rebuild().then(() => watchlist.reset([session.getBaseUrl()]));
      mcpProvider?.notifyKeyChanged();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("contrastapi.baseUrl")) {
        const previousBaseUrl = session.getBaseUrl();
        void session.rebuild().then(async () => {
          await watchlist.reset([previousBaseUrl, session.getBaseUrl()]);
          return session.refreshIfStale();
        });
        mcpProvider?.notifyChanged();
      } else if (e.affectsConfiguration("contrastapi.mcp.register")) {
        mcpProvider?.notifyChanged();
      }
    }),
  );

  void session.refreshIfStale();
}

/** Nothing to release by hand: every resource is in context.subscriptions. */
export function deactivate(): void {}

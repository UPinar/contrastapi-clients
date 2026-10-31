import * as vscode from "vscode";
import { ContrastClient } from "./api/client";
import { registerCveCommands } from "./commands/cve";
import { registerDomainCommands } from "./commands/domain";
import { registerIpCommands } from "./commands/ip";
import { registerIocCommands } from "./commands/ioc";
import { registerContactCommands } from "./commands/contact";
import { registerCodesecCommands } from "./commands/codesec";
import { registerAtlasCommands } from "./commands/atlas";
import { registerD3fendCommands } from "./commands/d3fend";
import { registerSigmaCommands } from "./commands/sigma";
import { registerContextMenu } from "./context/contextMenu";
import { SecretStore } from "./utils/secrets";
import { RateTracker } from "./utils/rateLimit";
import { StatusBar } from "./utils/statusBar";
import { SidebarProvider } from "./views/sidebar";

let client: ContrastClient;
let secretStore: SecretStore;
let outputChannel: vscode.OutputChannel;
let statusBar: StatusBar;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("ContrastAPI");

  const config = vscode.workspace.getConfiguration("contrastapi");
  const baseUrl = config.get<string>("baseUrl", "https://api.contrastcyber.com");

  secretStore = new SecretStore(context);
  const apiKey = await secretStore.getApiKey();

  client = new ContrastClient(baseUrl, apiKey);

  const tracker = new RateTracker();
  statusBar = new StatusBar(tracker);
  context.subscriptions.push({ dispose: () => statusBar.dispose() });

  client.setOnRequest((remaining, limit, reset) => {
    statusBar.updateFromServer(remaining, limit, reset);
  });

  registerDomainCommands(context, client);
  registerCveCommands(context, client);
  registerIpCommands(context, client);
  registerIocCommands(context, client);
  registerContactCommands(context, client);
  registerCodesecCommands(context, client);
  registerAtlasCommands(context, client);
  registerD3fendCommands(context, client);
  registerSigmaCommands(context, client);
  registerContextMenu(context, client);

  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your ContrastAPI key",
        password: true,
        ignoreFocusOut: true,
      });
      if (key) {
        await secretStore.setApiKey(key);
        client.setApiKey(key);
        vscode.window.showInformationMessage("API key saved");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.clearApiKey", async () => {
      await secretStore.clearApiKey();
      client.setApiKey(undefined);
      vscode.window.showInformationMessage("API key cleared");
    })
  );

  const sidebarProvider = new SidebarProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("contrastapi-sidebar", sidebarProvider)
  );

  outputChannel.appendLine("ContrastAPI extension activated");
}

export function deactivate() {}

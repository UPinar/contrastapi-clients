import * as vscode from "vscode";
import { SecretStore } from "../utils/secrets";
import { readBaseUrl, readMcpRegisterSetting } from "../utils/settings";
import { buildServerDefinitionHeaders, checkServerKey, isRegistrationEnabled, mcpServerUrl } from "./registration";

const PROVIDER_ID = "contrastapi";
const SERVER_LABEL = "ContrastAPI";

/** KEY_REFUSED_MESSAGE tells the user why the MCP server did not start and how to fix it. */
const KEY_REFUSED_MESSAGE =
  "ContrastAPI: the server refused the API key, so the MCP server was not started. Run ContrastAPI: Set API Key.";

/**
 * Offers ContrastAPI to VS Code chat as an MCP server, only while contrastapi.mcp.register is "on".
 * The key is added at resolve time, so it is never part of the definition list VS Code reads eagerly.
 */
export class ContrastMcpServerProvider
  implements vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>, vscode.Disposable
{
  private readonly secrets: SecretStore;
  private readonly changed = new vscode.EventEmitter<void>();

  /**
   * keyVersion counts the key changes since activation.
   * The definition carries it as its version, so VS Code sees that the server changed after a new key.
   * VS Code then marks the server's tools as changed and offers to refresh them.
   * A refresh then starts a connection with the new key's headers.
   * The number holds nothing of the key itself.
   */
  private keyVersion = 0;

  /** Fires when the setting, the base URL or the key changes, so VS Code asks again. */
  readonly onDidChangeMcpServerDefinitions: vscode.Event<void> = this.changed.event;

  constructor(secrets: SecretStore) {
    this.secrets = secrets;
  }

  provideMcpServerDefinitions(): vscode.McpHttpServerDefinition[] {
    if (!isRegistrationEnabled(readMcpRegisterSetting())) {
      return [];
    }
    const url = mcpServerUrl(readBaseUrl());
    return url === undefined ? [] : [new vscode.McpHttpServerDefinition(SERVER_LABEL, vscode.Uri.parse(url), {}, String(this.keyVersion))];
  }

  /**
   * Adds the key header just before VS Code connects.
   * The trust check reads the definition's own URI, so the key goes only where VS Code will connect.
   * The headers are replaced, not merged, so a cleared key does not linger on a reused definition.
   * A server resolved after the setting was turned off is not started.
   * A key the server refuses also stops the start, with a warning.
   * Otherwise VS Code would read the server's 401 as an OAuth challenge and open a client registration dialog.
   */
  async resolveMcpServerDefinition(
    server: vscode.McpHttpServerDefinition,
  ): Promise<vscode.McpHttpServerDefinition | undefined> {
    if (!isRegistrationEnabled(readMcpRegisterSetting())) {
      return undefined;
    }
    const apiKey = (await this.secrets.getApiKey()) ?? "";
    const headers = buildServerDefinitionHeaders(server.uri.toString(true), apiKey);
    if (Object.keys(headers).length > 0 && (await checkServerKey(server.uri.toString(true), headers)) === "refused") {
      void vscode.window.showWarningMessage(KEY_REFUSED_MESSAGE);
      return undefined;
    }
    server.headers = headers;
    return server;
  }

  /** Tells VS Code to read the definitions again. */
  notifyChanged(): void {
    this.changed.fire();
  }

  /** Tells VS Code that the key changed, so the definition gets a new version. */
  notifyKeyChanged(): void {
    this.keyVersion++;
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }
}

/**
 * Registers the provider when this VS Code has the MCP API.
 * An editor without vscode.lm.registerMcpServerDefinitionProvider still gets every other feature.
 */
export function registerMcpServerProvider(
  context: vscode.ExtensionContext,
  secrets: SecretStore,
): ContrastMcpServerProvider | undefined {
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") {
    return undefined;
  }
  const provider = new ContrastMcpServerProvider(secrets);
  context.subscriptions.push(provider, vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider));
  return provider;
}

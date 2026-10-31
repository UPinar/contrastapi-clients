import * as vscode from "vscode";

const KEY_NAME = "contrastapi.apiKey";

/**
 * Keeps the API key in VS Code's SecretStorage.
 * The key never goes into settings, so it is not synced as plain text or committed with a workspace.
 */
export class SecretStore {
  private secrets: vscode.SecretStorage;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }

  async getApiKey(): Promise<string | undefined> {
    return this.secrets.get(KEY_NAME);
  }

  async setApiKey(key: string): Promise<void> {
    await this.secrets.store(KEY_NAME, key);
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(KEY_NAME);
  }

  /**
   * Calls listener when the stored key changes.
   * Another window can change the key too, so the client and the MCP provider follow this event.
   */
  onDidChangeApiKey(listener: () => void): vscode.Disposable {
    return this.secrets.onDidChange((e) => {
      if (e.key === KEY_NAME) {
        listener();
      }
    });
  }
}

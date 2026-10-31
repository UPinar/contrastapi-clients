import * as vscode from "vscode";

const KEY_NAME = "contrastapi.apiKey";

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
}

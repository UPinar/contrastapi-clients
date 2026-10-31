import * as vscode from "vscode";

/** DEFAULT_BASE_URL is the production server, used when the setting is unset. */
export const DEFAULT_BASE_URL = "https://api.contrastcyber.com";

/**
 * Reads contrastapi.baseUrl.
 * The setting has application scope, so a workspace's .vscode/settings.json cannot redirect the key.
 */
export function readBaseUrl(): string {
  return vscode.workspace.getConfiguration("contrastapi").get<string>("baseUrl", DEFAULT_BASE_URL);
}

/**
 * Reads contrastapi.mcp.register as it is written.
 * isRegistrationEnabled decides what the value means.
 */
export function readMcpRegisterSetting(): unknown {
  return vscode.workspace.getConfiguration("contrastapi").get<unknown>("mcp.register");
}

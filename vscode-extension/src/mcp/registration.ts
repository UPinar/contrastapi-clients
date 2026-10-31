import { isAllowedBaseUrl, isTrustedHost, normalizeBaseUrl } from "./client";

/**
 * Builds the headers VS Code sends to the registered MCP server.
 * The key goes only to a trusted host over an allowed scheme.
 * isTrustedHost alone accepts http://api.contrastcyber.com, so isAllowedBaseUrl is checked too.
 * An empty key gives no header, so the server answers as an anonymous caller.
 * The key goes as a Bearer token, because VS Code masks only the Authorization header in its MCP trace log.
 * The server reads the same key from Authorization and from X-API-Key.
 * The key is trimmed, because version 0.8.0 stored it untrimmed.
 * The server refuses a Bearer token that starts with a space.
 */
export function buildServerDefinitionHeaders(baseUrl: string, apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  if (key === "" || !isAllowedBaseUrl(baseUrl) || !isTrustedHost(baseUrl)) {
    return {};
  }
  return { Authorization: `Bearer ${key}` };
}

/**
 * Returns the MCP endpoint of a base URL, or undefined for a URL the client refuses.
 * The provider then offers no server, so VS Code never connects to a refused URL.
 */
export function mcpServerUrl(baseUrl: string): string | undefined {
  if (!isAllowedBaseUrl(baseUrl)) {
    return undefined;
  }
  return `${normalizeBaseUrl(baseUrl)}/mcp`;
}

/**
 * Reads the contrastapi.mcp.register setting.
 * Only the exact value "on" registers the server, so a mistyped value keeps the safe default.
 */
export function isRegistrationEnabled(value: unknown): boolean {
  return value === "on";
}

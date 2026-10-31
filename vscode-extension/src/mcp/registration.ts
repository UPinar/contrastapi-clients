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

/** KeyCheck is the answer of checkServerKey. */
export type KeyCheck = "accepted" | "refused" | "unreachable";

/** KEY_CHECK_TIMEOUT_MS bounds the key check, so a slow server cannot hold up VS Code's start for long. */
const KEY_CHECK_TIMEOUT_MS = 10_000;

/**
 * checkServerKey sends one initialize request with the headers VS Code would send.
 * The server charges no credit for initialize, with or without a key.
 * A 401 answer means the server refused the key.
 * VS Code reads a 401 as an OAuth challenge and opens a client registration dialog, so the caller does not start the server then.
 * Any other answer counts as accepted, so VS Code connects and reports the problem itself.
 * A network failure counts as unreachable for the same reason.
 */
export async function checkServerKey(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyCheck> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
      headers: { ...headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    return res.status === 401 ? "refused" : "accepted";
  } catch {
    return "unreachable";
  }
}

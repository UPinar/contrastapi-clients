import { RpcError, ToolError } from "../mcp/client";

/** ErrorNotice holds what the extension shows for a failed call. */
export interface ErrorNotice {
  message: string;
  offerSetApiKey: boolean;
}

/**
 * CLIENT_STARTING_MESSAGE is the reason a call fails before the first client is built.
 * The text carries no "ContrastAPI", because every place that shows it adds the name once.
 */
export const CLIENT_STARTING_MESSAGE = "The extension is still starting.";

function waitClause(prefix: string, retryAfter: number | undefined): string {
  return retryAfter !== undefined && retryAfter > 0 ? `${prefix} ${retryAfter} s` : "";
}

/**
 * Returns the fixed text of a known refusal, or undefined for any other failure.
 * A 401 offers Set API Key, because a new key is the only fix.
 * The server's 401 text is not shown, so nothing it echoes from the request reaches the screen.
 * A wait time appears only when the server sent one.
 */
function knownNotice(err: unknown): ErrorNotice | undefined {
  if (err instanceof ToolError) {
    return { message: err.message, offerSetApiKey: false };
  }
  if (err instanceof RpcError) {
    switch (err.status) {
      case 401:
        return { message: "API key rejected (invalid, revoked or expired)", offerSetApiKey: true };
      case 429:
        return { message: `Credit limit reached${waitClause(", retry in", err.retryAfter)}`, offerSetApiKey: false };
      case 503: {
        const wait = waitClause(" in", err.retryAfter);
        return { message: `Upstream busy, try again${wait === "" ? " later" : wait}`, offerSetApiKey: false };
      }
    }
  }
  return undefined;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Turns a failed call into the message the user sees on its own.
 * A known refusal keeps its fixed text.
 * Any other failure gets one "ContrastAPI error:" prefix.
 * The client's own texts carry no prefix, so the name appears once.
 */
export function describeError(err: unknown): ErrorNotice {
  return knownNotice(err) ?? { message: `ContrastAPI error: ${errorText(err)}`, offerSetApiKey: false };
}

/**
 * Returns the warning for a failed tool list refresh.
 * The reason is the failure's text without the "ContrastAPI error:" prefix.
 * The warning starts with "ContrastAPI:" itself, so the name appears once.
 */
export function toolListRefreshWarning(err: unknown): string {
  const reason = knownNotice(err)?.message ?? errorText(err);
  return `ContrastAPI: could not refresh the tool list (${reason}). The previous list stays in use.`;
}

/** Returns the warning shown when no client exists, such as for a refused base URL. */
export function toolListUnavailableWarning(clientError: string): string {
  return `ContrastAPI: cannot load the tool list. ${clientError}`;
}

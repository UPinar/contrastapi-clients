/** ToolShortcut describes one palette command that opens the form of a fixed tool. */
export interface ToolShortcut {
  command: string;
  toolName: string;
  title: string;
}

/**
 * TOOL_SHORTCUTS lists the palette commands that each open one fixed tool.
 * The tool list itself comes from the server, so a shortcut can point at a tool that is gone.
 * title is then used in the warning that missingToolMessage returns.
 */
export const TOOL_SHORTCUTS: readonly ToolShortcut[] = [
  { command: "contrastapi.cveLookup",    toolName: "cve_lookup",    title: "CVE Lookup" },
  { command: "contrastapi.ipLookup",     toolName: "ip_lookup",     title: "IP Lookup" },
  { command: "contrastapi.dnsLookup",    toolName: "dns_lookup",    title: "DNS Lookup" },
  { command: "contrastapi.sslCheck",     toolName: "ssl_check",     title: "SSL Check" },
  { command: "contrastapi.packageCheck", toolName: "package_check", title: "Package Check" },
];

/**
 * missingToolMessage returns the warning for a tool the current list lacks.
 * An empty list means it never loaded, so the warning asks for a refresh.
 * A loaded list without the tool means the server dropped it.
 */
export function missingToolMessage(title: string, listLoaded: boolean): string {
  if (!listLoaded) {
    return `${title} cannot open yet. The tool list has not loaded. Check your connection, then run ContrastAPI: Refresh Tool List.`;
  }
  return `${title} is no longer available on this server.`;
}

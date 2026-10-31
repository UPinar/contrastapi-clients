import { McpTool, toolCategory } from "../mcp/client";

/** OTHER_CATEGORY is the sidebar group for tools whose _meta names no category. */
export const OTHER_CATEGORY = "Other";

/**
 * CATEGORY_ORDER lists the server's tool categories in the order of its home page sections.
 * The server's docs/MCP_Documentation.md names the same closed set of categories.
 * The sidebar and the Run Tool list both show the categories in this order.
 */
export const CATEGORY_ORDER: readonly string[] = [
  "CVE Intelligence",
  "Package Vulnerabilities (SBOM)",
  "Credential Checks",
  "Domain Intelligence",
  "IP Intelligence",
  "Threat Defense",
  "Monitoring",
  "Operations",
];

/** ToolGroup is one sidebar group. It holds a category name and its tools. */
export interface ToolGroup {
  category: string;
  tools: McpTool[];
}

/**
 * Groups tools by their category for the sidebar and the Run Tool list.
 * Known categories come first, in CATEGORY_ORDER.
 * A category that CATEGORY_ORDER does not name comes next, in the order the server first lists it.
 * The Other group always comes last.
 * Tools keep the server's order inside a group, because the server lists related tools together.
 */
export function groupToolsByCategory(tools: readonly McpTool[]): ToolGroup[] {
  const byName = new Map<string, McpTool[]>();
  for (const tool of tools) {
    const category = toolCategory(tool) ?? OTHER_CATEGORY;
    const list = byName.get(category);
    if (list) {
      list.push(tool);
    } else {
      byName.set(category, [tool]);
    }
  }
  const known = CATEGORY_ORDER.filter((n) => byName.has(n));
  const unknown = [...byName.keys()].filter((n) => n !== OTHER_CATEGORY && !CATEGORY_ORDER.includes(n));
  const names = [...known, ...unknown];
  if (byName.has(OTHER_CATEGORY)) {
    names.push(OTHER_CATEGORY);
  }
  return names.map((category) => ({ category, tools: byName.get(category) ?? [] }));
}

/**
 * Returns the name a person sees for a tool.
 * The title is written for people. The name is the fallback when the title is missing or empty.
 */
export function toolLabel(tool: McpTool): string {
  return tool.title !== undefined && tool.title !== "" ? tool.title : tool.name;
}

/**
 * Returns the first sentence of a description for a one-line pick list detail.
 * A sentence ends at ".", "!" or "?" followed by white space or the end of the text.
 * A dot inside a token such as "1.2" therefore does not end it.
 */
export function firstSentence(text: string | undefined): string {
  const trimmed = (text ?? "").trim();
  const end = /[.!?](?=\s|$)/.exec(trimmed);
  return end ? trimmed.slice(0, end.index + 1) : trimmed;
}

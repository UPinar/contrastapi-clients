import type * as vscode from "vscode";
import { McpTool } from "../mcp/client";
import { firstSentence, groupToolsByCategory, toolLabel } from "./toolTree";

/** ToolPickItem is a QuickPick row. It carries its tool. */
export interface ToolPickItem extends vscode.QuickPickItem {
  tool: McpTool;
}

/**
 * Builds QuickPick rows for tools: title, category and the first sentence of the description.
 * One sentence keeps each row on one line while still telling similar tools apart.
 * The rows follow the sidebar's category order, so both lists show a tool in the same place.
 */
export function toolPickItems(tools: readonly McpTool[]): ToolPickItem[] {
  return groupToolsByCategory(tools).flatMap((group) =>
    group.tools.map((tool) => ({
      label: toolLabel(tool),
      description: group.category,
      detail: firstSentence(tool.description),
      tool,
    })),
  );
}

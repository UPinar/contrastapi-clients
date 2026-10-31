import * as vscode from "vscode";
import { McpTool } from "../mcp/client";
import { ToolSession } from "../session";
import { ToolGroup, groupToolsByCategory, toolLabel } from "./toolTree";

type SidebarNode = { kind: "group"; group: ToolGroup } | { kind: "tool"; tool: McpTool };

/**
 * Shows the server's tools grouped by category.
 * The tree follows the session's tool list, so a refresh redraws it without a reload.
 * A click runs the tool's form through the hidden contrastapi.runToolFromTree command.
 */
export class SidebarProvider implements vscode.TreeDataProvider<SidebarNode> {
  private readonly session: ToolSession;

  readonly onDidChangeTreeData: vscode.Event<void>;

  constructor(session: ToolSession) {
    this.session = session;
    this.onDidChangeTreeData = session.onDidChangeTools;
  }

  getTreeItem(node: SidebarNode): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.group.category, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `category:${node.group.category}`;
      item.iconPath = new vscode.ThemeIcon("folder");
      return item;
    }
    const item = new vscode.TreeItem(toolLabel(node.tool), vscode.TreeItemCollapsibleState.None);
    item.id = `tool:${node.tool.name}`;
    item.tooltip = node.tool.description ?? node.tool.name;
    item.iconPath = new vscode.ThemeIcon("tools");
    item.command = {
      command: "contrastapi.runToolFromTree",
      title: "Run Tool",
      arguments: [node.tool.name],
    };
    return item;
  }

  getChildren(node?: SidebarNode): SidebarNode[] {
    if (node) {
      return node.kind === "group" ? node.group.tools.map((tool) => ({ kind: "tool", tool })) : [];
    }
    return groupToolsByCategory(this.session.getTools()).map((group) => ({ kind: "group", group }));
  }
}

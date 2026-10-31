import * as vscode from "vscode";
import { renderResult, generateNonce } from "./resultHtml";

export class ResultPanel {
  private static instance?: ResultPanel;

  private panel: vscode.WebviewPanel;
  private extensionUri: vscode.Uri;

  static show(context: vscode.ExtensionContext, toolName: string, data: unknown): void {
    if (ResultPanel.instance) {
      ResultPanel.instance.update(toolName, data);
      ResultPanel.instance.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "contrastapi-result",
      toolName,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "resources", "webview"),
        ],
      },
    );

    ResultPanel.instance = new ResultPanel(panel, context.extensionUri);
    ResultPanel.instance.update(toolName, data);

    context.subscriptions.push(panel);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.onDidDispose(() => {
      ResultPanel.instance = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "copy") {
        await vscode.env.clipboard.writeText(msg.text);
        vscode.window.showInformationMessage("JSON copied to clipboard");
      }
    });
  }

  private update(toolName: string, data: unknown): void {
    this.panel.title = toolName;

    const cssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "webview", "result.css"),
    );
    const nonce = generateNonce();
    const cspSource = this.panel.webview.cspSource;

    this.panel.webview.html = renderResult(toolName, data, cssUri, nonce, cspSource);
  }
}

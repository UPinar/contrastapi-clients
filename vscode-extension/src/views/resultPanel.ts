import * as vscode from "vscode";
import { renderResult, generateNonce } from "./resultHtml";

/**
 * WatchOffer describes the Watch button a result panel offers for a watchable call.
 * add runs the watchlist_edit call and returns the button's new text.
 * add returns undefined when the item was not added.
 */
export interface WatchOffer {
  label: string;
  add: () => Promise<string | undefined>;
}

/**
 * Shows tool answers in one webview panel beside the editor.
 * A new answer replaces the old one, so results do not pile up in tabs.
 */
export class ResultPanel {
  private static instance?: ResultPanel;

  private panel: vscode.WebviewPanel;
  private extensionUri: vscode.Uri;
  private watch: WatchOffer | undefined;

  /**
   * Shows an answer, creating the panel on first use.
   * watch adds a Watch button.
   * An answer without watch, such as a watchlist event, shows no button.
   */
  static show(context: vscode.ExtensionContext, title: string, data: unknown, watch?: WatchOffer): void {
    if (ResultPanel.instance) {
      ResultPanel.instance.update(title, data, watch);
      ResultPanel.instance.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "contrastapi-result",
      title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "resources", "webview"),
        ],
      },
    );

    ResultPanel.instance = new ResultPanel(panel, context.extensionUri);
    ResultPanel.instance.update(title, data, watch);

    context.subscriptions.push(panel);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.onDidDispose(() => {
      ResultPanel.instance = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.command === "copy") {
        await vscode.env.clipboard.writeText(msg.text);
        vscode.window.showInformationMessage("JSON copied to clipboard");
      } else if (msg?.type === "watch") {
        await this.addWatch();
      }
    });
  }

  private async addWatch(): Promise<void> {
    const watch = this.watch;
    if (!watch) {
      return;
    }
    const label = await watch.add();
    if (watch !== this.watch) {
      return;
    }
    await this.panel.webview.postMessage(label !== undefined ? { type: "watched", label } : { type: "watchFailed" });
  }

  private update(title: string, data: unknown, watch: WatchOffer | undefined): void {
    this.panel.title = title;
    this.watch = watch;

    const cssUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "resources", "webview", "result.css"),
    );
    const nonce = generateNonce();
    const cspSource = this.panel.webview.cspSource;

    this.panel.webview.html = renderResult(title, data, cssUri.toString(), nonce, cspSource, watch?.label);
  }
}

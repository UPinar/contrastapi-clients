import * as vscode from "vscode";
import type { RateLimitInfo } from "../mcp/client";
import { RateTracker, creditLabel } from "./rateLimit";

/**
 * Shows the credits left in the status bar.
 * The numbers come from the X-RateLimit-* headers of the last MCP call.
 */
export class StatusBar {
  private item: vscode.StatusBarItem;
  private tracker: RateTracker;

  constructor(tracker: RateTracker) {
    this.tracker = tracker;
    this.tracker.setOnChange(() => this.update());
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "contrastapi.setApiKey";
    this.update();
    this.item.show();
  }

  /** Stores the credit state of one response and redraws the item. */
  updateFromServer(info: RateLimitInfo): void {
    this.tracker.updateFromServer(info, Date.now());
    this.update();
  }

  private update(): void {
    const remaining = this.tracker.getRemaining();
    const limit = this.tracker.getLimit();
    const label = creditLabel(remaining, limit);
    this.item.text = label.text;
    this.item.tooltip = label.tooltip;

    if (remaining === undefined || limit === undefined) {
      this.item.backgroundColor = undefined;
    } else if (remaining <= 0) {
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (remaining <= Math.floor(limit * 0.2)) {
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.item.backgroundColor = undefined;
    }
  }

  dispose(): void {
    this.tracker.dispose();
    this.item.dispose();
  }
}

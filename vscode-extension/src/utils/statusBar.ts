import * as vscode from "vscode";
import { RateTracker } from "./rateLimit";

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

  updateFromServer(remaining: number, limit: number, resetSeconds: number): void {
    this.tracker.updateFromServer(remaining, limit, resetSeconds);
    this.update();
  }

  private update(): void {
    const remaining = this.tracker.getRemaining();
    const limit = this.tracker.getLimit();
    this.item.text = `$(shield) ContrastAPI: ${remaining}/${limit}`;
    this.item.tooltip = `${remaining} requests remaining this hour. Click to set API key for higher limits.`;

    if (remaining <= 0) {
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

import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

async function runAndShow(
  context: vscode.ExtensionContext,
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `ContrastAPI: Running ${label}...`,
      },
      async () => {
        const data = await fn();
        ResultPanel.show(context, label, data);
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
  }
}

export function registerSigmaCommands(
  context: vscode.ExtensionContext,
  client: ContrastClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.sigmaRuleLookup", async () => {
      const ruleId = await vscode.window.showInputBox({
        prompt: "Enter Sigma rule UUID (e.g. 5013636e-7f4c-4c1c-8c01-fc2b29baf71a)",
        ignoreFocusOut: true,
      });
      if (!ruleId) return;
      await runAndShow(context, "Sigma Rule Lookup", () => client.sigmaRuleLookup(ruleId));
    }),

    vscode.commands.registerCommand("contrastapi.bulkSigmaRuleLookup", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Enter Sigma rule UUIDs separated by comma or newline (max 50 per bulk request)",
        ignoreFocusOut: true,
      });
      if (!input) return;

      const ruleIds = input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 100);

      if (ruleIds.length === 0) {
        vscode.window.showWarningMessage("ContrastAPI: No valid rule IDs provided");
        return;
      }
      // Server caps rule_ids at 50 (BulkSigmaRuleLookupRequest). Client cap prevents obvious misuse.
      if (ruleIds.length > 50) {
        vscode.window.showWarningMessage("ContrastAPI: Max 50 rule IDs per bulk request");
        return;
      }

      await runAndShow(context, "Bulk Sigma Rule Lookup", () =>
        client.bulkSigmaRuleLookup(ruleIds),
      );
    }),
  );
}

import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

const D3FEND_TACTICS = [
  "any",
  "model",
  "harden",
  "detect",
  "isolate",
  "deceive",
  "evict",
  "restore",
];

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

export function registerD3fendCommands(
  context: vscode.ExtensionContext,
  client: ContrastClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.d3fendDefenseLookup", async () => {
      const id = await vscode.window.showInputBox({
        prompt: "Enter D3FEND defense ID (e.g. D3-NTA, D3-MFA)",
        ignoreFocusOut: true,
      });
      if (!id) return;
      await runAndShow(context, "D3FEND Defense Lookup", () => client.d3fendDefenseLookup(id));
    }),

    vscode.commands.registerCommand("contrastapi.d3fendDefenseSearch", async () => {
      const tactic = await vscode.window.showQuickPick(D3FEND_TACTICS, {
        placeHolder: "Filter by D3FEND tactic (or 'any')",
      });
      if (!tactic) return;

      const keyword = await vscode.window.showInputBox({
        prompt: "Keyword filter (optional, press Enter to skip)",
        ignoreFocusOut: true,
      });

      const params: { tactic?: string; keyword?: string; limit: number } = { limit: 50 };
      if (tactic && tactic !== "any") params.tactic = tactic;
      if (keyword) params.keyword = keyword;

      await runAndShow(context, "D3FEND Defense Search", () => client.d3fendDefenseSearch(params));
    }),

    vscode.commands.registerCommand("contrastapi.d3fendDefenseForAttack", async () => {
      const id = await vscode.window.showInputBox({
        prompt: "Enter ATT&CK technique ID (e.g. T1566, T1059.001)",
        ignoreFocusOut: true,
      });
      if (!id) return;
      await runAndShow(context, "D3FEND Defenses For ATT&CK", () => client.d3fendDefenseForAttack(id));
    }),

    vscode.commands.registerCommand("contrastapi.d3fendAttackCoverage", async () => {
      await runAndShow(context, "D3FEND Coverage Map", () => client.d3fendAttackCoverage());
    }),
  );
}

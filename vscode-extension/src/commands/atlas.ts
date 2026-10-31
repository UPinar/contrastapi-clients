import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

const ATLAS_TACTICS = [
  "any",
  "reconnaissance",
  "resource-development",
  "initial-access",
  "ml-model-access",
  "execution",
  "persistence",
  "privilege-escalation",
  "defense-evasion",
  "credential-access",
  "discovery",
  "collection",
  "ml-attack-staging",
  "exfiltration",
  "impact",
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

export function registerAtlasCommands(
  context: vscode.ExtensionContext,
  client: ContrastClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.atlasTechniqueLookup", async () => {
      const id = await vscode.window.showInputBox({
        prompt: "Enter ATLAS technique ID (e.g. AML.T0043)",
        ignoreFocusOut: true,
      });
      if (!id) return;
      await runAndShow(context, "ATLAS Technique Lookup", () => client.atlasTechniqueLookup(id));
    }),

    vscode.commands.registerCommand("contrastapi.atlasTechniqueSearch", async () => {
      const tactic = await vscode.window.showQuickPick(ATLAS_TACTICS, {
        placeHolder: "Filter by tactic (or 'any')",
      });
      if (!tactic) return;

      const q = await vscode.window.showInputBox({
        prompt: "Keyword filter (optional, press Enter to skip)",
        ignoreFocusOut: true,
      });

      const params: { tactic?: string; keyword?: string; limit: number } = { limit: 50 };
      if (tactic && tactic !== "any") params.tactic = tactic;
      if (q) params.keyword = q;

      await runAndShow(context, "ATLAS Technique Search", () => client.atlasTechniqueSearch(params));
    }),

    vscode.commands.registerCommand("contrastapi.bulkAtlasTechniqueLookup", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Enter ATLAS technique IDs separated by comma or newline (e.g. AML.T0043, AML.T0051)",
        ignoreFocusOut: true,
      });
      if (!input) return;

      const ids = input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 100);

      if (ids.length === 0) {
        vscode.window.showWarningMessage("ContrastAPI: No valid technique IDs provided");
        return;
      }
      if (ids.length > 50) {
        vscode.window.showWarningMessage("ContrastAPI: Max 50 technique IDs per bulk request (Pro tier)");
        return;
      }

      await runAndShow(context, `Bulk ATLAS Lookup (${ids.length})`, () =>
        client.bulkAtlasTechniqueLookup(ids),
      );
    }),

    vscode.commands.registerCommand("contrastapi.atlasCaseStudyLookup", async () => {
      const id = await vscode.window.showInputBox({
        prompt: "Enter ATLAS case study ID (e.g. AML.CS0000)",
        ignoreFocusOut: true,
      });
      if (!id) return;
      await runAndShow(context, "ATLAS Case Study Lookup", () => client.atlasCaseStudyLookup(id));
    }),

    vscode.commands.registerCommand("contrastapi.atlasCaseStudySearch", async () => {
      const q = await vscode.window.showInputBox({
        prompt: "Keyword filter (optional, press Enter to skip)",
        ignoreFocusOut: true,
      });
      const params: { keyword?: string; limit: number } = { limit: 50 };
      if (q) params.keyword = q;
      await runAndShow(context, "ATLAS Case Study Search", () => client.atlasCaseStudySearch(params));
    }),
  );
}

import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

export function registerCveCommands(
  context: vscode.ExtensionContext,
  client: ContrastClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.cveLookup", async () => {
      const cveId = await vscode.window.showInputBox({
        prompt: "Enter CVE ID (e.g. CVE-2024-3094)",
        ignoreFocusOut: true,
      });
      if (!cveId) return;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Running CVE Lookup...",
          },
          async () => {
            const data = await client.cveLookup(cveId);
            ResultPanel.show(context, "CVE Lookup", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("contrastapi.kevDetail", async () => {
      const cveId = await vscode.window.showInputBox({
        prompt: "Enter CVE ID in CISA KEV catalog (e.g. CVE-2021-44228)",
        ignoreFocusOut: true,
      });
      if (!cveId) return;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Running KEV Detail...",
          },
          async () => {
            const data = await client.kevDetail(cveId);
            ResultPanel.show(context, "KEV Detail", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("contrastapi.cweLookup", async () => {
      const cweId = await vscode.window.showInputBox({
        prompt: "Enter CWE ID (e.g. CWE-79, CWE-89, or just 79)",
        ignoreFocusOut: true,
      });
      if (!cweId) return;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Running CWE Lookup...",
          },
          async () => {
            const data = await client.cweLookup(cweId);
            ResultPanel.show(context, "CWE Lookup", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("contrastapi.exploitLookup", async () => {
      const cveId = await vscode.window.showInputBox({
        prompt: "Enter CVE ID (e.g. CVE-2024-3094)",
        ignoreFocusOut: true,
      });
      if (!cveId) return;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Running Exploit Lookup...",
          },
          async () => {
            const data = await client.exploitLookup(cveId);
            ResultPanel.show(context, "Exploit Lookup", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),

    // v1.29.1: composite risk score (CVSS+EPSS+KEV+PoC fusion)
    vscode.commands.registerCommand("contrastapi.calculateRiskScore", async () => {
      const cveId = await vscode.window.showInputBox({
        prompt: "Enter CVE ID for composite risk score (e.g. CVE-2021-44228)",
        ignoreFocusOut: true,
      });
      if (!cveId) return;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Calculating risk score...",
          },
          async () => {
            const data = await client.calculateRiskScore(cveId);
            ResultPanel.show(context, "CVE Risk Score", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),

    // v1.29.1: CVSS v3.x vector parser
    vscode.commands.registerCommand("contrastapi.getCvssDetails", async () => {
      const vector = await vscode.window.showInputBox({
        prompt: "Paste a CVSS v3.0 or v3.1 vector",
        placeHolder: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        ignoreFocusOut: true,
      });
      if (!vector) return;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Parsing CVSS vector...",
          },
          async () => {
            const data = await client.getCvssDetails(vector);
            ResultPanel.show(context, "CVSS Details", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("contrastapi.cveSearch", async () => {
      const product = await vscode.window.showInputBox({
        prompt: "Product name (e.g. apache)",
        ignoreFocusOut: true,
      });
      if (!product) return;

      const severity = await vscode.window.showQuickPick(
        ["all", "critical", "high", "medium", "low"],
        { placeHolder: "Severity filter" },
      );
      if (!severity) return;

      const daysStr = await vscode.window.showInputBox({
        prompt: "Days to search (default: 30)",
        ignoreFocusOut: true,
      });

      let days: number | undefined;
      if (daysStr) {
        days = parseInt(daysStr, 10);
        if (isNaN(days) || days < 1) {
          vscode.window.showWarningMessage("ContrastAPI: Days must be a positive number");
          return;
        }
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Running CVE Search...",
          },
          async () => {
            const data = await client.cveSearch({
              product,
              severity: severity !== "all" ? severity : undefined,
              days,
              limit: 20,
            });
            ResultPanel.show(context, "CVE Search", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("contrastapi.cveLeading", async () => {
      const limitStr = await vscode.window.showInputBox({
        prompt: "How many leading CVEs? (default: 20, max: 200)",
        ignoreFocusOut: true,
      });

      let limit: number | undefined;
      if (limitStr) {
        limit = parseInt(limitStr, 10);
        if (isNaN(limit) || limit < 1 || limit > 200) {
          vscode.window.showWarningMessage("ContrastAPI: Limit must be 1-200");
          return;
        }
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Fetching leading CVEs...",
          },
          async () => {
            const data = await client.cveLeading(limit ?? 20);
            ResultPanel.show(context, "Leading CVEs", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("contrastapi.bulkCveLookup", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Enter CVE IDs separated by comma or newline (e.g. CVE-2024-3094, CVE-2021-44228)",
        ignoreFocusOut: true,
      });
      if (!input) return;

      const cveIds = input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 100);

      if (cveIds.length === 0) {
        vscode.window.showWarningMessage("ContrastAPI: No valid CVE IDs provided");
        return;
      }
      // Server enforces per-tier: free=10, pro=50. Client cap prevents obvious misuse.
      if (cveIds.length > 50) {
        vscode.window.showWarningMessage("ContrastAPI: Max 50 CVE IDs per bulk request (Pro tier limit)");
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `ContrastAPI: Running Bulk CVE Lookup (${cveIds.length} items)...`,
          },
          async () => {
            const data = await client.bulkCveLookup(cveIds);
            ResultPanel.show(context, "Bulk CVE Lookup", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),
  );
}

import * as vscode from "vscode";
import * as crypto from "crypto";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

interface IocTool {
  id: string;
  label: string;
  method: keyof ContrastClient;
  prompt: string;
}

const tools: IocTool[] = [
  { id: "iocLookup", label: "IOC Lookup", method: "iocLookup", prompt: "Enter indicator (IP, domain, hash, or URL)" },
  { id: "hashLookup", label: "Hash Lookup", method: "hashLookup", prompt: "Enter file hash (MD5, SHA-1, or SHA-256)" },
  { id: "phishingCheck", label: "Phishing Check", method: "phishingCheck", prompt: "Enter URL to check (e.g. https://suspicious-site.com)" },
];

export function registerIocCommands(
  context: vscode.ExtensionContext,
  client: ContrastClient,
): void {
  // Table-driven commands
  for (const tool of tools) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`contrastapi.${tool.id}`, async () => {
        const input = await vscode.window.showInputBox({
          prompt: tool.prompt,
          ignoreFocusOut: true,
        });
        if (!input) return;

        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `ContrastAPI: Running ${tool.label}...`,
            },
            async () => {
              const fn = client[tool.method] as (arg: string) => Promise<unknown>;
              const data = await fn.call(client, input);
              ResultPanel.show(context, tool.label, data);
            },
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
        }
      }),
    );
  }

  // passwordCheck — special: SHA-1 hash before sending
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.passwordCheck", async () => {
      const password = await vscode.window.showInputBox({
        prompt: "Enter password to check against breach database",
        password: true,
        ignoreFocusOut: true,
      });
      if (!password) return;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Running Password Check...",
          },
          async () => {
            const sha1 = crypto.createHash("sha1").update(password).digest("hex");
            const data = await client.passwordCheck(sha1);
            ResultPanel.show(context, "Password Check", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.bulkIocLookup", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Enter indicators (IPs, domains, hashes, URLs) separated by comma or newline",
        ignoreFocusOut: true,
      });
      if (!input) return;

      const indicators = input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 2048);

      if (indicators.length === 0) {
        vscode.window.showWarningMessage("ContrastAPI: No valid indicators provided");
        return;
      }
      // Server enforces per-tier: free=10, pro=50. Client cap prevents obvious misuse.
      if (indicators.length > 50) {
        vscode.window.showWarningMessage("ContrastAPI: Max 50 indicators per bulk request (Pro tier limit)");
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `ContrastAPI: Running Bulk IOC Lookup (${indicators.length} items)...`,
          },
          async () => {
            const data = await client.bulkIocLookup(indicators);
            ResultPanel.show(context, "Bulk IOC Lookup", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),
  );
}

import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

interface IpTool {
  id: string;
  label: string;
  method: keyof ContrastClient;
  prompt: string;
}

const tools: IpTool[] = [
  { id: "ipLookup", label: "IP Lookup", method: "ipLookup", prompt: "Enter IP address (e.g. 8.8.8.8)" },
  { id: "asnLookup", label: "ASN Lookup", method: "asnLookup", prompt: "Enter IP or ASN (e.g. 8.8.8.8 or AS15169)" },
  { id: "threatReport", label: "IP Threat Report", method: "threatReport", prompt: "Enter IP address for threat report (e.g. 8.8.8.8)" },
];

export function registerIpCommands(
  context: vscode.ExtensionContext,
  client: ContrastClient,
): void {
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
}

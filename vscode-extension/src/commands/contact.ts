import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

interface ContactTool {
  id: string;
  label: string;
  method: keyof ContrastClient;
  prompt: string;
}

const tools: ContactTool[] = [
  { id: "emailDisposable", label: "Email Disposable Check", method: "emailDisposable", prompt: "Enter email address (e.g. user@example.com)" },
  { id: "phoneLookup", label: "Phone Lookup", method: "phoneLookup", prompt: "Enter phone number (e.g. +14155552671)" },
  { id: "usernameLookup", label: "Username Lookup", method: "usernameLookup", prompt: "Enter username (e.g. johndoe)" },
];

export function registerContactCommands(
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

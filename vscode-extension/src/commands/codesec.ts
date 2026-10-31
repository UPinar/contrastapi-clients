import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

const MAX_CODE_SIZE = 100000; // 100KB

function getEditorCode(): { code: string; language: string } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const selection = editor.selection;
  const code = selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(selection);

  if (!code.trim()) return undefined;

  if (code.length > MAX_CODE_SIZE) {
    vscode.window.showWarningMessage(
      `ContrastAPI: Content is ${Math.round(code.length / 1024)}KB. Select a smaller portion (max ~100KB).`
    );
    return undefined;
  }

  return { code, language: editor.document.languageId };
}

function parsePackages(raw: string): Array<{ name: string; version?: string }> {
  const out: Array<{ name: string; version?: string }> = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Supports: name==version, name@version, name version, name
    const m = trimmed.match(/^([a-zA-Z0-9_.\-@\/]+?)(?:\s*(?:==|@|\s+)\s*(.+))?$/);
    if (!m) continue;
    const name = m[1].trim();
    const version = m[2]?.trim();
    if (name) out.push(version ? { name, version } : { name });
  }
  return out;
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) headers[key] = value;
    }
  }
  return headers;
}

export function registerCodesecCommands(
  context: vscode.ExtensionContext,
  client: ContrastClient,
): void {
  // checkSecrets — uses editor selection/content
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.checkSecrets", async () => {
      const source = getEditorCode();
      if (!source) {
        vscode.window.showWarningMessage("ContrastAPI: Open a file or select code first");
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Checking for secrets...",
          },
          async () => {
            const data = await client.checkSecrets(source.code, source.language);
            ResultPanel.show(context, "Check Secrets", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),
  );

  // checkInjection — uses editor selection/content
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.checkInjection", async () => {
      const source = getEditorCode();
      if (!source) {
        vscode.window.showWarningMessage("ContrastAPI: Open a file or select code first");
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Checking for injection vulnerabilities...",
          },
          async () => {
            const data = await client.checkInjection(source.code, source.language);
            ResultPanel.show(context, "Check Injection", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),
  );

  // checkDependencies — reads from editor selection (requirements.txt / package.json deps / plain list)
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.checkDependencies", async () => {
      const source = getEditorCode();
      if (!source) {
        vscode.window.showWarningMessage("ContrastAPI: Select or open a file with package list (e.g. 'django==5.0' per line)");
        return;
      }

      const packages = parsePackages(source.code);
      if (packages.length === 0) {
        vscode.window.showWarningMessage("ContrastAPI: No valid packages found. Expected 'name==version' format, one per line.");
        return;
      }
      if (packages.length > 50) {
        vscode.window.showWarningMessage("ContrastAPI: Max 50 packages per request (Pro tier limit)");
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `ContrastAPI: Checking ${packages.length} dependencies...`,
          },
          async () => {
            const data = await client.checkDependencies(packages);
            ResultPanel.show(context, "Check Dependencies", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),
  );

  // checkHeaders — reads from editor selection (expects raw HTTP headers)
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.checkHeaders", async () => {
      const source = getEditorCode();
      if (!source) {
        vscode.window.showWarningMessage("ContrastAPI: Select or open a file with HTTP headers (Key: Value format, one per line)");
        return;
      }

      const headers = parseHeaders(source.code);
      if (Object.keys(headers).length === 0) {
        vscode.window.showWarningMessage("ContrastAPI: No valid headers found. Expected 'Key: Value' format, one per line.");
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "ContrastAPI: Checking headers...",
          },
          async () => {
            const data = await client.checkHeaders(headers);
            ResultPanel.show(context, "Check Headers", data);
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContrastAPI: ${msg}`);
      }
    }),
  );
}

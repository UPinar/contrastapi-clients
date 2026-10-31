import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";
import { detectIndicator, IndicatorType } from "./detectors";

interface ContextRoute {
  label: string;
  run: (selection: string, client: ContrastClient, context: vscode.ExtensionContext) => Promise<void>;
}

async function runAndShow(
  client: ContrastClient,
  context: vscode.ExtensionContext,
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `ContrastAPI: Running ${label}...` },
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

const ROUTES: Record<IndicatorType, ContextRoute | undefined> = {
  cve:               { label: "CVE Lookup",                  run: (s, c, ctx) => runAndShow(c, ctx, "CVE Lookup",                  () => c.cveLookup(s)) },
  cwe:               { label: "CWE Lookup",                  run: (s, c, ctx) => runAndShow(c, ctx, "CWE Lookup",                  () => c.cweLookup(s)) },
  atlas:             { label: "ATLAS Technique Lookup",      run: (s, c, ctx) => runAndShow(c, ctx, "ATLAS Technique Lookup",      () => c.atlasTechniqueLookup(s)) },
  atlas_case_study:  { label: "ATLAS Case Study Lookup",     run: (s, c, ctx) => runAndShow(c, ctx, "ATLAS Case Study Lookup",     () => c.atlasCaseStudyLookup(s)) },
  d3fend:            { label: "D3FEND Defense Lookup",       run: (s, c, ctx) => runAndShow(c, ctx, "D3FEND Defense Lookup",       () => c.d3fendDefenseLookup(s)) },
  attack_technique:  { label: "D3FEND Defenses For ATT&CK",  run: (s, c, ctx) => runAndShow(c, ctx, "D3FEND Defenses For ATT&CK",  () => c.d3fendDefenseForAttack(s)) },
  ip:                { label: "IP Lookup",                   run: (s, c, ctx) => runAndShow(c, ctx, "IP Lookup",                   () => c.ipLookup(s)) },
  domain:            { label: "Domain Report",               run: (s, c, ctx) => runAndShow(c, ctx, "Domain Report",               () => c.domainReport(s)) },
  url:               { label: "Phishing Check",              run: (s, c, ctx) => runAndShow(c, ctx, "Phishing Check",              () => c.phishingCheck(s)) },
  email:             { label: "Email Check",                 run: (s, c, ctx) => runAndShow(c, ctx, "Email Check",                 () => c.emailDisposable(s)) },
  hash_md5:          { label: "Hash Lookup",                 run: (s, c, ctx) => runAndShow(c, ctx, "Hash Lookup",                 () => c.hashLookup(s)) },
  hash_sha1:         { label: "Hash Lookup",                 run: (s, c, ctx) => runAndShow(c, ctx, "Hash Lookup",                 () => c.hashLookup(s)) },
  hash_sha256:       { label: "Hash Lookup",                 run: (s, c, ctx) => runAndShow(c, ctx, "Hash Lookup",                 () => c.hashLookup(s)) },
  unknown:           undefined,
};

const FALLBACK_CHOICES: { label: string; run: (s: string, c: ContrastClient, ctx: vscode.ExtensionContext) => Promise<void> }[] = [
  { label: "Domain Report",         run: (s, c, ctx) => runAndShow(c, ctx, "Domain Report",         () => c.domainReport(s)) },
  { label: "IP Lookup",             run: (s, c, ctx) => runAndShow(c, ctx, "IP Lookup",             () => c.ipLookup(s)) },
  { label: "CVE Lookup",            run: (s, c, ctx) => runAndShow(c, ctx, "CVE Lookup",            () => c.cveLookup(s)) },
  { label: "KEV Detail",            run: (s, c, ctx) => runAndShow(c, ctx, "KEV Detail",            () => c.kevDetail(s)) },
  { label: "CWE Lookup",            run: (s, c, ctx) => runAndShow(c, ctx, "CWE Lookup",            () => c.cweLookup(s)) },
  { label: "ATLAS Technique",       run: (s, c, ctx) => runAndShow(c, ctx, "ATLAS Technique Lookup", () => c.atlasTechniqueLookup(s)) },
  { label: "D3FEND Defense",        run: (s, c, ctx) => runAndShow(c, ctx, "D3FEND Defense Lookup", () => c.d3fendDefenseLookup(s)) },
  { label: "Hash Lookup",           run: (s, c, ctx) => runAndShow(c, ctx, "Hash Lookup",           () => c.hashLookup(s)) },
  { label: "IOC Lookup",            run: (s, c, ctx) => runAndShow(c, ctx, "IOC Lookup",            () => c.iocLookup(s)) },
  { label: "Phishing Check",        run: (s, c, ctx) => runAndShow(c, ctx, "Phishing Check",        () => c.phishingCheck(s)) },
  { label: "Username Lookup",       run: (s, c, ctx) => runAndShow(c, ctx, "Username Lookup",       () => c.usernameLookup(s)) },
];

export function registerContextMenu(
  context: vscode.ExtensionContext,
  client: ContrastClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("contrastapi.lookupSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.document.getText(editor.selection).trim();
      if (!selection) {
        vscode.window.showWarningMessage("ContrastAPI: Select text first");
        return;
      }

      const type = detectIndicator(selection);

      if (type !== "unknown") {
        const route = ROUTES[type];
        if (route) {
          await route.run(selection, client, context);
        }
        return;
      }

      // Can't auto-detect — let user pick
      const choice = await vscode.window.showQuickPick(
        FALLBACK_CHOICES.map((c) => c.label),
        { placeHolder: `Lookup "${selection.slice(0, 40)}" as...` },
      );
      if (!choice) return;

      const picked = FALLBACK_CHOICES.find((c) => c.label === choice);
      if (picked) {
        await picked.run(selection, client, context);
      }
    }),
  );
}

import * as vscode from "vscode";
import { ContrastClient } from "../api/client";
import { ResultPanel } from "../views/resultPanel";

interface DomainTool {
  id: string;
  label: string;
  method: keyof ContrastClient;
  prompt: string;
}

const tools: DomainTool[] = [
  { id: "domainReport", label: "Domain Report", method: "domainReport", prompt: "Enter domain (e.g. example.com)" },
  { id: "dnsLookup", label: "DNS Lookup", method: "dnsLookup", prompt: "Enter domain (e.g. example.com)" },
  { id: "whoisLookup", label: "WHOIS Lookup", method: "whoisLookup", prompt: "Enter domain (e.g. example.com)" },
  { id: "sslCheck", label: "SSL Check", method: "sslCheck", prompt: "Enter domain (e.g. example.com)" },
  { id: "subdomainEnum", label: "Subdomain Enumeration", method: "subdomainEnum", prompt: "Enter domain (e.g. example.com)" },
  { id: "techFingerprint", label: "Technology Fingerprint", method: "techFingerprint", prompt: "Enter domain (e.g. example.com)" },
  { id: "threatIntel", label: "Threat Intelligence", method: "threatIntel", prompt: "Enter domain (e.g. example.com)" },
  { id: "waybackLookup", label: "Wayback Lookup", method: "waybackLookup", prompt: "Enter domain (e.g. example.com)" },
  { id: "scanHeaders", label: "Scan Headers", method: "scanHeaders", prompt: "Enter domain (e.g. example.com)" },
  { id: "contrastScan", label: "Contrast Scan", method: "contrastScan", prompt: "Enter domain for full-site security scan (e.g. example.com)" },
  { id: "emailMx", label: "Email MX Analysis", method: "emailMx", prompt: "Enter domain (e.g. example.com)" },
  { id: "auditDomain", label: "Domain Audit", method: "auditDomain", prompt: "Enter domain for full audit (e.g. example.com)" },
  { id: "certSearch", label: "Certificate Transparency Search", method: "certSearch", prompt: "Enter domain (e.g. example.com)" },
  { id: "emailSecurityPosture", label: "Email Security Posture", method: "emailSecurityPosture", prompt: "Enter domain (e.g. example.com)" },
  { id: "robotsTxt", label: "robots.txt Parser", method: "robotsTxt", prompt: "Enter domain (e.g. example.com)" },
  { id: "redirectChain", label: "Redirect Chain Walker", method: "redirectChain", prompt: "Enter URL (e.g. https://bit.ly/abc)" },
  { id: "brandAssets", label: "Brand Assets", method: "brandAssets", prompt: "Enter domain (e.g. example.com)" },
  { id: "seoAudit", label: "SEO Audit", method: "seoAudit", prompt: "Enter domain (e.g. example.com)" },
  { id: "emailVerify", label: "Email Verify", method: "emailVerify", prompt: "Enter email address (e.g. user@example.com)" },
];

export function registerDomainCommands(
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

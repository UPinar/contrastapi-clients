import * as vscode from "vscode";

class SidebarItem extends vscode.TreeItem {
  children?: SidebarItem[];

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    children?: SidebarItem[],
    command?: vscode.Command,
    icon?: string,
  ) {
    super(label, collapsibleState);
    this.children = children;
    this.command = command;
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

function tool(label: string, commandId: string): SidebarItem {
  return new SidebarItem(label, vscode.TreeItemCollapsibleState.None, undefined, {
    command: `contrastapi.${commandId}`,
    title: label,
  });
}

function category(label: string, icon: string, children: SidebarItem[]): SidebarItem {
  return new SidebarItem(label, vscode.TreeItemCollapsibleState.Expanded, children, undefined, icon);
}

export class SidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarItem): SidebarItem[] {
    if (element) {
      return element.children ?? [];
    }

    return [
      category("Domain Intelligence", "shield", [
        tool("Domain Report", "domainReport"),
        tool("DNS Lookup", "dnsLookup"),
        tool("WHOIS Lookup", "whoisLookup"),
        tool("SSL Check", "sslCheck"),
        tool("Subdomain Enumeration", "subdomainEnum"),
        tool("Technology Fingerprint", "techFingerprint"),
        tool("Threat Intelligence", "threatIntel"),
        tool("Wayback Lookup", "waybackLookup"),
        tool("Scan Headers", "scanHeaders"),
        tool("Contrast Scan", "contrastScan"),
        tool("Email MX Analysis", "emailMx"),
        tool("Domain Audit", "auditDomain"),
        tool("Certificate Transparency Search", "certSearch"),
        tool("Email Security Posture", "emailSecurityPosture"),
      ]),
      category("Web Intelligence", "globe", [
        tool("robots.txt Parser", "robotsTxt"),
        tool("Redirect Chain Walker", "redirectChain"),
        tool("Brand Assets", "brandAssets"),
        tool("SEO Audit", "seoAudit"),
      ]),
      category("Contact Validation", "person", [
        tool("Email Disposable Check", "emailDisposable"),
        tool("Email Verify", "emailVerify"),
        tool("Phone Lookup", "phoneLookup"),
        tool("Username Lookup", "usernameLookup"),
      ]),
      category("IP Intelligence", "globe", [
        tool("IP Lookup", "ipLookup"),
        tool("ASN Lookup", "asnLookup"),
        tool("IP Threat Report", "threatReport"),
      ]),
      category("CVE Intelligence", "bug", [
        tool("CVE Lookup", "cveLookup"),
        tool("CVE Search", "cveSearch"),
        tool("Leading CVEs", "cveLeading"),
        tool("Exploit Lookup", "exploitLookup"),
        tool("Calculate Risk Score", "calculateRiskScore"),
        tool("CVSS Vector Details", "getCvssDetails"),
        tool("Bulk CVE Lookup", "bulkCveLookup"),
        tool("KEV Detail", "kevDetail"),
        tool("CWE Lookup", "cweLookup"),
      ]),
      category("Threat Intel / IOC", "warning", [
        tool("IOC Lookup", "iocLookup"),
        tool("Hash Lookup", "hashLookup"),
        tool("Password Breach Check", "passwordCheck"),
        tool("Phishing URL Check", "phishingCheck"),
        tool("Bulk IOC Lookup", "bulkIocLookup"),
      ]),
      category("Code Security", "lock", [
        tool("Check Secrets in Code", "checkSecrets"),
        tool("Check Injection in Code", "checkInjection"),
        tool("Check HTTP Headers", "checkHeaders"),
        tool("Check Dependencies", "checkDependencies"),
      ]),
      category("MITRE ATLAS (AI/ML Threats)", "robot", [
        tool("Technique Lookup", "atlasTechniqueLookup"),
        tool("Technique Search", "atlasTechniqueSearch"),
        tool("Bulk Technique Lookup", "bulkAtlasTechniqueLookup"),
        tool("Case Study Lookup", "atlasCaseStudyLookup"),
        tool("Case Study Search", "atlasCaseStudySearch"),
      ]),
      category("MITRE D3FEND (Defenses)", "shield", [
        tool("Defense Lookup", "d3fendDefenseLookup"),
        tool("Defense Search", "d3fendDefenseSearch"),
        tool("Defenses For ATT&CK", "d3fendDefenseForAttack"),
        tool("Coverage Map", "d3fendAttackCoverage"),
      ]),
      category("Sigma Detection Rules", "list-filter", [
        tool("Sigma Rule Lookup", "sigmaRuleLookup"),
        tool("Bulk Sigma Rule Lookup", "bulkSigmaRuleLookup"),
      ]),
    ];
  }
}

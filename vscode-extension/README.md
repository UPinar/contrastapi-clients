# ContrastAPI — Security Intelligence for VS Code

54 security tools in your editor. CVE/KEV/CWE lookup with composite risk scoring (CVSS+EPSS+KEV+PoC fusion) and CVSS v3.x vector parsing, MITRE ATLAS + D3FEND, Sigma detection rules, full-site security scan, domain & web intel, IP reputation, IOC analysis, code security scanning — all free, no API key required.

Powered by [ContrastAPI](https://api.contrastcyber.com), the same MCP server [Claude Desktop / Cursor / Windsurf](https://api.contrastcyber.com/mcp-setup) agents use.

## Documentation

- **[API Documentation](https://github.com/UPinar/contrastapi/blob/main/docs/API_Documentation.md)** — REST reference: 60+ endpoints, authentication, rate limits, token costs.
- **[MCP Documentation](https://github.com/UPinar/contrastapi/blob/main/docs/MCP_Documentation.md)** — MCP tool-selection guide, 7 Resources, 3 Prompts, example agent prompts.

## Features

### 54 Security Tools in 10 Categories

- **Domain Intelligence** — Domain report, DNS, WHOIS, SSL, subdomains, tech fingerprint, threat intel, wayback archive, headers, email MX, full domain audit, certificate transparency search, email security posture (SPF/DMARC/DKIM)
- **Web Intelligence** — robots.txt parser, redirect-chain walker, brand assets (favicon/logo/OG image), SEO audit (title/meta/h1/canonical/OG/Twitter)
- **Contact Validation** — Disposable email check, email verify, phone lookup, username OSINT (16 platforms)
- **IP Intelligence** — IP geolocation & reputation, ASN lookup, threat report (AbuseIPDB + Shodan + ASN)
- **CVE Intelligence** — CVE lookup, search by product/severity, exploit lookup, **composite risk score** (CVSS+EPSS+KEV+PoC fusion → CRIT/HIGH/MED/LOW + urgency), **CVSS v3.x vector parser** (per-metric breakdown), bulk lookup, leading CVEs (pre-NVD), **CISA KEV detail** (federal patch deadline + ransomware association), **MITRE CWE catalog** (description, mitigations, parent/child weakness chain)
- **Threat Intel / IOC** — IOC lookup, hash lookup, password breach check, phishing URL check, bulk IOC enrichment
- **Code Security** — Secret detection, injection vulnerability check, HTTP header analysis, dependency CVE scan
- **MITRE ATLAS** — AI/ML adversarial threat catalog: technique lookup/search/bulk, case study lookup/search
- **MITRE D3FEND** — Defensive countermeasures: defense lookup/search, defenses for an ATT&CK technique, full coverage map
- **Sigma Detection Rules** — Sigma rule lookup by UUID, bulk rule lookup (up to 50) across the in-memory Sigma corpus

### Smart Context Menu

Select any text in your editor, right-click → **ContrastAPI: Lookup**. The extension auto-detects:

- `CVE-2024-3094` → CVE Lookup
- `CWE-79` → CWE Lookup
- `AML.T0043` → ATLAS Technique Lookup
- `AML.CS0000` → ATLAS Case Study Lookup
- `D3-NTA` → D3FEND Defense Lookup
- `T1566` → D3FEND Defenses For ATT&CK
- `8.8.8.8` → IP Lookup
- `d41d8cd9...` → Hash Lookup
- `https://...` → Phishing Check
- `example.com` → Domain Report

### Workflow Chains for AI Agents

CVE responses embed `next_calls` — `{tool, input, reason}` triples that suggest the next lookup. Look up a CVE → get pivot suggestions for `kev_detail` (when in CISA KEV), `cwe_lookup` (the underlying weakness category), and `exploit_lookup` (public PoCs).

### How It Works

1. Open the **ContrastAPI** panel in the Activity Bar
2. Click any tool → enter your query
3. Results appear in a formatted panel beside your editor

No API key needed. Free tier: 30 tokens/hour. Heavy endpoints (audit, threat report) cost 4 tokens; bulk endpoints cost N tokens per item. Status bar shows remaining quota.

## Requirements

- VS Code 1.82+
- Internet connection

## Extension Settings

- `contrastapi.baseUrl`: API server URL (default: `https://api.contrastcyber.com`)

## API Key (Optional)

For higher rate limits, get a key at [contrastcyber.com](https://contrastcyber.com) ($15/mo) and set it via:

- Command Palette → `ContrastAPI: Set API Key`
- Or click the status bar item

## Links

- [API Reference](https://api.contrastcyber.com) — 55+ endpoints, interactive playground
- [MCP Setup](https://api.contrastcyber.com/mcp-setup) — Claude Desktop / Cursor / Windsurf
- [GitHub](https://github.com/UPinar/contrastapi) — source code, issues, examples
- [Website](https://contrastcyber.com)

## License

MIT

# Changelog

## 1.0.0 — Unreleased

- The extension now talks to the server's MCP endpoint. It no longer calls the old REST `/v1/` routes.
- The sidebar shows the server's tool list, grouped by category. A new server tool appears after the next refresh of the list, without an extension update.
- New command `ContrastAPI: Run Tool…` opens a form for any tool. Optional fields sit behind **Add filter…**. The menu shows the values already set, and picking one changes or clears it.
- The palette keeps its shortcuts for CVE Lookup, IP Lookup, DNS Lookup and SSL Check. Package Check is a new shortcut.
- The tool list is cached. A list older than 24 hours is refreshed at start-up. The refresh button fetches it at any time and costs 1 credit.
- New Watchlist view (needs a Pro API key): add, remove and clear items, read events, and a Watch button in the result panel.
- **Fetch New Events** moves the read position of the API key. Clients that share the key share the position. **Refresh Watchlist** does not move it. Clearing the list deletes the read position, and so does removing the last item.
- The extension sends the API key only to `api.contrastcyber.com` over https, or to localhost. `contrastapi.baseUrl` is now an application-level setting.
- New opt-in setting `contrastapi.mcp.register` (default `off`) offers the server to VS Code chat. An agent there uses your key and credits. VS Code runs tools marked read-only without asking. It is an application-level setting.
- The extension needs VS Code 1.101 or newer.
- The status bar and messages speak of credits.
- Removed the old REST client and its one palette command per tool. **Run Tool…** and the sidebar open every tool the server lists. Every 0.8.0 command whose tool the server does not have is gone, for example the ATLAS, Sigma, IOC, phone and username commands.
- The right-click **Lookup Selection** and **Watch this CVE** are gone. **Run Tool…** and the sidebar take the input, and the Watch button in the result panel watches a CVE.

## 0.7.0 — 2026-05-18

- **Tool count: 53 in 10 categories** (3 new tools below; prior releases under-stated the sidebar count by one)
- **Sigma Detection Rules** — new category, 2 commands
  - **Sigma Rule Lookup** — fetch a single Sigma rule by UUID from the in-memory corpus
  - **Bulk Sigma Rule Lookup** — look up to 50 Sigma rules by UUID in one call
- **Email Security Posture** — new Domain Intelligence command: SPF/DMARC/DKIM authentication posture with numeric score and findings (API v1.32.0)
- Sidebar: new "Sigma Detection Rules" category; "Email Security Posture" added to Domain Intelligence
- User-Agent corrected to `contrastapi-vscode/0.7.0` (was stale at `0.5.0` despite the 0.6.0 changelog claiming the bump)

## 0.6.1 — 2026-05-11

- Free tier rate limit: **30 tokens/hour** (was 100) — sync with API v1.30.3
- Pro tier price: **$15/mo** (was $7) — sync with API v1.31.0
- `RateTracker` `DEFAULT_LIMIT` constant updated to 30 — status bar now shows accurate remaining quota until the first server response refines it

## 0.6.0 — 2026-05-08

- **Tool count: 47 → 49** (parity with API v1.29.1)
- **CVE Intelligence batch (v1.29.1):** 2 new commands
  - **Calculate Risk Score** — composite CVE risk in 0–100 fusing CVSS + EPSS + KEV + PoC with multiplicative boosters (KEV+PoC ×1.15, CVSS≥9 AND EPSS>0.7 ×1.10, recent-publication ×1.05). Returns label (CRITICAL/HIGH/MEDIUM/LOW), urgency text, components breakdown, and recommendation. Methodology adapted from [mukul975/cve-mcp-server](https://github.com/mukul975/cve-mcp-server) (Apache-2.0) — clean-room reimplementation.
  - **CVSS Vector Details** — paste any CVSS v3.0 / v3.1 vector string and get a per-metric breakdown (attack_vector, attack_complexity, privileges_required, user_interaction, scope, confidentiality_impact, integrity_impact, availability_impact) plus a recomputed base score and severity label.
- Sidebar: CVE Intelligence category gains 2 entries above "Bulk CVE Lookup"
- User-Agent bumped to `contrastapi-vscode/0.6.0`

## 0.5.0 — 2026-05-04

- **Tool count: 33 → 47** (full parity with API v1.26.2)
- **Web Intelligence batch (v1.25.0):** 6 new commands
  - **Certificate Transparency Search** — pivot from a domain to every CT-logged cert (subdomain discovery)
  - **robots.txt Parser** — structured user-agent / disallow / sitemap extraction
  - **Redirect Chain Walker** — full hop trace (loop / mixed-content / TLS-strip detection)
  - **Brand Assets** — favicon, logo, OG image extraction
  - **SEO Audit** — title/meta/h1/canonical/OG/Twitter tags + indexability signals
  - **Email Verify** — mailbox-existence check (no SMTP probe; ethically-bounded)
- **MITRE ATLAS (AI/ML adversarial threats):** 5 new commands
  - Technique Lookup / Search / Bulk Lookup
  - Case Study Lookup / Search
  - Auto-detect on `AML.T*` / `AML.CS*` selections
- **MITRE D3FEND (defensive countermeasures):** 4 new commands
  - Defense Lookup / Search
  - Defenses For ATT&CK Technique (input `T1566`, get D3FEND mitigations)
  - Coverage Map (full ATT&CK ↔ D3FEND matrix)
  - Auto-detect on `D3-*` and ATT&CK `Txxxx[.yyy]` selections
- Sidebar: 2 new categories (Web Intelligence, MITRE ATLAS, MITRE D3FEND); CVE Intelligence gains "Leading CVEs", Code Security gains "Check Dependencies"
- Marketplace metadata: +8 keywords (mitre-atlas, mitre-d3fend, ai-security, web-intel, robots, seo, email-verify, certificate-transparency)
- User-Agent bumped to `contrastapi-vscode/0.5.0`

## 0.4.0 — 2026-04-25

- Added 2 new commands for full parity with API v1.11.1:
  - **KEV Detail** — CISA KEV record: federal patch deadline, required action, ransomware association, vendor/product, CISA-given common name (e.g. "Log4Shell"), CWE list
  - **CWE Lookup** — MITRE CWE catalog (research view 1000): description, abstract type, exploit likelihood, mitigations, parent/child weakness chain, CVE count
- Smart context menu now auto-detects `CWE-79` → CWE Lookup
- Sidebar tree exposes both new tools under CVE Intelligence
- Marketplace metadata: categories `AI`, `Linters`, `Testing` (was `Linters`, `Other`); expanded keywords for discoverability (kev, cwe, ai-agents, mcp, model-context-protocol, claude, cursor, copilot, owasp, pentest, …)
- Tool count: 31 → 33
- User-Agent bumped to `contrastapi-vscode/0.4.0`

## 0.3.0 — 2026-04-20

- Added 2 new commands for full parity with API v1.9.0:
  - **Check Dependencies** — scan package list (requirements.txt / plain `name==version`) for known CVEs
  - **Leading CVEs** — fresh CVEs indexed from MITRE/GHSA before NVD enrichment (ContrastAPI's unique catch)
- Tool count: 29 → 31
- User-Agent bumped to `contrastapi-vscode/0.3.0`

## 0.2.1 — 2026-04-11

- Fixed broken API Documentation link (pointed to non-existent /docs endpoint)
- Added `repository`, `homepage`, `bugs` fields to package.json for Marketplace sidebar links
- Updated README links with descriptive labels

## 0.2.0 — 2026-04-11

- Added 4 new Phase 1 endpoints:
  - Domain Audit — full report + tech fingerprint + live headers in one call (cost: 4 tokens)
  - IP Threat Report — AbuseIPDB + Shodan + ASN aggregated (cost: 4 tokens)
  - Bulk CVE Lookup — up to 50 CVE IDs per call (cost: N tokens)
  - Bulk IOC Lookup — up to 50 indicators per call (cost: N tokens)
- Updated README: rate limit now 100 tokens/hour (was 60 requests/hour)
- Tool count: 25 → 29

## 0.1.0 — 2026-04-07

- Initial release
- 25 security tools across 6 categories
- Sidebar with categorized tool listing
- Formatted result panel with theme-aware styling
- Smart context menu with auto-detection (CVE, IP, domain, URL, email, hash)
- Code security: secret detection, injection check, header analysis from editor
- Password breach check with client-side SHA-1 hashing
- Status bar with rate limit tracking
- API key management via VS Code SecretStorage

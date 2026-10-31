# ContrastAPI Security Tools — Claude Desktop Extension

ContrastAPI gives Claude security tools. They cover CVE intelligence, package vulnerabilities, domain and IP intelligence, threat defense, and CVE and domain monitoring. Most tools need **no signup and no API key**. This extension is a thin local bridge to the hosted [ContrastAPI](https://api.contrastcyber.com) MCP server (`https://api.contrastcyber.com/mcp/`).

## What you get

Each tool carries a human-readable title (e.g. `cve_lookup` → "CVE Lookup").

- **Key:** the watchlist tools (`watchlist_edit`, `watchlist_events`) need a Pro API key. Every other tool works without one.
- **Writes:** `watchlist_edit` changes data: it adds, removes and clears the items of your watchlist. `watchlist_events` keeps your read position on the server. Every other tool only reads.

<!-- tools:start -->

### Operations

- **Health and Data Freshness** — `health`
- **Privacy: My Data** — `privacy_my_data`

### CVE Intelligence

- **CVE Lookup** — `cve_lookup`
- **Bulk CVE Lookup** — `cve_lookup_bulk`
- **CVE Affected Products** — `cve_products`
- **CVE Search** — `cve_search`
- **Leading CVEs by EPSS** — `cve_leading`
- **CISA KEV Lookup** — `kev_lookup`
- **CWE Lookup** — `cwe_lookup`
- **CVE Risk Score** — `cve_risk_score`
- **CVE Exploit Intelligence** — `cve_exploit`
- **CVE Triage** — `cve_triage`
- **Bulk CVE Triage** — `cve_triage_bulk`
- **Product Exposure** — `product_exposure`
- **CPE Search** — `cpe_search`
- **CVSS Calculator** — `cvss_calculator`

### Monitoring

- **Watchlist: CVE and Domain Monitoring** — `watchlist_edit`
- **Monitoring Events** — `watchlist_events`

### Credential Checks

- **Breached Password Check** — `password_check`

### Domain Intelligence

- **DNS Lookup** — `dns_lookup`
- **Subdomain Takeover Check** — `dns_takeover_check`
- **Email Authentication Check (SPF, DMARC, DKIM)** — `email_auth_check`
- **Email Address Check** — `email_address_check`
- **SSL/TLS Certificate Check** — `ssl_check`
- **Security Headers Check** — `headers_check`
- **WHOIS / RDAP Lookup** — `whois_lookup`
- **Wayback Machine Lookup** — `wayback_lookup`
- **Certificate Transparency Search** — `cert_search`
- **Subdomain Enumeration** — `subdomain_enum`

### IP Intelligence

- **IP Lookup** — `ip_lookup`
- **ASN Lookup** — `asn_lookup`

### Threat Defense

- **D3FEND Defenses for ATT&CK** — `d3fend_for_attack`
- **Vulnerable Driver Lookup (LOLDrivers)** — `driver_lookup`
- **Bulk Driver Lookup** — `driver_lookup_bulk`

### Package Vulnerabilities (SBOM)

- **Package Vulnerability Check** — `package_check`
- **Bulk Package Check (SBOM)** — `package_check_bulk`

<!-- tools:end -->

## Installation

1. Download `contrastapi-<version>.mcpb`.
2. Double-click it (or in Claude Desktop: **Settings → Extensions → Install Extension…**) and confirm.
3. Done — ask Claude e.g. *"Check CVE-2025-1234 and whether it's in KEV"* or *"Audit the security headers and TLS of example.com"*.

## Configuration

No configuration is required. Optionally, set **Pro API key** in the extension settings to raise rate limits and to use the watchlist tools (keys look like `cc_…`; see [pricing](https://api.contrastcyber.com)). The key is stored by Claude Desktop as a sensitive value and sent only to `api.contrastcyber.com` as an `X-API-Key` header.

## Rate limits

Rate limits are counted in credits. The free keyless tier allows 30 credits per hour per IP and returns a clear message when they run out. A Pro key raises the limit substantially.

## Privacy Policy

Full policy: **https://api.contrastcyber.com/privacy**

Summary of how this extension handles data:

- **What is sent:** only your tool queries (e.g. a domain, IP, hash, CVE ID you ask about) and, if configured, your API key — over HTTPS to `api.contrastcyber.com`. Nothing else on your machine is read or transmitted.
- **What is stored locally:** nothing is written to disk — no cache, no files. The bridge emits diagnostic lines to stderr (which Claude Desktop captures in its extension log); these never include your API key or the contents of your queries.
- **Service-side handling:** queries are processed to produce the answer; standard operational logs are kept briefly for abuse prevention and are not sold or shared with third parties. Details, retention periods, and contact information are in the policy linked above.
- **Contact:** contact@contrastcyber.com

## Support

- Issues: https://github.com/UPinar/contrastapi/issues
- Email: contact@contrastcyber.com

## License

MIT

# ContrastAPI Dify plugin

This plugin gives Dify agents and workflows the security tools of [ContrastAPI](https://api.contrastcyber.com). They look up CVEs, CISA KEV entries, EPSS scores and public exploits, check packages against advisories, and check domains, DNS, TLS, e-mail and IP addresses. Each call goes to `https://api.contrastcyber.com`. The API key is optional. Without a key, calls use the free hourly credits of the IP address your Dify server calls from. Other users of a shared Dify host use the same credits. A Pro key gives more credits and the watchlist tools. Pro keys are sold at https://api.contrastcyber.com/pricing.

Source: https://github.com/UPinar/contrastapi-clients (directory `dify-plugin`).

## Setup

1. Install the plugin from the Dify Marketplace.
2. Open the plugin and choose **API Key Authorization Configuration**. Give the authorization a name. Leave the API key empty to use the free credits, or paste a Pro key that starts with `contrastapi_`. The plugin checks a pasted key with the `/health` endpoint, which costs no credits.
3. Add a ContrastAPI tool to a workflow or an agent, for example **CVE Lookup** with `CVE-2021-44228`.

## Connection

The Dify server must reach `https://api.contrastcyber.com` over HTTPS. The plugin calls no other host, follows no redirect and waits at most 30 seconds for an answer.

## Changes in 0.10.0

- New: `well_known` reads the robots.txt and the security.txt of a web site, and `epss_risers` lists the CVEs whose EPSS score rose most over 7 or 30 days.
- `cve_search` takes `kev_added_after`, and its `sort` takes `kev_date_added`.
- Each tool parameter carries the description that ContrastAPI gives it.

## Changes in 0.9.0

Version 0.9.0 calls the current ContrastAPI. The `/v1` paths that 0.8.0 called no longer exist, so 0.8.0 fails on every call. A workflow that used one of the tools below must pick it again.

- Renamed: `scan_headers` is now `headers_check`, `exploit_lookup` is `cve_exploit`, `kev_detail` is `kev_lookup`, `calculate_risk_score` is `cve_risk_score`, `get_cvss_details` is `cvss_calculator`, `bulk_cve_lookup` is `cve_lookup_bulk`, `email_security_posture` is `email_auth_check`, `d3fend_defense_for_attack` is `d3fend_for_attack` and `check_dependencies` is `package_check_bulk`. `email_mx`, `email_disposable` and `email_verify` are one tool, `email_address_check`.
- Removed, because ContrastAPI no longer has them: the MITRE ATLAS and Sigma tools, the IOC, hash, threat, phishing, phone and username lookups, `check_headers`, `check_secrets`, `check_injection`, `domain_report`, `audit_domain`, `contrast_scan`, `tech_fingerprint`, `threat_report`, `robots_txt`, `redirect_chain`, `brand_assets`, `seo_audit` and the other D3FEND tools.
- New: the credential is an optional API key. Tools for CVE triage, product exposure, CPE search, packages, drivers, certificates and a watchlist (with a Pro key) were added.

## Password check

The password_check tool takes the password itself. The plugin sends only its SHA-1 to ContrastAPI. The text you type still passes through the AI model and Dify's logs, so check a candidate password, not one in use.

## Vendor keys

A Pro key can add Shodan and AbuseIPDB answers to ip_lookup. Those keys are saved through the link that the privacy_my_data tool gives. This plugin has no tool for it.

## Tools

<!-- tools:start -->

### CVE Intelligence

- **CPE Search** (`cpe_search`): Find the CPE vendor and product names that hold a text, ranked by vulnerable CVE count.
- **CVE Exploit Intelligence** (`cve_exploit`): Public exploit intelligence (GitHub PoCs, Metasploit, NVD and CNA exploit references, ExploitDB).
- **Leading CVEs by EPSS** (`cve_leading`): List the CVEs most likely to be exploited, by EPSS score (the probability of exploitation in the next 30 days), with a verdict on the top score.
- **CVE Lookup** (`cve_lookup`): Full CVE record by ID (CVSS, EPSS, KEV, CWE, references, CISA SSVC, Nuclei templates), with the optional GitHub Security Advisory.
- **Bulk CVE Lookup** (`cve_lookup_bulk`): Look up many CVEs at once, each with the fields of cve_lookup.
- **CVE Affected Products** (`cve_products`): The products a CVE affects, one page at a time, with the vulnerable products first.
- **CVE Risk Score** (`cve_risk_score`): Composite risk score of a CVE, 0-100, for patch priority.
- **CVE Search** (`cve_search`): Search CVEs by severity, CWE, CVSS, EPSS, CISA KEV, ransomware use, Nuclei template, vendor, product and publish date, one page at a time.
- **CVE Triage** (`cve_triage`): Rank the CVEs of a vendor or product by composite risk score, at or above the optional min_risk_score argument, as lean rows (cve_id, risk_score, label).
- **Bulk CVE Triage** (`cve_triage_bulk`): Triage many CVEs at once, ranked by composite risk score.
- **CVSS Calculator** (`cvss_calculator`): Decode a CVSS v3.0/v3.1 vector into its base metrics and recompute its base, temporal and environmental scores.
- **CWE Lookup** (`cwe_lookup`): CWE weakness details (description, mitigations, examples, OWASP Top 10 category in 2021 and 2025), with how many CVEs and CISA KEV entries name it.
- **EPSS Risers** (`epss_risers`): List the CVEs whose EPSS score rose most over the last 7 or 30 days, with the old and the new score.
- **CISA KEV Lookup** (`kev_lookup`): CISA KEV catalog entry for a CVE: the required action, the patch deadline and known ransomware use.
- **Product Exposure** (`product_exposure`): CVE exposure of one vendor and product: severity, KEV and PoC counts, CVSS, EPSS, the worst risk score, the top CVEs and the endoflife.date support dates.

### Credential Checks

- **Breached Password Check** (`password_check`): Check whether a password appears in Have I Been Pwned's Pwned Passwords list.

### Domain Intelligence

- **Certificate Transparency Search** (`cert_search`): List the unexpired certificates that Certificate Transparency logs hold for a host name, wildcards included, from SSLMate's Cert Spotter: the 10 newest, with issuer, validity and DNS names.
- **DNS Lookup** (`dns_lookup`): Look up a domain's DNS records: A, AAAA, MX, NS, TXT, CNAME, SOA and CAA.
- **Subdomain Takeover Check** (`dns_takeover_check`): Check a host name for subdomain takeover through a dangling CNAME.
- **Email Address Check** (`email_address_check`): Check an e-mail address without sending mail: whether its domain exists and takes mail, and whether a disposable domain list names it.
- **Email Authentication Check (SPF, DMARC, DKIM)** (`email_auth_check`): Check a domain's mail authentication: SPF, DMARC (from a parent domain when the domain has no record of its own), DKIM, MX and MTA-STS, each check with pass, warn or fail and a severity.
- **Security Headers Check** (`headers_check`): Rate nine security headers of a web site, such as CSP, HSTS and Set-Cookie, from one GET to https://<domain>/ that follows up to 5 redirects on the same host or its www pair.
- **SSL/TLS Certificate Check** (`ssl_check`): Check the TLS certificate and settings of a host name on port 443: version, cipher, trust, OCSP revocation, expiry, DNS names, the chain and an abuse.ch SSL Blacklist listing.
- **Subdomain Enumeration** (`subdomain_enum`): List up to 50 subdomains of a registrable domain from Certificate Transparency, DNS queries for 94 common names and the domain's MX, NS and SPF records.
- **Wayback Machine Lookup** (`wayback_lookup`): List when the Wayback Machine captured a host's home page: the first and last capture, the years between them (archive span, not domain age) and the latest 10 captures with links.
- **Robots.txt and security.txt Check** (`well_known`): Read robots.txt of https://<domain> and, if it allows us, /.well-known/security.txt, with up to 5 redirects on the host or its www pair.
- **WHOIS / RDAP Lookup** (`whois_lookup`): Look up a domain's registration over RDAP, or WHOIS where allowed: registrar, dates, status, name servers and DNSSEC.

### IP Intelligence

- **ASN Lookup** (`asn_lookup`): Look up an autonomous system by number, such as AS15169, or by an IP address it holds: name, country and one page of its IPv4 and IPv6 prefixes, derived from IPtoASN.
- **IP Lookup** (`ip_lookup`): Look up a public IP address: AS, country, cloud provider, CDN, datacenter or Tor exit, DROP listing and PTR name.

### Monitoring

- **Watchlist: CVE, Package, Domain and IP Monitoring** (`watchlist_edit`): Add, remove, list or clear the items this API key watches: CVEs, products, CVE searches, packages, domains and IP addresses.
- **Monitoring Events** (`watchlist_events`): Report what changed on the items this API key watches, such as a new advisory for a package or a certificate about to expire, oldest first.

### Operations

- **Health and Data Freshness** (`health`): Database freshness: CVE/KEV/CWE counts and latest entries, and the sync state of each upstream feed.
- **Privacy: My Data** (`privacy_my_data`): What this server keeps about the caller: the hash its credits are counted under, the rate limit left in this hour and the privacy policy.

### Package Vulnerabilities (SBOM)

- **Package Vulnerability Check** (`package_check`): Check a package against the OSV.dev advisories (GitHub, Go, PyPA, RustSec) and the OpenSSF malicious package list, with the fixed version and endoflife.date dates.
- **Bulk Package Check (SBOM)** (`package_check_bulk`): Check many packages at once, each an ecosystem, a name and an exact version, against the advisories package_check reads.

### Threat Defense

- **D3FEND Defenses for ATT&CK** (`d3fend_for_attack`): MITRE D3FEND defenses that counter a MITRE ATT&CK technique.
- **Windows Driver Lookup (LOLDrivers)** (`driver_lookup`): Look up a Windows driver hash in the LOLDrivers catalog of vulnerable and malicious drivers.
- **Bulk Windows Driver Lookup** (`driver_lookup_bulk`): Look up many driver file hashes in the LOLDrivers catalog at once, each with the fields of driver_lookup.

<!-- tools:end -->

## Privacy

See [PRIVACY.md](PRIVACY.md).

## License

MIT. See the LICENSE file of the [contrastapi-clients](https://github.com/UPinar/contrastapi-clients) repository.

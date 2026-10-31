import { CveSearchParams, ContrastApiError } from "./types";

function enc(v: string): string {
  return encodeURIComponent(v);
}

function encPath(v: string): string {
  return v.split("/").map(encodeURIComponent).join("/");
}

export class ContrastClient {
  private baseUrl: string;
  private apiKey?: string;
  private onRequest?: (remaining: number, limit: number, reset: number) => void;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  setApiKey(apiKey: string | undefined): void {
    this.apiKey = apiKey;
  }

  setOnRequest(callback: (remaining: number, limit: number, reset: number) => void): void {
    this.onRequest = callback;
  }

  private async request(method: string, path: string, body?: object): Promise<any> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "contrastapi-vscode/0.8.0",
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(30000) };

    if (body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${path}`, init);

    const rlRemaining = parseInt(res.headers.get("x-ratelimit-remaining") ?? "", 10);
    const rlLimit = parseInt(res.headers.get("x-ratelimit-limit") ?? "", 10);
    const rlReset = parseInt(res.headers.get("x-ratelimit-reset") ?? "", 10);
    if (!isNaN(rlRemaining) && !isNaN(rlLimit)) {
      this.onRequest?.(rlRemaining, rlLimit, isNaN(rlReset) ? 0 : rlReset);
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const json = await res.json();
        detail = json.detail || json.message || detail;
      } catch {
        // ignore parse errors
      }
      throw new ContrastApiError(detail, res.status);
    }

    return res.json();
  }

  // --- Domain Intelligence ---
  domainReport(domain: string) { return this.request("GET", `/v1/domain/${enc(domain)}`); }
  dnsLookup(domain: string) { return this.request("GET", `/v1/dns/${enc(domain)}`); }
  whoisLookup(domain: string) { return this.request("GET", `/v1/whois/${enc(domain)}`); }
  sslCheck(domain: string) { return this.request("GET", `/v1/ssl/${enc(domain)}`); }
  subdomainEnum(domain: string) { return this.request("GET", `/v1/subdomains/${enc(domain)}`); }
  techFingerprint(domain: string) { return this.request("GET", `/v1/tech/${enc(domain)}`); }
  threatIntel(domain: string) { return this.request("GET", `/v1/threat/${enc(domain)}`); }
  waybackLookup(domain: string) { return this.request("GET", `/v1/archive/${enc(domain)}`); }
  scanHeaders(domain: string) { return this.request("GET", `/v1/scan/headers/${enc(domain)}`); }
  contrastScan(domain: string) { return this.request("GET", `/v1/scan/${enc(domain)}`); }
  emailMx(domain: string) { return this.request("GET", `/v1/email/mx/${enc(domain)}`); }
  auditDomain(domain: string) { return this.request("GET", `/v1/audit/${enc(domain)}`); }
  certSearch(domain: string) { return this.request("GET", `/v1/certs/${enc(domain)}`); }
  emailSecurityPosture(domain: string) { return this.request("GET", `/v1/email/security-posture/${enc(domain)}`); }

  // --- Web Intelligence (v1.25.0) ---
  robotsTxt(domain: string) { return this.request("GET", `/v1/robots/${enc(domain)}`); }
  redirectChain(url: string) { return this.request("GET", `/v1/redirect/${encPath(url)}`); }
  brandAssets(domain: string) { return this.request("GET", `/v1/brand/${enc(domain)}`); }
  seoAudit(domain: string) { return this.request("GET", `/v1/seo/${enc(domain)}`); }

  // --- Contact Validation ---
  emailDisposable(email: string) { return this.request("GET", `/v1/email/disposable/${enc(email)}`); }
  emailVerify(email: string) { return this.request("GET", `/v1/email/verify/${enc(email)}`); }
  phoneLookup(number: string) { return this.request("GET", `/v1/phone/${enc(number)}`); }
  usernameLookup(username: string) { return this.request("GET", `/v1/username/${enc(username)}`); }

  // --- IP Intelligence ---
  ipLookup(ip: string) { return this.request("GET", `/v1/ip/${enc(ip)}`); }
  asnLookup(target: string) { return this.request("GET", `/v1/asn/${enc(target)}`); }
  threatReport(ip: string) { return this.request("GET", `/v1/threat-report/${enc(ip)}`); }

  // --- CVE Intelligence ---
  cveLookup(cveId: string) { return this.request("GET", `/v1/cve/${enc(cveId)}`); }
  cveSearch(params: CveSearchParams) {
    const q = new URLSearchParams();
    if (params.product) q.set("product", params.product);
    if (params.severity) q.set("severity", params.severity);
    if (params.days !== undefined) q.set("days", String(params.days));
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    return this.request("GET", `/v1/cves?${q}`);
  }
  exploitLookup(cveId: string) { return this.request("GET", `/v1/exploit/${enc(cveId)}`); }
  kevDetail(cveId: string) { return this.request("GET", `/v1/kev/${enc(cveId)}`); }
  cweLookup(cweId: string) { return this.request("GET", `/v1/cwe/${enc(cweId)}`); }
  // v1.29.1
  calculateRiskScore(cveId: string) { return this.request("GET", `/v1/cve/${enc(cveId)}/risk_score`); }
  getCvssDetails(vector: string) { return this.request("GET", `/v1/cvss/details?vector=${encodeURIComponent(vector)}`); }
  bulkCveLookup(cveIds: string[]) { return this.request("POST", "/v1/cves/bulk", { cve_ids: cveIds }); }
  cveLeading(limit?: number, offset?: number) {
    const q = new URLSearchParams();
    if (limit !== undefined) q.set("limit", String(limit));
    if (offset !== undefined) q.set("offset", String(offset));
    const qs = q.toString();
    return this.request("GET", `/v1/cve/leading${qs ? `?${qs}` : ""}`);
  }

  // --- Threat Intel / IOC ---
  iocLookup(indicator: string) { return this.request("GET", `/v1/ioc/${encPath(indicator)}`); }
  hashLookup(hash: string) { return this.request("GET", `/v1/hash/${enc(hash)}`); }
  passwordCheck(sha1: string) { return this.request("GET", `/v1/password/${enc(sha1)}`); }
  phishingCheck(url: string) { return this.request("GET", `/v1/phishing/${encPath(url)}`); }
  bulkIocLookup(indicators: string[]) { return this.request("POST", "/v1/iocs/bulk", { indicators }); }

  // --- Code Security ---
  checkSecrets(code: string, language?: string) { return this.request("POST", "/v1/check/secrets", { code, language }); }
  checkInjection(code: string, language?: string) { return this.request("POST", "/v1/check/injection", { code, language }); }
  checkHeaders(headers: Record<string, string>) { return this.request("POST", "/v1/check/headers", { headers }); }
  checkDependencies(packages: Array<{ name: string; version?: string }>) {
    return this.request("POST", "/v1/check/dependencies", { packages });
  }

  // --- MITRE ATLAS (AI/ML Adversarial Threats) ---
  atlasTechniqueLookup(techniqueId: string) { return this.request("GET", `/v1/atlas/${enc(techniqueId)}`); }
  atlasTechniqueSearch(params: { tactic?: string; keyword?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params.tactic) q.set("tactic", params.tactic);
    if (params.keyword) q.set("keyword", params.keyword);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.request("GET", `/v1/atlas/techniques${qs ? `?${qs}` : ""}`);
  }
  bulkAtlasTechniqueLookup(techniqueIds: string[]) {
    return this.request("POST", "/v1/atlas/techniques/bulk", { technique_ids: techniqueIds });
  }
  atlasCaseStudyLookup(caseStudyId: string) { return this.request("GET", `/v1/atlas/case-studies/${enc(caseStudyId)}`); }
  atlasCaseStudySearch(params: { keyword?: string; technique_id?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params.keyword) q.set("keyword", params.keyword);
    if (params.technique_id) q.set("technique_id", params.technique_id);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.request("GET", `/v1/atlas/case-studies${qs ? `?${qs}` : ""}`);
  }

  // --- MITRE D3FEND (Defensive Countermeasures) ---
  d3fendDefenseLookup(defenseId: string) { return this.request("GET", `/v1/d3fend/${enc(defenseId)}`); }
  d3fendDefenseSearch(params: { tactic?: string; keyword?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (params.tactic) q.set("tactic", params.tactic);
    if (params.keyword) q.set("keyword", params.keyword);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.request("GET", `/v1/d3fend/defenses${qs ? `?${qs}` : ""}`);
  }
  d3fendDefenseForAttack(attackTechniqueId: string) {
    return this.request("GET", `/v1/d3fend/attack/${enc(attackTechniqueId)}`);
  }
  d3fendAttackCoverage() { return this.request("GET", "/v1/d3fend/coverage"); }

  // --- Sigma Detection Rules (v1.32.0) ---
  sigmaRuleLookup(ruleId: string) { return this.request("GET", `/v1/sigma/${enc(ruleId)}`); }
  bulkSigmaRuleLookup(ruleIds: string[]) { return this.request("POST", "/v1/sigma/bulk", { rule_ids: ruleIds }); }

  // --- Meta ---
  status() { return this.request("GET", "/v1/status"); }
  usage() { return this.request("GET", "/v1/usage"); }
}

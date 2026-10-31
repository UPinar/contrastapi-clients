export type IndicatorType =
  | "cve"
  | "cwe"
  | "atlas"
  | "atlas_case_study"
  | "d3fend"
  | "attack_technique"
  | "ip"
  | "domain"
  | "url"
  | "hash_md5"
  | "hash_sha1"
  | "hash_sha256"
  | "email"
  | "unknown";

const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;
const CWE_RE = /^CWE-\d{1,6}$/i;
const ATLAS_RE = /^AML\.T\d{4}(?:\.\d{3})?$/i;
const ATLAS_CASE_STUDY_RE = /^AML\.CS\d{4}$/i;
const D3FEND_RE = /^D3-[A-Z]{2,5}$/i;
const ATTACK_TECHNIQUE_RE = /^T\d{4}(?:\.\d{3})?$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const MD5_RE = /^[a-f0-9]{32}$/i;
const SHA1_RE = /^[a-f0-9]{40}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/i;

export function detectIndicator(text: string): IndicatorType {
  const trimmed = text.trim();
  if (!trimmed) return "unknown";

  if (CVE_RE.test(trimmed)) return "cve";
  if (CWE_RE.test(trimmed)) return "cwe";
  if (ATLAS_CASE_STUDY_RE.test(trimmed)) return "atlas_case_study";
  if (ATLAS_RE.test(trimmed)) return "atlas";
  if (D3FEND_RE.test(trimmed)) return "d3fend";
  if (ATTACK_TECHNIQUE_RE.test(trimmed)) return "attack_technique";
  if (SHA256_RE.test(trimmed)) return "hash_sha256";
  if (SHA1_RE.test(trimmed)) return "hash_sha1";
  if (MD5_RE.test(trimmed)) return "hash_md5";
  if (IPV4_RE.test(trimmed)) return "ip";
  if (URL_RE.test(trimmed)) return "url";
  if (EMAIL_RE.test(trimmed)) return "email";
  if (DOMAIN_RE.test(trimmed)) return "domain";
  return "unknown";
}

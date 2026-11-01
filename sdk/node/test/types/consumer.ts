// Strict consumer of the published types. Checked with:
//   tsc --noEmit --strict --module nodenext --moduleResolution nodenext test/types/consumer.ts
import {
  ContrastAPI,
  ContrastAPIError,
  RateLimitError,
  APITimeoutError,
  type ContrastAPIOptions,
  type RateLimitInfo,
  type CveSearchArgs,
  type OperationId,
  type FetchLike,
} from "contrastapi";

const myFetch: FetchLike = async (_url, _init) => ({
  status: 200,
  headers: { get: (_name: string) => null },
  body: null,
});

const options: ContrastAPIOptions = {
  apiKey: "k",
  baseUrl: "http://localhost:8080",
  trustHost: false,
  timeoutMs: 5000,
  maxRetries: 1,
  maxRetryWaitMs: 10000,
  upstreamBusyRetries: 2,
  fetch: myFetch,
  onRateLimit: (info: RateLimitInfo) => {
    const n: number = info.limit + info.remaining;
    const d: Date = info.resetAt;
    const s: string = info.resetHuman;
    void n, d, s;
  },
};

export async function run(): Promise<void> {
  const client = new ContrastAPI(options);
  new ContrastAPI();
  new ContrastAPI({ fetch: globalThis.fetch });

  const search: CveSearchArgs = { severity: "HIGH", in_kev: true, known_ransomware: true, limit: 5 };
  const a: unknown = await client.cveSearch(search);
  const b: unknown = await client.cveSearch();
  const c: unknown = await client.cveLookup({ cve_id: "CVE-2021-44228" });
  const d: unknown = await client.cveLookupBulk({ cve_ids: ["CVE-1"] });
  const e: unknown = await client.health();
  const f: unknown = await client.call("cve_lookup", { cve_id: "CVE-1" });
  const g: unknown = await client.call("health");
  const h: unknown = await client.call("cve_search");
  const i: unknown = await client.request("GET", "/x", { query: { a: 1, b: true, c: null }, body: { k: 1 } });
  void a, b, c, d, e, f, g, h, i;

  const id: OperationId = "cve_lookup_bulk";
  void id;

  const rl: RateLimitInfo | null = client.lastRateLimit;
  void rl;

  try {
    await client.health();
  } catch (err) {
    if (err instanceof RateLimitError) {
      const ra: number | null = err.retryAfter;
      const st: number | null = err.status;
      void ra, st;
    } else if (err instanceof APITimeoutError) {
      const st: null = err.status;
      void st;
    } else if (err instanceof ContrastAPIError) {
      const code: string | null = err.code;
      const r: RateLimitInfo | null = err.rateLimit;
      void code, r;
    }
  }
}

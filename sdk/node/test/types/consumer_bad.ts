// Every line below must be a type error; tsc fails if one is not.
import { ContrastAPI } from "contrastapi";

export async function run(): Promise<void> {
  const client = new ContrastAPI();

  // @ts-expect-error missing required cve_id
  await client.cveLookup({});
  // @ts-expect-error missing args object
  await client.cveLookup();
  // @ts-expect-error missing required cve_ids
  await client.cveLookupBulk({});
  // @ts-expect-error wrong enum literal
  await client.cveSearch({ severity: "HUGE" });
  // @ts-expect-error wrong sort literal
  await client.cveSearch({ sort: "random" });
  // @ts-expect-error known_ransomware only takes true
  await client.cveSearch({ known_ransomware: false });
  // @ts-expect-error unknown search option
  await client.cveSearch({ vendr: "apache" });
  // @ts-expect-error health takes no arguments
  await client.health({ verbose: true });
  // @ts-expect-error unknown client option
  new ContrastAPI({ apikey: "k" });
  // @ts-expect-error timeoutMs is a number
  new ContrastAPI({ timeoutMs: "5000" });
  // @ts-expect-error unknown operation id
  await client.call("nope");
  // @ts-expect-error call needs the required args of cve_lookup
  await client.call("cve_lookup");
  // @ts-expect-error call args are checked per operation
  await client.call("cve_lookup", { cve_ids: ["x"] });
  // @ts-expect-error lastRateLimit is read-only
  client.lastRateLimit = null;
}

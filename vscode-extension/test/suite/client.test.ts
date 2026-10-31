import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { ContrastClient } from "../../src/api/client";

interface Captured {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

let captured: Captured;

const realFetch = globalThis.fetch;

function installFetchStub(): void {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = {
      url: String(url),
      method: init.method ?? "GET",
      body: init.body as string | undefined,
      headers: (init.headers as Record<string, string>) ?? {},
    };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
    } as unknown as Response;
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    restoreFetch();
    throw e;
  }
}

async function main(): Promise<void> {
  console.log("client.test.ts");
  installFetchStub();
  const client = new ContrastClient("https://api.contrastcyber.com");

  await test("emailSecurityPosture → GET /v1/email/security-posture/{domain}", async () => {
    await client.emailSecurityPosture("example.com");
    assert.strictEqual(captured.method, "GET");
    assert.strictEqual(
      captured.url,
      "https://api.contrastcyber.com/v1/email/security-posture/example.com",
    );
  });

  await test("sigmaRuleLookup → GET /v1/sigma/{rule_id}", async () => {
    await client.sigmaRuleLookup("11111111-2222-3333-4444-555555555555");
    assert.strictEqual(captured.method, "GET");
    assert.strictEqual(
      captured.url,
      "https://api.contrastcyber.com/v1/sigma/11111111-2222-3333-4444-555555555555",
    );
  });

  await test("bulkSigmaRuleLookup → POST /v1/sigma/bulk with rule_ids body", async () => {
    await client.bulkSigmaRuleLookup(["aaa", "bbb"]);
    assert.strictEqual(captured.method, "POST");
    assert.strictEqual(captured.url, "https://api.contrastcyber.com/v1/sigma/bulk");
    assert.deepStrictEqual(JSON.parse(captured.body as string), { rule_ids: ["aaa", "bbb"] });
  });

  await test("User-Agent header tracks package.json version", async () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
    ) as { version: string };
    await client.status();
    assert.strictEqual(
      captured.headers["User-Agent"],
      `contrastapi-vscode/${pkg.version}`,
    );
  });

  restoreFetch();
  console.log("\nAll client tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

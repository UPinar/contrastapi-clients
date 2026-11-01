# ContrastAPI Node.js SDK

Official Node.js SDK for [ContrastAPI](https://api.contrastcyber.com), security intelligence for developers and AI agents.

The SDK has no runtime dependencies. It is an ES module and uses the built-in `fetch`.

## Install

```bash
npm install contrastapi
```

It needs Node.js 20.19 or newer. The package ships its own TypeScript declarations.

## Quickstart

```javascript
import { ContrastAPI } from "contrastapi";

const api = new ContrastAPI();

// A typed method for one operation of the REST API.
const cve = await api.cveLookup({ cve_id: "CVE-2021-44228" });

// The same operation by its id.
const same = await api.call("cve_lookup", { cve_id: "CVE-2021-44228" });
```

Each method takes one object. Its keys are the parameter names of the REST API.
The client checks the keys and the required values before it sends anything.
A call with an unknown key or a missing required value fails with `TypeError` and spends no credit.
A method returns the parsed JSON body.

The methods and their argument types are generated from the OpenAPI document of the server.
The type declarations of the package list them, so an editor can complete them.

### Raw requests

`request()` sends a request to any path. It uses the same key policy, errors, retries and credit reading as the methods.

```javascript
const health = await api.request("GET", "/health");
const found = await api.request("GET", "/cve_search", { query: { product: "apache" } });
const bulk = await api.request("POST", "/cve_lookup_bulk", { body: { cve_ids: ["CVE-2021-44228"] } });
```

`request()` sends a JSON body or none. It cannot send raw bytes.

### Not in the SDK

`/image_inspect` takes a raw image body (`application/octet-stream`). The SDK sends JSON bodies only, so it has no method for it, and `request()` is no way around that. Call that endpoint with `fetch` or another HTTP client.

## API key

```javascript
const api = new ContrastAPI({ apiKey: "your-api-key" });
```

Without the `apiKey` option, the client reads the `CONTRASTAPI_API_KEY` environment variable and trims ASCII white space from both ends. An empty string sends no key.
A key may hold only printable ASCII without spaces; any other key throws `TypeError`, and the message does not repeat it.
The client keeps the key only when it will send it.

The client sends the key in the `X-API-Key` header. It sends it only to `api.contrastcyber.com`, `localhost`, `127.0.0.1` and `[::1]`. For any other host, set `trustHost: true`.

`baseUrl` must use https. Plain http is accepted only for `localhost`, `127.0.0.1` and `[::1]`, written that way.
`baseUrl` must not hold user info, a query, a fragment, a backslash, a space or an ASCII control character.
Its path must not hold a `.` or `..` segment.
The client does not follow redirects: any 3xx answer fails the call with `APIConnectionError("redirect refused")`.
Before each request, the client checks that the URL keeps the scheme, host and port of `baseUrl` and stays under its path.
A URL that leaves it throws `TypeError` and sends nothing.
A request path with a `.` or `..` segment also throws `TypeError` and sends nothing.
This covers a raw path and a path value of a method, such as `cve_id: ".."`.
In a raw path, a dot written as `%2e` or `%2E` counts as a dot.
A method encodes `%` in a path value, so a value of `%2e` is sent.
The query is not checked.

Get a key at [api.contrastcyber.com/pricing](https://api.contrastcyber.com/pricing).
Without a key, each client address has a smaller hourly credit budget than a key has. The pricing page lists both limits.

## Credits

Each operation has a price in credits, and some operations are free. The method comment of an operation states its price.

After each response that carries the rate-limit headers, the client keeps the reading:

```javascript
await api.cveLookup({ cve_id: "CVE-2021-44228" });
console.log(api.lastRateLimit?.remaining, api.lastRateLimit?.resetHuman);

const watched = new ContrastAPI({
  onRateLimit: (info) => console.log(info.remaining, "of", info.limit, "credits left"),
});
```

`RateLimitInfo` holds `limit`, `remaining`, `resetAt` (a `Date`) and `resetHuman`.
`lastRateLimit` is `null` until a response has carried the headers.
An exception that `onRateLimit` throws is ignored.

## Errors

Every error extends `ContrastAPIError`. The server answers an error as `{"error": {"code", "message"}}`, and the client reads both.

| Class | When |
| --- | --- |
| `BadRequestError` | HTTP 400 |
| `AuthenticationError` | HTTP 401 |
| `NotFoundError` | HTTP 404 |
| `RateLimitError` | HTTP 429 |
| `UpstreamError` | HTTP 502, 503 or 504 |
| `ContrastAPIError` | any other status outside 200-399; a 2xx body that is not a UTF-8 JSON object or array; a body over 16 MiB; an answer whose `Content-Encoding` is not `identity` |
| `APIConnectionError` | no usable answer: network failure or refused redirect (`status` is `null`) |
| `APITimeoutError` | the request ran past `timeoutMs`; it extends `APIConnectionError` |

An error has these fields: `status`, `code`, `retryAfter` (seconds from the `Retry-After` header, at most 3600, or `null`) and `rateLimit` (a `RateLimitInfo` or `null`).
The message, the code and `rateLimit.resetHuman` are stripped of control characters (C0, DEL and C1), format characters (Unicode Cf, such as U+202E) and lone surrogates. The message is cut to 300 characters.

```javascript
import { ContrastAPI, NotFoundError, RateLimitError } from "contrastapi";

try {
  await api.cveLookup({ cve_id: "CVE-9999-0000" });
} catch (err) {
  if (err instanceof NotFoundError) console.log(err.status, err.code, err.message);
  else if (err instanceof RateLimitError) console.log("retry after", err.retryAfter);
  else throw err;
}
```

A wrong argument throws `TypeError` before any request. A path or query value must be a string, a finite number, a boolean or a bigint. A query value of `null` or `undefined` is left out.
A body must not hold a non-finite number, a function, a symbol or an object that is neither plain nor an array. A `Date` is written as its ISO string.

## Retries

| Option | Default | Meaning |
| --- | --- | --- |
| `upstreamBusyRetries` | 2 | retries after a 503 with the code `upstream_busy` or `raw_body_busy` |
| `maxRetries` | 0 | retries after a 429; off unless you set it |
| `maxRetryWaitMs` | 60000 | a finite number >= 0; the client does not retry when the wait is longer than this many milliseconds |

The wait is the `Retry-After` header, in seconds. A busy 503 without the header waits one second. A 429 without the header is not retried.

## Configuration

```javascript
const api = new ContrastAPI({
  apiKey: "...",                          // default: CONTRASTAPI_API_KEY
  baseUrl: "https://api.contrastcyber.com", // default
  trustHost: false,                       // true sends the key to other hosts
  timeoutMs: 30000,                       // default; clamped to 1000-120000
  maxRetries: 0,
  upstreamBusyRetries: 2,
  maxRetryWaitMs: 60000,
  fetch: globalThis.fetch,                // swap in a test double
  onRateLimit: (info) => {},
});
```

The client sends `User-Agent: contrastapi-node/<version>`.

The client sends `Accept-Encoding: identity`. It refuses an answer with any other `Content-Encoding` and does not read its body.
`fetch` would decode a compressed body before the 16 MiB cap could count its bytes.

## Regenerating the methods

The methods come from `sdk/openapi.json`, the output of `make -s openapi` in the server repository.
After a new document, run this from the root of the repository that holds `sdk/`:

```bash
python3 sdk/gen/gen_sdk.py          # rewrite the generated files
python3 sdk/gen/gen_sdk.py --check  # report a difference, exit 1
```

## Upgrading from 1.x

Version 1.x called `/v1/...` paths. The OpenAPI document of the current server has no such path.
Version 2.0.0 is a rewrite. The [CHANGELOG](https://github.com/UPinar/contrastapi-clients/blob/master/sdk/node/CHANGELOG.md) in the source repository, [UPinar/contrastapi-clients](https://github.com/UPinar/contrastapi-clients), lists the breaking changes.

## License

MIT. The LICENSE file is part of the package.

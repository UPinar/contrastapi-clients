# Changelog

## 2.0.0 — Unreleased

Rewritten as a client of the REST API.

- The client calls the REST API. The operation table and the typed methods are generated from `sdk/openapi.json`, the OpenAPI document of the server.
- `call(operationId, args)` runs an operation by its id. `request(method, path, options)` sends a raw JSON request.
- `lastRateLimit` keeps the credit reading of the last response that carried one. The `onRateLimit` option is called with each reading.
- A 503 with the code `upstream_busy` or `raw_body_busy` is retried twice by default. A 429 is retried only when `maxRetries` is set and the answer has a `Retry-After` header.
- `/image_inspect` has no method: the SDK sends JSON bodies only.
- The client sends `Accept-Encoding: identity`. An answer with any other `Content-Encoding` is a `ContrastAPIError`, and its body is not read.
- Error text loses Unicode format characters (Cf) and lone surrogates, as well as control characters.

Breaking changes:

- The namespaces (`api.cve`, `api.domain`, ...) are gone, and so are `status()` and `usage()`. Each operation is one method on the client, named after its operation: `api.cveLookup({ cve_id })`.
- A method takes one object whose keys are the REST parameter names, not positional arguments.
- Version 1.x threw a plain `Error` with a `status` property. Version 2.0.0 throws `ContrastAPIError` or one of its subclasses: `BadRequestError`, `AuthenticationError`, `NotFoundError`, `RateLimitError`, `UpstreamError`, `APIConnectionError` and `APITimeoutError`. They keep `status` and add `code`, `retryAfter` and `rateLimit`.
- The package is an ES module and needs Node.js 20.19 or newer. It has no default export, and `ContrastAPI` is a class: call it with `new`. `require("contrastapi")` returns the module namespace, not the client, so write `const { ContrastAPI } = require("contrastapi")` or `import { ContrastAPI } from "contrastapi"`.
- The option `timeout` is now `timeoutMs`, in milliseconds. The option `allowInsecure` is gone. The client ignores an option it does not know, so a leftover `timeout` or `allowInsecure` has no effect.
- The TypeScript response types (`CveResponse` and the others) are gone. Each method returns `Promise<unknown>`. The argument types are new.

Key policy:

- The key comes from the `apiKey` option or the `CONTRASTAPI_API_KEY` environment variable.
- The key goes only to `api.contrastcyber.com`, `localhost`, `127.0.0.1` and `[::1]`, unless `trustHost` is true.
- `baseUrl` must use https, except for `localhost`, `127.0.0.1` and `[::1]`. Redirects are not followed: any 3xx answer is an `APIConnectionError`.
- The key is kept only when it will be sent.
- A request URL that leaves `baseUrl` throws `TypeError` before any request.
- A request path with a `.` or `..` segment throws `TypeError` before any request. `%2e` counts as a dot. `baseUrl` must not hold such a segment either.

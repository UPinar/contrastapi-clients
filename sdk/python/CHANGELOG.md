# Changelog

## 2.0.0 (2026-11-13)

Rewritten as a client of the REST API.

- The client calls the REST API. The operation table and the typed methods are generated from `sdk/openapi.json`, the OpenAPI document of the server.
- `call(operation_id, args)` runs an operation by its id. `request(method, path, query=, body=)` sends a raw JSON request.
- `last_rate_limit` keeps the credit reading of the last response that carried one. The `on_rate_limit` option is called with each reading.
- A 503 with the code `upstream_busy` or `raw_body_busy` is retried twice by default. A 429 is retried only when `max_retries` is set and the answer has a `Retry-After` header.
- `AsyncContrastAPI` has the same operation methods, `call()` and `request()`, as `ContrastAPI`. Each one is a coroutine, and the client closes with `aclose()`.
- `/image_inspect` has no method: the SDK sends JSON bodies only.
- The client sends `Accept-Encoding: identity`. An answer with any other `Content-Encoding` is a `ContrastAPIError`, and its body is not read.
- Error text loses Unicode format characters (Cf) and lone surrogates, as well as control characters.
- `AsyncContrastAPI` bounds the whole exchange by `timeout`, the response headers included. In `ContrastAPI`, `timeout` bounds each read and the body, not the header phase as a whole.

Breaking changes:

- The client core is replaced. The namespaces (`client.cve`, `client.domain`, ...) are gone, and so are `status()` and `usage()`. Each operation is one method on the client, named after its operation: `client.cve_lookup(cve_id=...)`, with keyword arguments only.
- The shortcuts (`triage_ioc`, `audit_full`, `enrich_batch`) are gone. So are the modules `contrastapi.client`, `contrastapi.models`, `contrastapi.namespaces` and `contrastapi.shortcuts`.
- The errors are `ContrastAPIError` and its subclasses `BadRequestError`, `AuthenticationError`, `NotFoundError`, `RateLimitError`, `UpstreamError`, `APIConnectionError` and `APITimeoutError`. `InvalidArgumentError`, `AuthRequiredError`, `TierLimitError`, `UpstreamTimeoutError`, `TransportError` are gone. The error attribute `status_code` is now `status`, and `retry_after_seconds` is now `retry_after`. The attributes `upgrade_url`, `docs_url` and `extras` are gone. The attribute `rate_limit` is new.
- The API key is the `api_key=` keyword only, not a positional argument. `allow_insecure` is gone: https is required, except for `localhost`, `127.0.0.1` and `[::1]`.

Key policy:

- The key comes from `api_key` or the `CONTRASTAPI_API_KEY` environment variable.
- The key goes only to `api.contrastcyber.com`, `localhost`, `127.0.0.1` and `[::1]`, unless `trust_host` is true.
- Redirects are not followed: any 3xx answer is an `APIConnectionError`.
- The key is kept only when it will be sent.
- A request URL that leaves `base_url` raises `ValueError` before any request.
- A request path with a `.` or `..` segment raises `ValueError` before any request. `%2e` counts as a dot. `base_url` must not hold such a segment either.

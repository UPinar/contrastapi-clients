# ContrastAPI Python SDK

Official Python SDK for [ContrastAPI](https://api.contrastcyber.com), security intelligence for developers and AI agents.

## Install

```bash
pip install contrastapi
```

It needs Python 3.10 or newer. The only dependency is `httpx>=0.25,<1.0`.

## Quickstart

```python
from contrastapi import ContrastAPI

with ContrastAPI() as client:
    # A typed method for one operation of the REST API.
    cve = client.cve_lookup(cve_id="CVE-2021-44228")

    # The same operation by its id.
    same = client.call("cve_lookup", {"cve_id": "CVE-2021-44228"})
```

Each method takes keyword arguments named like the parameters of the REST API.
The client checks the names and the required values before it sends anything.
A call with an unknown name or a missing required value fails with `TypeError` and spends no credit.
A method returns the parsed JSON body.

The methods and their argument types are generated from the OpenAPI document of the server.
The package is typed (`py.typed`).

### Raw requests

`request()` sends a request to any path. It uses the same key policy, errors, retries and credit reading as the methods.

```python
health = client.request("GET", "/health")
found = client.request("GET", "/cve_search", query={"product": "apache"})
bulk = client.request("POST", "/cve_lookup_bulk", body={"cve_ids": ["CVE-2021-44228"]})
```

`request()` sends a JSON body or none. It cannot send raw bytes.

### Not in the SDK

`/image_inspect` takes a raw image body (`application/octet-stream`). The SDK sends JSON bodies only, so it has no method for it, and `request()` is no way around that. Call that endpoint with `httpx` or another HTTP client.

### Async

`AsyncContrastAPI` has the same operation methods, `call()` and `request()`. Each one is a coroutine.

```python
import asyncio
from contrastapi import AsyncContrastAPI

async def main():
    async with AsyncContrastAPI() as client:
        cve = await client.cve_lookup(cve_id="CVE-2021-44228")

asyncio.run(main())
```

Close a client with `close()` (sync) or `await aclose()` (async), or use `with` / `async with`.

## API key

```python
client = ContrastAPI(api_key="your-api-key")
```

Without `api_key`, the client reads the `CONTRASTAPI_API_KEY` environment variable and trims ASCII white space from both ends. An empty string sends no key.
A key may hold only printable ASCII without spaces; any other key raises `ValueError`, and the message does not repeat it.
The client keeps the key only when it will send it.

The client sends the key in the `X-API-Key` header. It sends it only to `api.contrastcyber.com`, `localhost`, `127.0.0.1` and `[::1]`. For any other host, pass `trust_host=True`.

`base_url` must use https. Plain http is accepted only for `localhost`, `127.0.0.1` and `[::1]`, written that way.
`base_url` must not hold user info, a query, a fragment, a backslash, a space or an ASCII control character.
Its path must not hold a `.` or `..` segment.
The client does not follow redirects: any 3xx answer fails the call with `APIConnectionError("redirect refused")`.
Before each request, the client checks that the URL keeps the scheme, host and port of `base_url` and stays under its path.
A URL that leaves it raises `ValueError` and sends nothing.
A request path with a `.` or `..` segment also raises `ValueError` and sends nothing.
This covers a raw path and a path value of a method, such as `cve_id=".."`.
In a raw path, a dot written as `%2e` or `%2E` counts as a dot.
A method encodes `%` in a path value, so a value of `%2e` is sent.
The query is not checked.
The key is not shown in `repr()` of the client.

Get a key at [api.contrastcyber.com/pricing](https://api.contrastcyber.com/pricing).
Without a key, each client address has a smaller hourly credit budget than a key has. The pricing page lists both limits.

## Credits

Each operation has a price in credits, and some operations are free. The docstring of an operation method states its price.

After each response that carries the rate-limit headers, the client keeps the reading:

```python
client.cve_lookup(cve_id="CVE-2021-44228")
info = client.last_rate_limit
if info is not None:
    print(info.remaining, info.reset_human)

watched = ContrastAPI(on_rate_limit=lambda info: print(info.remaining, "of", info.limit, "credits left"))
```

`RateLimitInfo` is a frozen dataclass with `limit`, `remaining`, `reset_at` (a UTC `datetime`) and `reset_human`.
`last_rate_limit` is `None` until a response has carried the headers.
An exception that `on_rate_limit` raises is ignored.

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
| `APIConnectionError` | no usable answer: network failure or refused redirect (`status` is `None`) |
| `APITimeoutError` | `ContrastAPI`: a read ran past `timeout`, or the body was still arriving `timeout` seconds after the request started. `AsyncContrastAPI`: the whole exchange ran past `timeout`. It extends `APIConnectionError` |

An error has these attributes: `message`, `status`, `code`, `retry_after` (seconds from the `Retry-After` header, at most 3600, or `None`) and `rate_limit` (a `RateLimitInfo` or `None`).
The message, the code and `rate_limit.reset_human` are stripped of control characters (C0, DEL and C1), format characters (Unicode Cf, such as U+202E) and lone surrogates. The message is cut to 300 characters.
An error holds neither the request nor the response, and its text never repeats the key.

```python
from contrastapi import NotFoundError, RateLimitError

try:
    client.cve_lookup(cve_id="CVE-9999-0000")
except NotFoundError as err:
    print(err.status, err.code, err.message)
except RateLimitError as err:
    print("retry after", err.retry_after)
```

A wrong argument raises `TypeError` (wrong type) or `ValueError` (wrong value) before any request.
A path or query value must be a `str`, an `int`, a finite `float` or a `bool`; a float is written as JavaScript writes it (`7.0` is `7`). A query value of `None` is left out.
A body is written with `json.dumps(allow_nan=False)` before any request. A NaN or an infinity raises `ValueError`.
A value that JSON has no form for raises `TypeError`. Examples are a `datetime`, a `set`, `bytes` and a `Decimal`; write a `datetime` as an ISO string yourself.
A tuple is written as a list.
A body argument of `None` is left out, like a query value. A `None` nested inside a body value is written as `null`.

## Retries

| Option | Default | Meaning |
| --- | --- | --- |
| `upstream_busy_retries` | 2 | retries after a 503 with the code `upstream_busy` or `raw_body_busy` |
| `max_retries` | 0 | retries after a 429; off unless you set it |
| `max_retry_wait` | 60.0 | a finite number >= 0; the client does not retry when the wait is longer than this many seconds |

The wait is the `Retry-After` header, in seconds. A busy 503 without the header waits one second. A 429 without the header is not retried.

## Configuration

```python
client = ContrastAPI(
    api_key="...",                              # default: CONTRASTAPI_API_KEY
    base_url="https://api.contrastcyber.com",   # default
    trust_host=False,                           # True sends the key to other hosts
    timeout=30.0,                               # seconds; default; clamped to 1.0-120.0
    max_retries=0,
    upstream_busy_retries=2,
    max_retry_wait=60.0,
    on_rate_limit=None,
)
```

The client sends `User-Agent: contrastapi-python/<version>`.

The client sends `Accept-Encoding: identity`. It refuses an answer with any other `Content-Encoding` and does not read its body.
It reads the raw bytes, so httpx decodes nothing.

In `ContrastAPI`, `timeout` bounds each read, not the header phase as a whole. A server that sends its headers slowly, each read within `timeout`, can hold a call longer.
`AsyncContrastAPI` bounds the whole exchange by `timeout`, the headers included.

The client uses httpx's default `trust_env=True`, so proxy environment variables (`HTTPS_PROXY` and the like) apply.

## Regenerating the methods

The methods come from `sdk/openapi.json`, the output of `make -s openapi` in the server repository.
After a new document, run this from the root of the repository that holds `sdk/`:

```bash
python3 sdk/gen/gen_sdk.py          # rewrite the generated files
python3 sdk/gen/gen_sdk.py --check  # report a difference, exit 1
```

## Upgrading from 1.x

Version 1.x called `/v1/...` paths. The OpenAPI document of the current server has no such path.
Version 2.0.0 is a rewrite. The [CHANGELOG](https://github.com/UPinar/contrastapi-clients/blob/master/sdk/python/CHANGELOG.md) in the source repository, [UPinar/contrastapi-clients](https://github.com/UPinar/contrastapi-clients), lists the breaking changes.

## License

MIT. The LICENSE file is part of the package.

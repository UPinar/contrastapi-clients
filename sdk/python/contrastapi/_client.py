"""REST client of the ContrastAPI SDK.

`ContrastAPI` (sync) and `AsyncContrastAPI` (async) share `_ClientCore`. The
core checks the arguments, builds the URL and turns an answer into a result or
an error. The two classes differ in how they send a request, sleep and close.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, NamedTuple
from urllib.parse import quote, urlsplit

import httpx

from ._operations import OPERATIONS, _AsyncMethods, _SyncMethods
from ._version import __version__
from .exceptions import (
    APIConnectionError,
    APITimeoutError,
    ContrastAPIError,
    _clean_text,
    _error_class_for_status,
    _parse_json,
    _parse_error_body,
)

DEFAULT_BASE_URL = "https://api.contrastcyber.com"
TRUSTED_HOST = "api.contrastcyber.com"
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
API_KEY_ENV_VAR = "CONTRASTAPI_API_KEY"
DEFAULT_TIMEOUT = 30.0
MIN_TIMEOUT = 1.0
MAX_TIMEOUT = 120.0
DEFAULT_MAX_RETRY_WAIT = 60.0
DEFAULT_UPSTREAM_BUSY_RETRIES = 2
DEFAULT_RETRY_WAIT_SECONDS = 1
MAX_RETRY_AFTER_SECONDS = 3600
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_HEADER_INTEGER = 2**53 - 1
MAX_RESET_UNIX_SECONDS = 253402300799
USER_AGENT = f"contrastapi-python/{__version__}"

_BUSY_CODES = frozenset({"upstream_busy", "raw_body_busy"})
_PATH_SAFE_CHARS = "!$&'()*+,;=:@"
_ASCII_DIGITS = re.compile("[0-9]+")
_ASCII_SPACE = " \t\n\v\f\r"
_METHOD_CHARS = re.compile("[A-Za-z]+")
_URL_UNSAFE_CHARS = re.compile(r"[\x00-\x20\x7f\\]")
_RAW_PATH_UNSAFE_CHARS = re.compile(r"[\x00-\x20\x7f\\?#]")
_DOT_SEGMENT = re.compile(r"(?:\.|%2e){1,2}", re.IGNORECASE)

_sleep = time.sleep
_monotonic = time.monotonic


async def _async_sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


@dataclass(frozen=True)
class RateLimitInfo:
    """RateLimitInfo is the rate-limit state of the last answer that carried one."""

    limit: int
    remaining: int
    reset_at: datetime
    reset_human: str


def _parse_retry_after(value: object) -> int | None:
    """_parse_retry_after reads whole seconds and clamps them to [0, 3600].

    Anything else gives None: a bool, a float, a sign, a fraction or text.
    A long digit string is clamped without int(), because int() refuses past 4300 digits.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        seconds = value
    elif isinstance(value, str) and _ASCII_DIGITS.fullmatch(value):
        digits = value.lstrip("0") or "0"
        if len(digits) > len(str(MAX_RETRY_AFTER_SECONDS)):
            return MAX_RETRY_AFTER_SECONDS
        seconds = int(digits)
    else:
        return None
    if seconds < 0:
        return None
    return min(seconds, MAX_RETRY_AFTER_SECONDS)


def _header_int(text: str | None) -> int | None:
    """_header_int reads digits up to MAX_HEADER_INTEGER. Node reads a count of that size exactly."""
    if text is None or not _ASCII_DIGITS.fullmatch(text):
        return None
    try:
        value = int(text)
    except ValueError:
        return None
    return value if value <= MAX_HEADER_INTEGER else None


def _parse_rate_limit(headers: httpx.Headers) -> RateLimitInfo | None:
    """_parse_rate_limit returns None unless all four X-RateLimit-* headers are valid.

    MAX_RESET_UNIX_SECONDS is 9999-12-31T23:59:59Z. It is the last second that a datetime holds.
    """
    limit = _header_int(headers.get("X-RateLimit-Limit"))
    remaining = _header_int(headers.get("X-RateLimit-Remaining"))
    reset = _header_int(headers.get("X-RateLimit-Reset-Machine"))
    human = headers.get("X-RateLimit-Reset-Human")
    if limit is None or remaining is None or reset is None or reset > MAX_RESET_UNIX_SECONDS or not human:
        return None
    return RateLimitInfo(limit=limit, remaining=remaining,
                         reset_at=datetime.fromtimestamp(reset, tz=timezone.utc),
                         reset_human=_clean_text(human))


def _clamp_timeout(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return DEFAULT_TIMEOUT
    return max(MIN_TIMEOUT, min(float(value), MAX_TIMEOUT))


def _check_retry_count(name: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an int")
    if value < 0:
        raise ValueError(f"{name} must be >= 0")
    return value


def _check_wait(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("max_retry_wait must be an int or a float")
    if not math.isfinite(value) or value < 0:
        raise ValueError("max_retry_wait must be a finite number >= 0")
    return float(value)


def _parse_base_url(base_url: object) -> tuple[str, str]:
    """_parse_base_url returns the base URL without trailing slashes, and its host.

    https is required. http is allowed only for a localhost name as written.
    The function refuses user info, a query, a fragment, a backslash, a space
    and an ASCII control character. It refuses a "." or ".." path segment.
    It reads the host as written.
    """
    if not isinstance(base_url, str):
        raise TypeError("base_url must be a string")
    if _URL_UNSAFE_CHARS.search(base_url):
        raise ValueError("base_url must not hold whitespace, control characters or a backslash")
    if "?" in base_url or "#" in base_url:
        raise ValueError("base_url must not hold a query or a fragment")
    trimmed = base_url.rstrip("/")
    try:
        parts = urlsplit(trimmed)
        host = parts.hostname
        parts.port
    except ValueError:
        raise ValueError("base_url does not parse") from None
    if not host:
        raise ValueError("base_url has no host")
    if "@" in parts.netloc:
        raise ValueError("base_url must not hold user info")
    if _has_dot_segment(parts.path):
        raise ValueError("base_url path must not hold a . or .. segment")
    if parts.scheme == "https" or (parts.scheme == "http" and host in LOCAL_HOSTS):
        return trimmed, host
    raise ValueError("base_url must use https (http only for localhost)")


def _resolve_key(api_key: object) -> str:
    if api_key is None:
        api_key = os.environ.get(API_KEY_ENV_VAR, "").strip(_ASCII_SPACE)
    if not isinstance(api_key, str):
        raise TypeError("api_key must be a string")
    if any(not (" " < ch < "\x7f") for ch in api_key):
        raise ValueError("api_key holds a character an HTTP header cannot carry")
    return api_key


def _number_text(value: float) -> str:
    """_number_text writes a float the way JavaScript's String(number) does.

    The Node SDK writes numbers that way, so one call gives one URL in both:
    7.0 is "7", 5e-07 is "5e-7" and 1e21 is "1e+21". repr() gives the same
    shortest digits as JavaScript. Only the layout differs.
    """
    if not math.isfinite(value):
        raise ValueError("a path or query number must be finite")
    if value == 0:
        return "0"
    sign, digit_tuple, exponent = Decimal(repr(value)).as_tuple()
    point = len(digit_tuple) + int(exponent)
    digits = "".join(map(str, digit_tuple)).rstrip("0")
    count = len(digits)
    if count <= point <= 21:
        text = digits + "0" * (point - count)
    elif 0 < point <= 21:
        text = digits[:point] + "." + digits[point:]
    elif -6 < point <= 0:
        text = "0." + "0" * -point + digits
    else:
        mantissa = digits[0] + ("." + digits[1:] if count > 1 else "")
        text = f"{mantissa}e{'+' if point > 0 else '-'}{abs(point - 1)}"
    return "-" + text if sign else text


def _scalar_text(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return str(value)
    if isinstance(value, int):
        return str(int(value))
    if isinstance(value, float):
        return _number_text(float(value))
    raise TypeError(f"a path or query value must be a string, number or bool, not {type(value).__name__}")


def _query_string(pairs: Iterable[tuple[object, Any]]) -> str:
    """_query_string writes the name=value pairs. A space becomes %20, and a None value is left out."""
    parts = []
    for name, value in pairs:
        if not isinstance(name, str):
            raise TypeError("a query name must be a string")
        if value is not None:
            parts.append(f"{quote(name, safe='')}={quote(_scalar_text(value), safe='')}")
    return "&".join(parts)


def _json_body(body: object) -> bytes:
    return json.dumps(body, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _is_identity_encoded(value: str | None) -> bool:
    """_is_identity_encoded tells whether a Content-Encoding value is absent or "identity".

    The client asks for identity and reads the raw bytes, so it never decodes a body.
    A body in any other encoding is refused unread.
    """
    return value is None or value.lower() == "identity"


def _has_dot_segment(path: str) -> bool:
    """_has_dot_segment tells whether path holds a "." or ".." segment.

    A dot written as %2e, in any case, counts as a dot. The URL parser of fetch reads it
    as a dot, and httpx does not. Refusing every spelling keeps the two SDKs alike.
    """
    return any(_DOT_SEGMENT.fullmatch(segment) for segment in path.split("/"))


def _is_under_base(url: str, base: str) -> bool:
    """_is_under_base tells whether url has the origin of base and a path under the path of base.

    Both go through httpx.URL, the parser that the request goes through.
    The paths are compared percent-encoded, the way fetch compares them.
    """
    built = httpx.URL(url.partition("?")[0])
    root = httpx.URL(base)
    base_path = root.raw_path.decode("ascii").rstrip("/")
    path = built.raw_path.decode("ascii")
    return ((built.scheme, built.host, built.port) == (root.scheme, root.host, root.port)
            and path.startswith(base_path + "/"))


def _decode_success(status: int, content: bytes) -> Any:
    try:
        body = _parse_json(content)
    except (ValueError, RecursionError):
        body = None
    if not isinstance(body, (dict, list)):
        raise ContrastAPIError(f"response is not a JSON object or array (HTTP {status})", status=status)
    return body


class _Secret:
    """_Secret holds the API key so that repr() and vars() never show it."""

    __slots__ = ("value",)

    def __init__(self, value: str) -> None:
        self.value = value

    def __repr__(self) -> str:
        return "<hidden>"


class _RequestParts(NamedTuple):
    method: str
    url: str
    body: bytes | None


class _RetryBudget:
    __slots__ = ("busy", "rate")

    def __init__(self, busy: int, rate: int) -> None:
        self.busy = busy
        self.rate = rate


class _ResponseBuffer:
    """_ResponseBuffer collects a streamed body within MAX_RESPONSE_BYTES and a deadline.

    httpx bounds each read, not the whole answer. The deadline bounds the body
    the way the one timeout signal of the Node SDK does.
    The body comes from iter_raw(), so httpx decodes nothing. A transport that built its
    answer from bytes has read that answer already, and httpx then holds it in content.
    """

    def __init__(self, deadline: float) -> None:
        self.deadline = deadline
        self.data = bytearray()
        self.too_large = False

    def add(self, chunk: bytes) -> bool:
        """add keeps the chunk and says whether to read on. Past the deadline it raises."""
        if _monotonic() > self.deadline:
            raise APITimeoutError("request timed out")
        self.data += chunk
        self.too_large = len(self.data) > MAX_RESPONSE_BYTES
        return not self.too_large


def _transport_error(exc: httpx.HTTPError) -> ContrastAPIError:
    """_transport_error names the failure by its class. It does not copy the exception text."""
    if isinstance(exc, httpx.TimeoutException):
        return APITimeoutError("request timed out")
    return APIConnectionError(f"connection failed ({type(exc).__name__})")


class _ClientCore:
    """_ClientCore holds the settings and every step that does not send or sleep."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        trust_host: bool = False,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = 0,
        max_retry_wait: float = DEFAULT_MAX_RETRY_WAIT,
        upstream_busy_retries: int = DEFAULT_UPSTREAM_BUSY_RETRIES,
        on_rate_limit: Callable[[RateLimitInfo], object] | None = None,
        transport: Any = None,
    ) -> None:
        self._base_url, host = _parse_base_url(base_url)
        key = _resolve_key(api_key)
        trusted = host == TRUSTED_HOST or host in LOCAL_HOSTS or trust_host is True
        self.__api_key = _Secret(key) if key and trusted else None
        self._timeout = _clamp_timeout(timeout)
        self._max_retries = _check_retry_count("max_retries", max_retries)
        self._upstream_busy_retries = _check_retry_count("upstream_busy_retries", upstream_busy_retries)
        self._max_retry_wait = _check_wait(max_retry_wait)
        if on_rate_limit is not None and not callable(on_rate_limit):
            raise TypeError("on_rate_limit must be callable")
        self._on_rate_limit = on_rate_limit
        self._last_rate_limit: RateLimitInfo | None = None
        self._client = self._make_client(transport)

    def _make_client(self, transport: Any) -> Any:
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"{type(self).__name__}(base_url={self._base_url!r})"

    @property
    def last_rate_limit(self) -> RateLimitInfo | None:
        return self._last_rate_limit

    def _url(self, path: str, pairs: Iterable[tuple[str, Any]]) -> str:
        """_url is the one place that builds a URL, for table operations and raw requests alike.

        It raises ValueError for a path with a dot segment. It raises ValueError for a URL
        that leaves base_url. So no path sends the key elsewhere.
        """
        if _has_dot_segment(path):
            raise ValueError("request path must not hold a . or .. segment")
        query = _query_string(pairs)
        url = self._base_url + path + ("?" + query if query else "")
        if not _is_under_base(url, self._base_url):
            raise ValueError("request URL is not under base_url")
        return url

    def _prepare(self, operation_id: object, args: object) -> _RequestParts:
        """_prepare checks the arguments of an operation. Nothing is sent before the check passes."""
        if not isinstance(operation_id, str):
            raise TypeError("operation_id must be a string")
        spec = OPERATIONS.get(operation_id)
        if spec is None:
            raise ValueError(f"unknown operation {operation_id!r}")
        if args is None:
            args = {}
        if not isinstance(args, Mapping):
            raise TypeError("args must be a mapping")
        params = spec["params"]
        names = [param["name"] for param in params]
        for key in args:
            if key not in names:
                raise TypeError(f"{operation_id}() got an unexpected argument {key!r}")
        path = spec["path"]
        pairs: list[tuple[str, Any]] = []
        body: dict[str, Any] = {}
        has_body = False
        for param in params:
            name = param["name"]
            place = param["in"]
            value = args.get(name)
            if place == "body":
                has_body = True
            if value is None:
                if param["required"]:
                    raise TypeError(f"{operation_id}() missing required argument {name!r}")
                continue
            if place == "path":
                path = path.replace("{" + name + "}",
                                    quote(_scalar_text(value), safe=_PATH_SAFE_CHARS))
            elif place == "query":
                pairs.append((name, value))
            else:
                body[name] = value
        return _RequestParts(spec["method"], self._url(path, pairs), _json_body(body) if has_body else None)

    def _prepare_raw(self, method: str, path: str, query: Mapping[str, Any] | None,
                     body: Any) -> _RequestParts:
        if not isinstance(method, str):
            raise TypeError("method must be a string")
        if not _METHOD_CHARS.fullmatch(method):
            raise ValueError("method must be ASCII letters only")
        if not isinstance(path, str):
            raise TypeError("path must be a string")
        if not path.startswith("/"):
            raise ValueError("path must start with '/'")
        if _RAW_PATH_UNSAFE_CHARS.search(path):
            raise ValueError("path must not hold whitespace, control characters, a backslash, ? or #")
        if query is not None and not isinstance(query, Mapping):
            raise TypeError("query must be a mapping")
        pairs = list(query.items()) if query is not None else []
        return _RequestParts(method.upper(), self._url(path, pairs),
                             None if body is None else _json_body(body))

    def _build_request(self, call: _RequestParts) -> httpx.Request:
        headers = {"Accept": "application/json", "Accept-Encoding": "identity", "User-Agent": USER_AGENT}
        secret = self.__api_key
        if secret is not None:
            headers["X-API-Key"] = secret.value
        if call.body is not None:
            headers["Content-Type"] = "application/json"
        request: httpx.Request = self._client.build_request(call.method, call.url, headers=headers,
                                                            content=call.body)
        return request

    def _note_rate_limit(self, headers: httpx.Headers) -> RateLimitInfo | None:
        info = _parse_rate_limit(headers)
        if info is not None:
            self._last_rate_limit = info
            if self._on_rate_limit is not None:
                try:
                    self._on_rate_limit(info)
                except Exception:
                    pass
        return info

    def _finish(self, status: int, headers: httpx.Headers, content: bytes) -> Any:
        """_finish turns one answer into the parsed body or raises its error."""
        info = self._note_rate_limit(headers)
        if 300 <= status < 400:
            raise APIConnectionError("redirect refused")
        if not 200 <= status < 300:
            code, message = _parse_error_body(content)
            raise _error_class_for_status(status)(
                message if message is not None else f"HTTP {status}",
                status=status,
                code=code,
                retry_after=_parse_retry_after(headers.get("Retry-After")),
                rate_limit=info,
            )
        return _decode_success(status, content)

    def _check_read(self, status: int, headers: httpx.Headers, buffer: _ResponseBuffer) -> None:
        """_check_read raises for an encoded body or a body past MAX_RESPONSE_BYTES."""
        if not _is_identity_encoded(headers.get("Content-Encoding")):
            raise ContrastAPIError("response has a Content-Encoding other than identity", status=status,
                                   rate_limit=self._note_rate_limit(headers))
        if buffer.too_large:
            raise self._too_large_error(status, headers)

    def _too_large_error(self, status: int, headers: httpx.Headers) -> ContrastAPIError:
        """_too_large_error is the error for a body past MAX_RESPONSE_BYTES. It keeps the rate limit."""
        info = self._note_rate_limit(headers)
        return ContrastAPIError(f"response body exceeds {MAX_RESPONSE_BYTES} bytes", status=status,
                                rate_limit=info)

    def _retry_wait(self, err: ContrastAPIError, budget: _RetryBudget) -> float | None:
        """_retry_wait gives the seconds to wait before a retry, or None to raise."""
        wait = err.retry_after
        if err.status == 503 and err.code in _BUSY_CODES and budget.busy > 0:
            budget.busy -= 1
            if wait is None:
                wait = DEFAULT_RETRY_WAIT_SECONDS
        elif err.status == 429 and budget.rate > 0 and wait is not None:
            budget.rate -= 1
        else:
            return None
        if wait > self._max_retry_wait:
            return None
        return float(wait)


class ContrastAPI(_SyncMethods, _ClientCore):
    """ContrastAPI is the synchronous client."""

    _client: httpx.Client

    def _make_client(self, transport: httpx.BaseTransport | None) -> httpx.Client:
        return httpx.Client(transport=transport, timeout=self._timeout, follow_redirects=False)

    def call(self, operation_id: str, args: Mapping[str, Any] | None = None) -> Any:
        return self._execute(self._prepare(operation_id, args))

    def request(self, method: str, path: str, *, query: Mapping[str, Any] | None = None,
                body: Any = None) -> Any:
        return self._execute(self._prepare_raw(method, path, query, body))

    def _execute(self, call: _RequestParts) -> Any:
        budget = _RetryBudget(self._upstream_busy_retries, self._max_retries)
        while True:
            status, headers, content = self._transmit(call)
            try:
                return self._finish(status, headers, content)
            except ContrastAPIError as err:
                wait = self._retry_wait(err, budget)
                if wait is None:
                    raise
            _sleep(wait)

    def _transmit(self, call: _RequestParts) -> tuple[int, httpx.Headers, bytes]:
        request = self._build_request(call)
        buffer = _ResponseBuffer(_monotonic() + self._timeout)
        failure: ContrastAPIError | None = None
        try:
            response = self._client.send(request, stream=True)
            try:
                if _is_identity_encoded(response.headers.get("Content-Encoding")):
                    if response.is_stream_consumed:
                        buffer.add(response.content)
                    else:
                        for chunk in response.iter_raw():
                            if not buffer.add(chunk):
                                break
            finally:
                response.close()
        except httpx.HTTPError as exc:
            failure = _transport_error(exc)
        if failure is not None:
            raise failure
        self._check_read(response.status_code, response.headers, buffer)
        return response.status_code, response.headers, bytes(buffer.data)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> ContrastAPI:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


class AsyncContrastAPI(_AsyncMethods, _ClientCore):
    """AsyncContrastAPI is the asynchronous client."""

    _client: httpx.AsyncClient

    def _make_client(self, transport: httpx.AsyncBaseTransport | None) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=transport, timeout=self._timeout, follow_redirects=False)

    async def call(self, operation_id: str, args: Mapping[str, Any] | None = None) -> Any:
        return await self._execute(self._prepare(operation_id, args))

    async def request(self, method: str, path: str, *, query: Mapping[str, Any] | None = None,
                      body: Any = None) -> Any:
        return await self._execute(self._prepare_raw(method, path, query, body))

    async def _execute(self, call: _RequestParts) -> Any:
        budget = _RetryBudget(self._upstream_busy_retries, self._max_retries)
        while True:
            status, headers, content = await self._transmit(call)
            try:
                return self._finish(status, headers, content)
            except ContrastAPIError as err:
                wait = self._retry_wait(err, budget)
                if wait is None:
                    raise
            await _async_sleep(wait)

    async def _transmit(self, call: _RequestParts) -> tuple[int, httpx.Headers, bytes]:
        """_transmit bounds the whole exchange by the timeout, the response headers included."""
        request = self._build_request(call)
        buffer = _ResponseBuffer(_monotonic() + self._timeout)
        failure: ContrastAPIError | None = None
        try:
            response = await asyncio.wait_for(self._exchange(request, buffer), self._timeout)
        except asyncio.TimeoutError:
            failure = APITimeoutError("request timed out")
        except httpx.HTTPError as exc:
            failure = _transport_error(exc)
        if failure is not None:
            raise failure
        self._check_read(response.status_code, response.headers, buffer)
        return response.status_code, response.headers, bytes(buffer.data)

    async def _exchange(self, request: httpx.Request, buffer: _ResponseBuffer) -> httpx.Response:
        """_exchange sends the request and reads the raw body into buffer."""
        response = await self._client.send(request, stream=True)
        try:
            if _is_identity_encoded(response.headers.get("Content-Encoding")):
                if response.is_stream_consumed:
                    buffer.add(response.content)
                else:
                    async for chunk in response.aiter_raw():
                        if not buffer.add(chunk):
                            break
        finally:
            await response.aclose()
        return response

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> AsyncContrastAPI:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.aclose()

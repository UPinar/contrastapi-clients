"""Rules the Python and Node SDKs share: each test pins one rule the two used to apply differently."""

from __future__ import annotations

import asyncio
import json
import math
import time

import httpx
import pytest

from conftest import KEY, Server, error_reply, reply
from contrastapi import APITimeoutError, AsyncContrastAPI, ContrastAPIError, _client
from contrastapi.exceptions import _clean_text

RL = {
    "X-RateLimit-Limit": "100",
    "X-RateLimit-Remaining": "97",
    "X-RateLimit-Reset-Machine": "1767225600",
    "X-RateLimit-Reset-Human": "2026-01-01 00:00:00 UTC",
}


def fake_clock(*times):
    """fake_clock returns the given times in order, then repeats the last one."""
    seq = list(times)
    return lambda: seq.pop(0) if len(seq) > 1 else seq[0]


def raised(api, *items, run=lambda c: c.call("health"), **kwargs):
    server = Server(*items)
    client = api.make(server, **kwargs)
    with pytest.raises(Exception) as info:
        run(client)
    return info.value, server, client


# --- constructor: exception kinds and the wait cap -------------------------------------------

@pytest.mark.parametrize("name, bad", [
    ("max_retries", True), ("max_retries", 1.5), ("max_retries", None), ("max_retries", "2"),
    ("upstream_busy_retries", False), ("upstream_busy_retries", 2.0),
    ("max_retry_wait", True), ("max_retry_wait", "1"), ("max_retry_wait", None),
    ("on_rate_limit", 5), ("on_rate_limit", "print"),
])
def test_wrong_setting_type_is_type_error(api, name, bad):
    with pytest.raises(TypeError):
        api.cls(**{name: bad})


@pytest.mark.parametrize("name, bad", [
    ("max_retries", -1), ("upstream_busy_retries", -1),
    ("max_retry_wait", -0.5), ("max_retry_wait", math.nan), ("max_retry_wait", math.inf),
    ("max_retry_wait", -math.inf),
])
def test_wrong_setting_value_is_value_error(api, name, bad):
    with pytest.raises(ValueError):
        api.cls(**{name: bad})


def test_callable_on_rate_limit_is_accepted(api):
    api.make(on_rate_limit=print)
    api.make(on_rate_limit=None)


@pytest.mark.parametrize("bad", [42, None, b"https://api.contrastcyber.com"])
def test_non_string_base_url_is_type_error(api, bad):
    with pytest.raises(TypeError):
        api.cls(base_url=bad)


@pytest.mark.parametrize("bad", [
    "https://example.com\\@api.contrastcyber.com",
    "https://api.contrastcyber.com\\x",
    "https://@api.contrastcyber.com",
    "https:example.com",
    "http://127.1",
])
def test_base_url_backslash_and_odd_forms_are_refused(api, bad):
    with pytest.raises(ValueError):
        api.cls(base_url=bad)


@pytest.mark.parametrize("operation", [None, 3, ["cve_lookup"], b"health"])
def test_non_string_operation_is_type_error(api, operation):
    server = Server()
    with pytest.raises(TypeError):
        api.make(server).call(operation, {})
    assert server.requests == []


# --- API key -----------------------------------------------------------------------------------

def test_env_key_loses_ascii_spaces_at_both_ends(api, monkeypatch):
    monkeypatch.setenv("CONTRASTAPI_API_KEY", f" \t\v\f{KEY}\t ")
    server = Server()
    api.make(server).call("health")
    assert server.requests[-1].headers.get("X-API-Key") == KEY


@pytest.mark.parametrize("edge", [" ", "﻿", " ", "\x1c", "\x85"])
def test_env_key_with_other_space_is_refused_without_echo(api, monkeypatch, edge):
    monkeypatch.setenv("CONTRASTAPI_API_KEY", edge + KEY)
    with pytest.raises(ValueError) as info:
        api.cls()
    assert KEY not in str(info.value)


def test_explicit_key_is_not_trimmed(api):
    with pytest.raises(ValueError):
        api.cls(api_key=" " + KEY)


# --- path and query values ------------------------------------------------------------------------

@pytest.mark.parametrize("value, text", [
    (7.0, "7"), (-0.0, "0"), (0.0, "0"), (7.5, "7.5"), (0.1, "0.1"), (-2.5, "-2.5"),
    (1e-6, "0.000001"), (1.5e-6, "0.0000015"), (1e-7, "1e-7"), (5e-7, "5e-7"), (1.25e-10, "1.25e-10"),
    (1e20, "100000000000000000000"), (1e21, "1e+21"), (1.5e300, "1.5e+300"), (-1e21, "-1e+21"),
    (2.0 ** 60, "1152921504606847000"), (123456.789, "123456.789"), (1e16, "10000000000000000"),
    (5, "5"), (2 ** 70, "1180591620717411303424"), (True, "true"), (False, "false"),
])
def test_numbers_are_written_like_javascript(api, value, text):
    server = Server()
    api.make(server).request("GET", "/x", query={"v": value})
    assert server.raw == "/x?v=" + text.replace("+", "%2B")
    api.make(server).call("cve_lookup", {"cve_id": value})
    assert server.raw == "/cve_lookup/" + text


def test_int_subclass_is_written_as_its_number(api):
    class Loud(int):
        def __str__(self) -> str:
            return "loud"

    server = Server()
    api.make(server).request("GET", "/x", query={"v": Loud(5)})
    assert server.raw == "/x?v=5"


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_non_finite_path_or_query_number_is_value_error(api, value):
    server = Server()
    with pytest.raises(ValueError, match="finite"):
        api.make(server).call("cve_lookup", {"cve_id": value})
    with pytest.raises(ValueError, match="finite"):
        api.make(server).call("cve_search", {"vendor": value})
    assert server.requests == []


def test_query_keeps_only_unreserved_characters(api):
    server = Server()
    api.make(server).request("GET", "/x", query={"a b~": "a b~*'!()-._+"})
    assert server.raw == "/x?a%20b~=a%20b~%2A%27%21%28%29-._%2B"


# --- raw request() --------------------------------------------------------------------------------

@pytest.mark.parametrize("method", [None, 5, b"GET"])
def test_non_string_method_is_type_error(api, method):
    server = Server()
    with pytest.raises(TypeError):
        api.make(server).request(method, "/x")
    assert server.requests == []


@pytest.mark.parametrize("method", ["", "GE T", "G1", "GET\n", "ÄET"])
def test_bad_method_is_value_error(api, method):
    server = Server()
    with pytest.raises(ValueError):
        api.make(server).request(method, "/x")
    assert server.requests == []


def test_lower_case_method_is_sent_upper_case(api):
    server = Server()
    api.make(server).request("patch", "/x")
    assert server.requests[-1].method == "PATCH"


@pytest.mark.parametrize("path", [None, 5, b"/x"])
def test_non_string_path_is_type_error(api, path):
    server = Server()
    with pytest.raises(TypeError):
        api.make(server).request("GET", path)
    assert server.requests == []


@pytest.mark.parametrize("path", ["/a b", "/a?b=1", "/a#b", "/a\\b", "/a\n", "/a\x7f", "/a\x00", "/\t"])
def test_bad_path_is_value_error(api, path):
    server = Server()
    with pytest.raises(ValueError):
        api.make(server).request("GET", path)
    assert server.requests == []


@pytest.mark.parametrize("query", [["a"], "a=1", [("a", "1")], 5])
def test_non_mapping_query_is_type_error(api, query):
    server = Server()
    with pytest.raises(TypeError):
        api.make(server).request("GET", "/x", query=query)
    assert server.requests == []


@pytest.mark.parametrize("name", [1, b"a", None])
def test_non_string_query_name_is_type_error(api, name):
    server = Server()
    with pytest.raises(TypeError):
        api.make(server).request("GET", "/x", query={name: "1"})
    assert server.requests == []


# --- answers --------------------------------------------------------------------------------------

@pytest.mark.parametrize("status", [100, 199])
def test_status_below_200_is_an_error(api, status):
    err, _, _ = raised(api, reply(status, {"ok": True}))
    assert type(err) is ContrastAPIError
    assert err.status == status


@pytest.mark.parametrize("content", [
    b'{"a":NaN}', b'{"a":Infinity}', b'[-Infinity]',
    '{"a":1}'.encode("utf-16"), '{"a":1}'.encode("utf-32"), b'{"a":"\xff"}',
])
def test_success_body_must_be_strict_utf8_json(api, content):
    err, _, _ = raised(api, reply(200, content=content))
    assert str(err) == "response is not a JSON object or array (HTTP 200)"


def test_utf8_bom_is_dropped(api):
    assert api.make(Server(reply(200, content=b'\xef\xbb\xbf{"a":1}'))).call("health") == {"a": 1}


def test_error_body_that_is_not_utf8_gives_no_code(api):
    err, _, _ = raised(api, reply(400, content=b'{"error":{"code":"\xffc","message":"m"}}'))
    assert err.code is None
    assert str(err) == "HTTP 400"


def test_error_body_in_utf16_gives_no_code(api):
    body = '{"error":{"code":"c","message":"m"}}'.encode("utf-16")
    err, _, _ = raised(api, reply(400, content=body))
    assert err.code is None
    assert str(err) == "HTTP 400"


@pytest.mark.parametrize("base_url", ["ftp://localhost", "ftp://api.contrastcyber.com"])
def test_other_schemes_are_refused(api, base_url):
    with pytest.raises(ValueError):
        api.cls(base_url=base_url)


def test_code_is_cleaned_like_the_message(api):
    err, _, _ = raised(api, error_reply(400, "\x1bco\x9bde\x85" + "c" * 400, "m\x9bsg"))
    assert err.code == "code" + "c" * 296
    assert err.message == "msg"


def test_clean_text_drops_c1_and_keeps_nbsp():
    assert _clean_text("a\x80b\x9fc\xa0d\x7fe") == "abc\xa0de"


def test_reset_human_drops_c1(api):
    headers = {**RL, "X-RateLimit-Reset-Human": b"2026\x9b31m"}
    client = api.make(Server(reply(200, headers=headers)))
    client.call("health")
    assert client.last_rate_limit.reset_human == "202631m"


@pytest.mark.parametrize("name, value, read", [
    ("X-RateLimit-Limit", "9007199254740991", True),
    ("X-RateLimit-Limit", "9007199254740992", False),
    ("X-RateLimit-Remaining", "9007199254740991", True),
    ("X-RateLimit-Remaining", "9007199254740992", False),
    ("X-RateLimit-Reset-Machine", "253402300799", True),
    ("X-RateLimit-Reset-Machine", "253402300800", False),
])
def test_rate_limit_bounds(api, name, value, read):
    client = api.make(Server(reply(200, headers={**RL, name: value})))
    client.call("health")
    assert (client.last_rate_limit is not None) is read


def test_body_cap_error_keeps_the_rate_limit(api):
    big = b"[" + b"0," * (8 * 1024 * 1024) + b"0]"
    err, _, client = raised(api, reply(200, content=big, headers=RL))
    assert str(err) == f"response body exceeds {16 * 1024 * 1024} bytes"
    assert err.status == 200
    assert err.rate_limit is not None and err.rate_limit.remaining == 97
    assert client.last_rate_limit is not None and client.last_rate_limit.remaining == 97


def test_body_read_past_the_deadline_times_out(api, monkeypatch):
    monkeypatch.setattr(_client, "_monotonic", fake_clock(0.0, 31.0))
    err, _, _ = raised(api, reply(200, {"a": 1}))
    assert type(err) is APITimeoutError
    assert str(err) == "request timed out"


def test_body_read_at_the_deadline_is_kept(api, monkeypatch):
    monkeypatch.setattr(_client, "_monotonic", fake_clock(0.0, 30.0))
    assert api.make(Server(reply(200, {"a": 1}))).call("health") == {"a": 1}


# --- server text: format characters and lone surrogates ----------------------------------------

def test_format_characters_and_lone_surrogates_leave_code_and_message(api):
    body = {"error": {"code": "a\u202eb\ufeffc\ud800",
                      "message": "x\u202ey\u200bz\u00ad\udc00\u2066w\U0001f600"}}
    err, _, _ = raised(api, reply(400, content=json.dumps(body).encode("ascii")))
    assert err.code == "abc"
    assert err.message == "xyzw\U0001f600"
    print(err)


def test_reset_human_drops_a_format_character(api):
    headers = {**RL, "X-RateLimit-Reset-Human": "2026\u00ad-01".encode("utf-8")}
    client = api.make(Server(reply(200, headers=headers)))
    client.call("health")
    assert client.last_rate_limit.reset_human == "2026-01"


# --- response encoding ------------------------------------------------------------------------

class TrackedStream(httpx.SyncByteStream, httpx.AsyncByteStream):
    """TrackedStream is a response body that counts its reads and notes a close."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.reads = 0
        self.closed = False

    def __iter__(self):
        self.reads += 1
        yield self.data

    async def __aiter__(self):
        self.reads += 1
        yield self.data

    def close(self) -> None:
        self.closed = True

    async def aclose(self) -> None:
        self.closed = True


def test_every_request_asks_for_identity(api):
    server = Server()
    client = api.make(server)
    client.call("health")
    client.cve_lookup_bulk(cve_ids=["CVE-2021-44228"])
    client.request("POST", "/x", body={"a": 1})
    assert [r.headers["Accept-Encoding"] for r in server.requests] == ["identity"] * 3


@pytest.mark.parametrize("encoding", ["gzip", "gzip, gzip", "br", "deflate", "zstd", "x-gzip", "",
                                      "identity, gzip", "gzip, identity", "identity, identity"])
def test_encoded_answer_is_refused_and_its_body_is_not_read(api, encoding):
    stream = TrackedStream(b'{"a":1}')
    headers = {**RL, "Content-Encoding": encoding}
    err, _, client = raised(api, lambda request: httpx.Response(200, headers=headers, stream=stream))
    assert type(err) is ContrastAPIError
    assert str(err) == "response has a Content-Encoding other than identity"
    assert err.status == 200
    assert err.rate_limit is not None and err.rate_limit.remaining == 97
    assert client.last_rate_limit is not None and client.last_rate_limit.remaining == 97
    assert stream.reads == 0
    assert stream.closed


@pytest.mark.parametrize("encoding", ["identity", "IDENTITY", "Identity"])
def test_identity_answer_is_read(api, encoding):
    server = Server(reply(200, {"a": 1}, headers={"Content-Encoding": encoding}))
    assert api.make(server).call("health") == {"a": 1}


def test_identity_stream_is_read_raw(api):
    stream = TrackedStream(b'{"a":1}')
    server = Server(lambda request: httpx.Response(200, stream=stream))
    assert api.make(server).call("health") == {"a": 1}
    assert stream.reads == 1


def test_encoded_429_is_refused_as_encoded_and_not_retried(api):
    headers = {"Content-Encoding": "gzip", "Retry-After": "0"}
    err, server, _ = raised(api, lambda request: httpx.Response(429, headers=headers,
                                                                stream=TrackedStream(b"{}")),
                            max_retries=3)
    assert type(err) is ContrastAPIError
    assert err.status == 429
    assert len(server.requests) == 1


# --- a path with a dot segment is refused before any request ---------------------------------

BASE_URL = "https://api.contrastcyber.com/v9"
DOT_MESSAGE = r"^request path must not hold a \. or \.\. segment$"


@pytest.mark.parametrize("path", [
    "/x", "//x", "/.well/x", "/x..y", "/x.", "/...", "/x/.x", "/%252e/x", "/%252e%252e/x", "/a%2eb",
])
def test_raw_path_without_a_dot_segment_is_sent(api, path):
    server = Server()
    api.make(server, base_url=BASE_URL, api_key=KEY).request("GET", path)
    assert len(server.requests) == 1
    assert server.raw == "/v9" + path


@pytest.mark.parametrize("path", [
    "/.", "/..", "/x/.", "/x/..", "/./x", "/../x", "/a/./b", "/./../x", "/../v9", "/../v9/x", "/../v9x/a",
    "/../v9%2Fx", "/%2e/x", "/%2E/x", "/%2e%2e/x", "/%2E%2E/x", "/.%2e/x", "/.%2E/x", "/%2e./x", "/%2E%2e/x",
])
def test_raw_path_with_a_dot_segment_is_refused(api, path):
    server = Server()
    client = api.make(server, base_url=BASE_URL, api_key=KEY)
    with pytest.raises(ValueError, match=DOT_MESSAGE):
        client.request("GET", path)
    assert server.requests == []


def test_percent_dot_path_that_climbs_back_into_the_base_path_is_refused(api):
    server = Server()
    client = api.make(server, base_url="https://api.contrastcyber.com/v1")
    with pytest.raises(ValueError, match=DOT_MESSAGE):
        client.request("GET", "/../%2e%2e/v1/x")
    assert server.requests == []


def test_raw_path_above_the_root_is_refused_under_a_root_base(api):
    server = Server()
    with pytest.raises(ValueError, match=DOT_MESSAGE):
        api.make(server).request("GET", "/../x")
    assert server.requests == []


@pytest.mark.parametrize("value", [".", ".."])
def test_path_value_dot_segment_is_refused(api, value):
    server = Server()
    client = api.make(server, base_url=BASE_URL)
    with pytest.raises(ValueError, match=DOT_MESSAGE):
        client.call("cve_lookup", {"cve_id": value})
    assert server.requests == []


@pytest.mark.parametrize("value", ["%2e", ".%2E"])
def test_path_value_percent_dot_is_encoded_and_sent(api, value):
    server = Server()
    api.make(server, base_url=BASE_URL).call("cve_lookup", {"cve_id": value})
    assert len(server.requests) == 1
    assert server.raw == "/v9/cve_lookup/" + value.replace("%", "%25")


def test_dots_in_the_query_are_sent(api):
    server = Server()
    api.make(server, base_url=BASE_URL).request("GET", "/x", query={"..": "/../%2e%2e/."})
    assert len(server.requests) == 1
    assert server.requests[0].url.query == b"..=%2F..%2F%252e%252e%2F."


def test_percent_encoded_dot_in_the_base_path_is_not_a_dot_segment(api):
    server = Server()
    api.make(server, base_url="https://api.contrastcyber.com/a%2eb").request("GET", "/x")
    assert len(server.requests) == 1


@pytest.mark.parametrize("base_url", [
    "https://api.contrastcyber.com/.",
    "https://api.contrastcyber.com/v1/..",
    "https://api.contrastcyber.com/v1/../v2",
    "https://api.contrastcyber.com/v1/./",
    "https://api.contrastcyber.com/%2e%2E/v1",
    "https://api.contrastcyber.com/v1/.%2e/",
])
def test_base_url_with_a_dot_segment_is_refused(api, base_url):
    with pytest.raises(ValueError, match=r"^base_url path must not hold a \. or \.\. segment$"):
        api.cls(base_url=base_url)


# --- the request URL stays under the base URL ------------------------------------------------

@pytest.mark.parametrize("url, root, under", [
    ("https://api.contrastcyber.com/x", "https://api.contrastcyber.com", True),
    ("https://api.contrastcyber.com@evil.example/steal", "https://api.contrastcyber.com", False),
    ("https://api.contrastcyber.com.evil.example/x", "https://api.contrastcyber.com", False),
    ("http://api.contrastcyber.com/x", "https://api.contrastcyber.com", False),
    ("https://api.contrastcyber.com:8443/x", "https://api.contrastcyber.com", False),
    ("https://api.contrastcyber.com:443/x", "https://api.contrastcyber.com", True),
    ("https://API.contrastcyber.com/x", "https://api.contrastcyber.com", True),
    ("https://api.contrastcyber.com/v9/x", "https://api.contrastcyber.com/v9", True),
    ("https://api.contrastcyber.com/v9", "https://api.contrastcyber.com/v9", False),
    ("https://api.contrastcyber.com/v9x/a", "https://api.contrastcyber.com/v9", False),
])
def test_is_under_base(url, root, under):
    assert _client._is_under_base(url, root) is under


def test_table_path_that_leaves_the_base_origin_is_refused(api, monkeypatch):
    tampered = dict(_client.OPERATIONS)
    tampered["health"] = {**tampered["health"], "path": "@evil.example/steal"}
    monkeypatch.setattr(_client, "OPERATIONS", tampered)
    server = Server()
    client = api.make(server, api_key=KEY)
    with pytest.raises(ValueError, match="^request URL is not under base_url$"):
        client.health()
    assert server.requests == []


# --- the timeout bounds the wait for the response headers ----------------------------------

async def test_async_timeout_bounds_the_header_phase(monkeypatch):
    monkeypatch.setattr(_client, "MIN_TIMEOUT", 0.05)

    async def never_answers(request):
        await asyncio.sleep(30)

    client = AsyncContrastAPI(transport=httpx.MockTransport(never_answers), timeout=0.05)
    started = time.monotonic()
    try:
        with pytest.raises(APITimeoutError) as info:
            await client.call("health")
    finally:
        await client.aclose()
    assert type(info.value) is APITimeoutError
    assert str(info.value) == "request timed out"
    assert info.value.__context__ is None
    assert time.monotonic() - started < 5


# --- encoded 5xx and retried answers, private-use text, a stalled async body ------------------

@pytest.mark.parametrize("status", [503, 500])
def test_encoded_5xx_is_refused_as_encoded(api, status):
    stream = TrackedStream(b'{"error":{"code":"upstream_busy","message":"m"}}')
    headers = {"Content-Encoding": "gzip", "Retry-After": "0"}
    err, server, _ = raised(api, lambda request: httpx.Response(status, headers=headers, stream=stream))
    assert type(err) is ContrastAPIError
    assert str(err) == "response has a Content-Encoding other than identity"
    assert err.status == status
    assert stream.reads == 0
    assert len(server.requests) == 1


def test_encoded_answer_after_a_busy_retry_is_refused(api):
    stream = TrackedStream(b'{"a":1}')
    err, server, _ = raised(api, error_reply(503, "upstream_busy", headers={"Retry-After": "0"}),
                            lambda request: httpx.Response(200, headers={"Content-Encoding": "gzip"},
                                                           stream=stream))
    assert type(err) is ContrastAPIError
    assert str(err) == "response has a Content-Encoding other than identity"
    assert len(server.requests) == 2
    assert stream.reads == 0


def test_private_use_character_stays_in_the_message(api):
    err, _, _ = raised(api, error_reply(400, "c", "a\ue000b"))
    assert err.message == "a\ue000b"


async def test_async_timeout_bounds_a_stalled_body(monkeypatch):
    monkeypatch.setattr(_client, "MIN_TIMEOUT", 0.05)

    class Stalls(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"{"
            await asyncio.sleep(30)
            yield b"}"

    transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=Stalls()))
    client = AsyncContrastAPI(transport=transport, timeout=0.05)
    started = time.monotonic()
    try:
        with pytest.raises(APITimeoutError):
            await client.call("health")
    finally:
        await client.aclose()
    assert time.monotonic() - started < 5

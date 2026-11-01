"""Response handling: status → error class, error body, JSON, body cap, redirects,
transport failures and key secrecy (sync and async through `api`)."""

from __future__ import annotations

import httpx
import pytest
from conftest import KEY, Server, error_reply, reply

from contrastapi import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    ContrastAPIError,
    NotFoundError,
    RateLimitError,
    UpstreamError,
)

CAP = 16 * 1024 * 1024


def fail(api, *items, **kwargs):
    server = Server(*items)
    client = api.make(server, **kwargs)
    with pytest.raises(ContrastAPIError) as info:
        client.call("health")
    return info.value, server


@pytest.mark.parametrize("status, cls", [
    (400, BadRequestError), (401, AuthenticationError), (404, NotFoundError),
    (429, RateLimitError), (502, UpstreamError), (503, UpstreamError), (504, UpstreamError),
    (500, ContrastAPIError), (405, ContrastAPIError), (403, ContrastAPIError),
    (402, ContrastAPIError), (501, ContrastAPIError), (505, ContrastAPIError),
    (499, ContrastAPIError), (599, ContrastAPIError),
])
def test_status_maps_to_error_class(api, status, cls):
    err, server = fail(api, error_reply(status, "x_code", "the message"))
    assert type(err) is cls
    assert err.status == status
    assert err.code == "x_code"
    assert err.message == "the message"
    assert str(err) == "the message"
    assert err.retry_after is None
    assert err.rate_limit is None
    assert len(server.requests) == 1


def test_error_class_tree():
    for cls in (BadRequestError, AuthenticationError, NotFoundError, RateLimitError,
                UpstreamError, APIConnectionError):
        assert issubclass(cls, ContrastAPIError)
    assert issubclass(APITimeoutError, APIConnectionError)
    assert issubclass(ContrastAPIError, Exception)


@pytest.mark.parametrize("item, code, message", [
    (reply(500, content=b"oops"), None, "HTTP 500"),
    (reply(400, content=b""), None, "HTTP 400"),
    (reply(400, {"error": "flat string"}), None, "HTTP 400"),
    (reply(400, {"error": {"code": 5, "message": 7}}), None, "HTTP 400"),
    (reply(400, {"error": {"code": "only_code"}}), "only_code", "HTTP 400"),
    (reply(400, {"error": {"message": "only message"}}), None, "only message"),
    (reply(400, {"code": "top", "message": "top"}), None, "HTTP 400"),
    (reply(400, ["error"]), None, "HTTP 400"),
    (reply(422, {"error": {"code": "c", "message": ""}}), "c", ""),
])
def test_error_body_extraction(api, item, code, message):
    err, _ = fail(api, item)
    assert err.code == code
    assert err.message == message
    assert str(err) == message


@pytest.mark.parametrize("raw, expected", [
    ("a" * 300, "a" * 300),
    ("a" * 301, "a" * 300),
    ("a" * 5000, "a" * 300),
    ("\n" * 10 + "b" * 300, "b" * 300),
    ("line1\nline2\x1b[0m\x7fend\x00", "line1line2[0mend"),
    ("a\x1fb c~\x80é\x9f\xa0", "ab c~é\xa0"),
    ("\t\r", ""),
])
def test_error_message_is_cleaned_and_capped(api, raw, expected):
    err, _ = fail(api, error_reply(400, "c", raw))
    assert err.message == expected
    assert str(err) == expected


@pytest.mark.parametrize("content", [b"<html>", b'"text"', b"42", b"null", b"true", b"", b"\xff\xfe", b"{"])
def test_success_body_that_is_not_an_object_or_array_is_an_error(api, content):
    err, _ = fail(api, reply(200, content=content))
    assert type(err) is ContrastAPIError
    assert err.status == 200
    assert err.code is None


@pytest.mark.parametrize("status, body", [
    (200, {"a": 1}), (200, [1, 2]), (200, []), (201, {"made": True}), (299, {"x": None}),
])
def test_success_returns_parsed_json(api, status, body):
    client = api.make(Server(reply(status, body)))
    assert client.call("health") == body


def test_body_at_cap_is_read(api):
    content = b"[" + b" " * (CAP - 2) + b"]"
    assert len(content) == CAP
    client = api.make(Server(reply(200, content=content)))
    assert client.call("health") == []


@pytest.mark.parametrize("status", [200, 500])
def test_body_over_cap_is_refused(api, status):
    err, _ = fail(api, reply(status, content=b" " * (CAP + 1)))
    assert type(err) is ContrastAPIError
    assert err.status == status
    assert err.code is None
    assert "16777216" in str(err)


class CountingStream(httpx.SyncByteStream, httpx.AsyncByteStream):
    """CountingStream yields 1 MiB chunks and counts how many were taken."""

    def __init__(self, chunks, fail_with=None):
        self.total = chunks
        self.taken = 0
        self.fail_with = fail_with
        self.closed = False

    def close(self):
        self.closed = True

    async def aclose(self):
        self.closed = True

    def _next(self):
        if self.fail_with is not None and self.taken == 2:
            raise self.fail_with
        self.taken += 1
        return b" " * (1024 * 1024)

    def __iter__(self):
        while self.taken < self.total:
            yield self._next()

    async def __aiter__(self):
        while self.taken < self.total:
            yield self._next()


def test_body_read_stops_at_cap(api):
    stream = CountingStream(64)
    err, _ = fail(api, lambda request: httpx.Response(200, stream=stream))
    assert type(err) is ContrastAPIError
    assert stream.taken == 17
    assert stream.closed is True


@pytest.mark.parametrize("exc, cls", [
    (httpx.ReadError("cut"), APIConnectionError),
    (httpx.ReadTimeout("slow"), APITimeoutError),
])
def test_failure_while_reading_body(api, exc, cls):
    stream = CountingStream(8, fail_with=exc)
    err, _ = fail(api, lambda request: httpx.Response(200, stream=stream))
    assert type(err) is cls
    assert err.status is None
    assert err.__cause__ is None and err.__context__ is None
    assert stream.closed is True


@pytest.mark.parametrize("status", [300, 301, 302, 303, 307, 308, 399])
def test_redirect_is_refused_not_followed(api, status):
    location = {"Location": "https://evil.example/steal"}
    err, server = fail(api, reply(status, {"moved": True}, headers=location), reply(200, {"ok": True}),
                       api_key=KEY)
    assert type(err) is APIConnectionError
    assert str(err) == "redirect refused"
    assert err.status is None
    assert len(server.requests) == 1


@pytest.mark.parametrize("exc, cls", [
    (httpx.ConnectError("refused"), APIConnectionError),
    (httpx.RemoteProtocolError("bad"), APIConnectionError),
    (httpx.ConnectTimeout("slow"), APITimeoutError),
    (httpx.ReadTimeout("slow"), APITimeoutError),
    (httpx.PoolTimeout("slow"), APITimeoutError),
])
def test_transport_failure_maps_without_chain(api, exc, cls):
    err, _ = fail(api, exc, api_key=KEY)
    assert type(err) is cls
    assert err.status is None
    assert err.code is None
    assert err.__cause__ is None
    assert err.__context__ is None


def assert_no_key(obj):
    for text in (str(obj), repr(obj), repr(vars(obj))):
        assert KEY not in text


def test_key_is_absent_from_client_text(api):
    server = Server()
    client = api.make(server, api_key=KEY)
    client.call("health")
    assert server.requests[-1].headers["X-API-Key"] == KEY
    assert_no_key(client.client)
    assert repr(client.client) == api.cls.__name__ + "(base_url='https://api.contrastcyber.com')"


@pytest.mark.parametrize("item", [
    error_reply(404, "not_found", "no such CVE"),
    error_reply(429, "rate_limited", "slow down", headers={"Retry-After": "5"}),
    reply(302, headers={"Location": "https://evil.example"}),
    reply(200, content=b"<html>"),
    httpx.ConnectError("refused"),
    httpx.ReadTimeout("slow"),
])
def test_key_is_absent_from_errors(api, item):
    err, server = fail(api, item, api_key=KEY)
    assert server.requests[-1].headers["X-API-Key"] == KEY
    assert_no_key(err)
    assert err.__cause__ is None
    assert err.__context__ is None

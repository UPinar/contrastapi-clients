"""Retry-After parsing, retries (503 busy, 429) and rate-limit info (sync and async)."""

from __future__ import annotations

import dataclasses
import math
from datetime import datetime, timedelta, timezone

import pytest
from conftest import KEY, Server, error_reply, reply

from contrastapi import ContrastAPIError, RateLimitError, RateLimitInfo, UpstreamError
from contrastapi._client import _parse_retry_after


@pytest.mark.parametrize("value, expected", [
    ("0", 0), ("5", 5), ("0005", 5), ("3599", 3599), ("3600", 3600), ("3601", 3600),
    ("9" * 30, 3600), ("9" * 5000, 3600), ("0" * 5000 + "7", 7),
    ("-1", None), ("1.5", None), ("", None), (" ", None), ("abc", None), ("nan", None),
    ("+5", None), ("1e3", None), ("٣", None), ("5s", None),
    (True, None), (False, None), (None, None), (1.5, None), (math.nan, None), (b"5", None),
    (0, 0), (7, 7), (3601, 3600), (-1, None),
])
def test_parse_retry_after(value, expected):
    assert _parse_retry_after(value) == expected


@pytest.mark.parametrize("header, expected", [("7", 7), ("1.5", None), ("-1", None), ("3601", 3600)])
def test_error_carries_retry_after(api, header, expected):
    client = api.make(Server(error_reply(429, "rate_limited", headers={"Retry-After": header})))
    with pytest.raises(RateLimitError) as info:
        client.call("health")
    assert info.value.retry_after == expected


def test_error_without_retry_after(api):
    client = api.make(Server(error_reply(429, "rate_limited")))
    with pytest.raises(RateLimitError) as info:
        client.call("health")
    assert info.value.retry_after is None


def busy(code="upstream_busy", retry_after="3"):
    headers = {} if retry_after is None else {"Retry-After": retry_after}
    return error_reply(503, code, "busy", headers=headers)


@pytest.mark.parametrize("code", ["upstream_busy", "raw_body_busy"])
def test_busy_is_retried_twice_then_raised(api, code):
    server = Server(busy(code))
    client = api.make(server, api_key=KEY)
    with pytest.raises(UpstreamError) as info:
        client.call("health")
    assert info.value.code == code
    assert len(server.requests) == 3
    assert api.sleeps == [3.0, 3.0]
    assert all(r.headers["X-API-Key"] == KEY for r in server.requests)


@pytest.mark.parametrize("header, wait", [(None, 1.0), ("x", 1.0), ("1.5", 1.0), ("0", 0.0), ("60", 60.0)])
def test_busy_wait_comes_from_retry_after(api, header, wait):
    server = Server(busy(retry_after=header))
    with pytest.raises(UpstreamError):
        api.make(server).call("health")
    assert api.sleeps == [wait, wait]


def test_busy_then_success(api):
    server = Server(busy(), reply(200, {"done": 1}))
    assert api.make(server).call("health") == {"done": 1}
    assert len(server.requests) == 2
    assert api.sleeps == [3.0]


@pytest.mark.parametrize("retries, requests", [(0, 1), (1, 2), (5, 6)])
def test_busy_retry_count_is_configurable(api, retries, requests):
    server = Server(busy())
    with pytest.raises(UpstreamError):
        api.make(server, upstream_busy_retries=retries).call("health")
    assert len(server.requests) == requests
    assert api.sleeps == [3.0] * (requests - 1)


@pytest.mark.parametrize("item", [
    error_reply(503, "maintenance", headers={"Retry-After": "3"}),
    error_reply(503, None, headers={"Retry-After": "3"}),
    error_reply(502, "upstream_busy", headers={"Retry-After": "3"}),
    error_reply(504, "raw_body_busy", headers={"Retry-After": "3"}),
    error_reply(500, "upstream_busy", headers={"Retry-After": "3"}),
])
def test_other_errors_are_not_busy_retried(api, item):
    server = Server(item)
    with pytest.raises(ContrastAPIError):
        api.make(server).call("health")
    assert len(server.requests) == 1
    assert api.sleeps == []


@pytest.mark.parametrize("wait_cap, header, requests", [(2, "3", 1), (2, "2", 3), (0, "0", 3), (0, "1", 1)])
def test_busy_respects_max_retry_wait(api, wait_cap, header, requests):
    server = Server(busy(retry_after=header))
    with pytest.raises(UpstreamError):
        api.make(server, max_retry_wait=wait_cap).call("health")
    assert len(server.requests) == requests


def limited(retry_after="5"):
    headers = {} if retry_after is None else {"Retry-After": retry_after}
    return error_reply(429, "rate_limited", "slow down", headers=headers)


def test_429_is_not_retried_by_default(api):
    server = Server(limited())
    with pytest.raises(RateLimitError):
        api.make(server).call("health")
    assert len(server.requests) == 1
    assert api.sleeps == []


@pytest.mark.parametrize("retries", [1, 2])
def test_429_is_retried_with_max_retries(api, retries):
    server = Server(limited())
    with pytest.raises(RateLimitError):
        api.make(server, max_retries=retries).call("health")
    assert len(server.requests) == retries + 1
    assert api.sleeps == [5.0] * retries


def test_429_then_success(api):
    server = Server(limited(), reply(200, {"done": 2}))
    assert api.make(server, max_retries=3).call("health") == {"done": 2}
    assert len(server.requests) == 2
    assert api.sleeps == [5.0]


@pytest.mark.parametrize("wait_cap, header, requests", [
    (60.0, "60", 2), (60.0, "61", 1), (None, "60", 2), (None, "61", 1), (0, "0", 2), (0, "1", 1),
    (60.0, None, 1), (60.0, "soon", 1),
])
def test_429_respects_max_retry_wait(api, wait_cap, header, requests):
    server = Server(limited(header))
    kwargs = {"max_retries": 1}
    if wait_cap is not None:
        kwargs["max_retry_wait"] = wait_cap
    with pytest.raises(RateLimitError):
        api.make(server, **kwargs).call("health")
    assert len(server.requests) == requests


def test_busy_and_429_budgets_are_separate(api):
    server = Server(busy(), limited(), busy(), reply(200, {"done": 3}))
    assert api.make(server, max_retries=1).call("health") == {"done": 3}
    assert len(server.requests) == 4
    assert api.sleeps == [3.0, 5.0, 3.0]


def test_retry_resends_the_same_body(api):
    server = Server(busy(), reply(200, {"done": 4}))
    api.make(server).call("cve_lookup_bulk", {"cve_ids": ["CVE-1"]})
    assert server.body(0) == server.body(1) == {"cve_ids": ["CVE-1"]}


RL = {
    "X-RateLimit-Limit": "100",
    "X-RateLimit-Remaining": "42",
    "X-RateLimit-Reset-Machine": "1767225600",
    "X-RateLimit-Reset-Human": "2026-01-01 00:00 UTC",
}
INFO = RateLimitInfo(limit=100, remaining=42, reset_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                     reset_human="2026-01-01 00:00 UTC")


def test_rate_limit_is_parsed(api):
    client = api.make(Server(reply(200, headers=RL)))
    assert client.last_rate_limit is None
    client.call("health")
    info = client.last_rate_limit
    assert info == INFO
    assert info.limit == 100 and info.remaining == 42
    assert info.reset_at.utcoffset() == timedelta(0)
    assert info.reset_at.timestamp() == 1767225600


def test_rate_limit_info_is_frozen():
    with pytest.raises(dataclasses.FrozenInstanceError):
        INFO.limit = 5  # type: ignore[misc]


def test_rate_limit_is_kept_when_absent(api):
    client = api.make(Server(reply(200, headers=RL), reply(200)))
    client.call("health")
    first = client.last_rate_limit
    client.call("health")
    assert client.last_rate_limit is first


def test_rate_limit_absent_stays_none(api):
    client = api.make(Server(reply(200)))
    client.call("health")
    assert client.last_rate_limit is None


@pytest.mark.parametrize("name, value", [
    ("X-RateLimit-Limit", None), ("X-RateLimit-Remaining", None), ("X-RateLimit-Reset-Machine", None),
    ("X-RateLimit-Reset-Human", None),
    ("X-RateLimit-Limit", "abc"), ("X-RateLimit-Limit", "-1"), ("X-RateLimit-Limit", "1.5"),
    ("X-RateLimit-Limit", "9" * 5000),
    ("X-RateLimit-Remaining", ""), ("X-RateLimit-Remaining", "x"),
    ("X-RateLimit-Reset-Machine", "soon"), ("X-RateLimit-Reset-Machine", "9" * 30),
    ("X-RateLimit-Reset-Human", ""),
])
def test_incomplete_or_invalid_rate_limit_is_ignored(api, name, value):
    headers = dict(RL)
    if value is None:
        del headers[name]
    else:
        headers[name] = value
    seen = []
    client = api.make(Server(reply(200, headers=RL), reply(200, headers=headers)), on_rate_limit=seen.append)
    client.call("health")
    client.call("health")
    assert client.last_rate_limit == INFO
    assert seen == [INFO]


def test_rate_limit_zero_values(api):
    headers = dict(RL, **{"X-RateLimit-Remaining": "0", "X-RateLimit-Reset-Machine": "0"})
    client = api.make(Server(reply(200, headers=headers)))
    client.call("health")
    assert client.last_rate_limit.remaining == 0
    assert client.last_rate_limit.reset_at == datetime(1970, 1, 1, tzinfo=timezone.utc)


def test_human_reset_is_cleaned(api):
    headers = dict(RL, **{"X-RateLimit-Reset-Human": "in\t5 min"})
    client = api.make(Server(reply(200, headers=headers)))
    client.call("health")
    assert client.last_rate_limit.reset_human == "in5 min"


def test_error_carries_rate_limit(api):
    client = api.make(Server(error_reply(429, "rate_limited", headers=dict(RL, **{"Retry-After": "5"}))))
    with pytest.raises(RateLimitError) as info:
        client.call("health")
    assert info.value.rate_limit == INFO
    assert client.last_rate_limit == INFO


def test_on_rate_limit_fires_per_response(api):
    seen = []
    client = api.make(Server(reply(200, headers=RL)), on_rate_limit=seen.append)
    client.call("health")
    client.call("health")
    assert seen == [INFO, INFO]


def test_on_rate_limit_fires_on_retried_responses(api):
    seen = []
    server = Server(error_reply(503, "upstream_busy", headers=dict(RL, **{"Retry-After": "1"})), reply(200, headers=RL))
    api.make(server, on_rate_limit=seen.append).call("health")
    assert seen == [INFO, INFO]


def test_on_rate_limit_not_fired_without_headers(api):
    seen = []
    api.make(Server(reply(200)), on_rate_limit=seen.append).call("health")
    assert seen == []


def boom(info):
    raise RuntimeError("callback failed")


def test_on_rate_limit_exception_is_swallowed(api):
    client = api.make(Server(reply(200, {"v": 1}, headers=RL)), on_rate_limit=boom)
    assert client.call("health") == {"v": 1}
    assert client.last_rate_limit == INFO


def test_on_rate_limit_exception_keeps_the_api_error(api):
    client = api.make(Server(error_reply(404, "not_found", headers=RL)), on_rate_limit=boom)
    with pytest.raises(ContrastAPIError) as info:
        client.call("health")
    assert info.value.status == 404
    assert info.value.__context__ is None


@pytest.mark.parametrize("status, code", [(500, "x"), (503, "maintenance"), (400, "bad"), (404, "not_found")])
def test_max_retries_covers_only_429(api, status, code):
    server = Server(error_reply(status, code, headers={"Retry-After": "1"}))
    with pytest.raises(ContrastAPIError):
        api.make(server, max_retries=2).call("health")
    assert len(server.requests) == 1
    assert api.sleeps == []

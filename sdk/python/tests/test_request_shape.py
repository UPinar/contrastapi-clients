"""URL, header, key-policy and construction tests (sync and async through `api`)."""

from __future__ import annotations

import math

import pytest
from conftest import KEY, Server

import contrastapi

MAX_RANSOM = "/cve_search?severity=HIGH&vendor=apache&product=log%204j&cwe_id=CWE-79&min_cvss=7.5&min_epss=0.1&in_kev=true&known_ransomware=true&has_nuclei_template=true&published_after=2024-01-01&published_before=2024-12-31&sort=epss&limit=10&offset=0"


@pytest.mark.parametrize("value, expected", [
    ("CVE-2021-44228", "/cve_lookup/CVE-2021-44228"),
    ("::1", "/cve_lookup/::1"),
    ("user@example.com", "/cve_lookup/user@example.com"),
    ("a/b", "/cve_lookup/a%2Fb"),
    ("100%", "/cve_lookup/100%25"),
    ("a b", "/cve_lookup/a%20b"),
    ("!$&'()*+,;=", "/cve_lookup/!$&'()*+,;="),
    ("-._~AZaz09", "/cve_lookup/-._~AZaz09"),
    ("é", "/cve_lookup/%C3%A9"),
    ("a?b#c", "/cve_lookup/a%3Fb%23c"),
    ("[x]\"<>\\^`{|}", "/cve_lookup/%5Bx%5D%22%3C%3E%5C%5E%60%7B%7C%7D"),
    (True, "/cve_lookup/true"),
    (False, "/cve_lookup/false"),
    (42, "/cve_lookup/42"),
])
def test_path_argument_is_percent_encoded(api, value, expected):
    server = Server()
    api.make(server).call("cve_lookup", {"cve_id": value})
    assert server.raw == expected
    assert server.requests[-1].method == "GET"


def test_query_follows_params_order_with_exact_bytes(api):
    server = Server()
    args = {
        "offset": 0, "limit": 10, "sort": "epss", "published_before": "2024-12-31",
        "published_after": "2024-01-01", "has_nuclei_template": True, "known_ransomware": True,
        "in_kev": True, "min_epss": 0.1, "min_cvss": 7.5, "cwe_id": "CWE-79",
        "product": "log 4j", "vendor": "apache", "severity": "HIGH",
    }
    api.make(server).call("cve_search", args)
    assert server.raw == MAX_RANSOM


@pytest.mark.parametrize("args, expected", [
    ({}, "/cve_search"),
    ({"vendor": None, "limit": None}, "/cve_search"),
    ({"vendor": None, "limit": 5}, "/cve_search?limit=5"),
    ({"offset": 0}, "/cve_search?offset=0"),
    ({"in_kev": False}, "/cve_search?in_kev=false"),
    ({"in_kev": True}, "/cve_search?in_kev=true"),
    ({"vendor": ""}, "/cve_search?vendor="),
    ({"vendor": "a&b=c+d/é?#%"}, "/cve_search?vendor=a%26b%3Dc%2Bd%2F%C3%A9%3F%23%25"),
    ({"vendor": "x y", "product": "~-._"}, "/cve_search?vendor=x%20y&product=~-._"),
])
def test_query_omits_none_and_writes_bools(api, args, expected):
    server = Server()
    api.make(server).call("cve_search", args)
    assert server.raw == expected


@pytest.mark.parametrize("bad", [["a"], {"a": 1}, object()])
def test_non_scalar_query_or_path_value_is_refused_before_sending(api, bad):
    server = Server()
    client = api.make(server)
    with pytest.raises(TypeError):
        client.call("cve_search", {"vendor": bad})
    with pytest.raises(TypeError):
        client.call("cve_lookup", {"cve_id": bad})
    assert server.requests == []


def test_body_operation_posts_json_with_content_type(api):
    server = Server()
    api.make(server).call("cve_lookup_bulk", {"cve_ids": ["CVE-2021-44228", "CVE-2014-0160"]})
    request = server.requests[-1]
    assert request.method == "POST"
    assert server.url == "https://api.contrastcyber.com/cve_lookup_bulk"
    assert request.content == b'{"cve_ids":["CVE-2021-44228","CVE-2014-0160"]}'
    assert request.headers["Content-Type"] == "application/json"


def test_body_that_is_not_strict_json_is_refused_before_sending(api):
    server = Server()
    client = api.make(server)
    with pytest.raises(ValueError):
        client.request("POST", "/cve_lookup_bulk", body={"x": math.nan})
    with pytest.raises(TypeError):
        client.call("cve_lookup_bulk", {"cve_ids": {1, 2}})
    assert server.requests == []


def test_get_has_fixed_headers_and_no_content_type(api):
    server = Server()
    api.make(server).call("health")
    request = server.requests[-1]
    assert server.url == "https://api.contrastcyber.com/health"
    assert request.headers["Accept"] == "application/json"
    assert request.headers["Accept-Encoding"] == "identity"
    assert request.headers["User-Agent"] == "contrastapi-python/2.0.0"
    assert "Content-Type" not in request.headers
    assert "X-API-Key" not in request.headers
    assert request.content == b""


@pytest.mark.parametrize("base_url, expected", [
    ("https://api.contrastcyber.com", "https://api.contrastcyber.com/health"),
    ("https://api.contrastcyber.com/", "https://api.contrastcyber.com/health"),
    ("https://example.com/prefix//", "https://example.com/prefix/health"),
    ("https://example.com:8443", "https://example.com:8443/health"),
    ("http://localhost:8080", "http://localhost:8080/health"),
    ("http://127.0.0.1:8080/", "http://127.0.0.1:8080/health"),
    ("http://[::1]:8080", "http://[::1]:8080/health"),
])
def test_base_url_is_accepted(api, base_url, expected):
    server = Server()
    api.make(server, base_url=base_url).call("health")
    assert server.url == expected


@pytest.mark.parametrize("base_url", [
    "http://api.contrastcyber.com",
    "http://example.com",
    "http://localhost.example.com",
    "http://127.0.0.2",
    "ftp://api.contrastcyber.com",
    "ftp://localhost:21",
    "ws://127.0.0.1",
    "https://user@api.contrastcyber.com",
    "https://user:pw@api.contrastcyber.com",
    "https://:pw@api.contrastcyber.com",
    "https://@api.contrastcyber.com",
    "https://api.contrastcyber.com?x=1",
    "https://api.contrastcyber.com/?",
    "https://api.contrastcyber.com#frag",
    "https://api.contrastcyber.com/#",
    "https://",
    "https:///health",
    "not a url",
    "",
    "https://[::1",
    "https://api.contrastcyber.com:99999",
    "https://api.contrast cyber.com",
    "https://api.contrastcyber.com\n",
    "https://api.contrastcyber.com/\x7f",
])
def test_base_url_is_refused(api, base_url):
    with pytest.raises(ValueError):
        api.cls(base_url=base_url)


def key_of(server):
    return server.requests[-1].headers.get("X-API-Key")


@pytest.mark.parametrize("base_url, trust_host, sent", [
    ("https://api.contrastcyber.com", False, True),
    ("https://API.ContrastCyber.com", False, True),
    ("http://localhost:8080", False, True),
    ("http://127.0.0.1:8080", False, True),
    ("http://[::1]:8080", False, True),
    ("https://localhost", False, True),
    ("https://example.com", False, False),
    ("https://api.contrastcyber.com.evil.example", False, False),
    ("https://evil.api.contrastcyber.com", False, False),
    ("https://localhost.evil.example", False, False),
    ("https://127.0.0.1.evil.example", False, False),
    ("https://example.com", True, True),
    ("https://example.com", 1, False),
    ("https://example.com", "yes", False),
])
def test_key_goes_only_to_trusted_hosts(api, base_url, trust_host, sent):
    server = Server()
    api.make(server, api_key=KEY, base_url=base_url, trust_host=trust_host).call("health")
    assert key_of(server) == (KEY if sent else None)


def test_key_falls_back_to_env(api, monkeypatch):
    monkeypatch.setenv("CONTRASTAPI_API_KEY", KEY)
    server = Server()
    api.make(server).call("health")
    assert key_of(server) == KEY


def test_empty_env_key_sends_none(api, monkeypatch):
    monkeypatch.setenv("CONTRASTAPI_API_KEY", "")
    server = Server()
    api.make(server).call("health")
    assert key_of(server) is None


def test_explicit_empty_key_ignores_env(api, monkeypatch):
    monkeypatch.setenv("CONTRASTAPI_API_KEY", KEY)
    server = Server()
    api.make(server, api_key="").call("health")
    assert key_of(server) is None


def test_explicit_key_wins_over_env(api, monkeypatch):
    monkeypatch.setenv("CONTRASTAPI_API_KEY", "env-key")
    server = Server()
    api.make(server, api_key=KEY).call("health")
    assert key_of(server) == KEY


def test_no_key_anywhere_sends_none(api):
    server = Server()
    api.make(server).call("health")
    assert key_of(server) is None


@pytest.mark.parametrize("bad", [12345, ["abc"], b"abc"])
def test_non_string_key_is_refused(api, bad):
    with pytest.raises(TypeError):
        api.cls(api_key=bad)


@pytest.mark.parametrize("bad", ["sk-\nx", "sk-\x7f", "sk-é", "sk- x"])
def test_unsendable_key_is_refused_without_echo(api, bad):
    with pytest.raises(ValueError) as info:
        api.cls(api_key=bad)
    assert bad not in str(info.value)


def timeout_of(server):
    return server.requests[-1].extensions["timeout"]


@pytest.mark.parametrize("given, expected", [
    (0.999, 1.0), (0, 1.0), (-5, 1.0), (1, 1.0), (1.001, 1.001), (30, 30.0),
    (119.999, 119.999), (120, 120.0), (120.001, 120.0), (1e9, 120.0),
    (math.nan, 30.0), (math.inf, 30.0), (-math.inf, 30.0), (True, 30.0), (False, 30.0),
    (None, 30.0), ("5", 30.0),
])
def test_timeout_is_clamped(api, given, expected):
    server = Server()
    api.make(server, timeout=given).call("health")
    assert timeout_of(server) == {"connect": expected, "read": expected, "write": expected, "pool": expected}


def test_default_timeout_is_thirty(api):
    server = Server()
    api.make(server).call("health")
    assert timeout_of(server)["read"] == 30.0


@pytest.mark.parametrize("name, bad", [
    ("max_retries", -1), ("upstream_busy_retries", -1),
    ("max_retry_wait", -0.5), ("max_retry_wait", math.nan), ("max_retry_wait", math.inf),
])
def test_bad_retry_settings_are_refused(api, name, bad):
    with pytest.raises(ValueError):
        api.cls(**{name: bad})


@pytest.mark.parametrize("name, good", [
    ("max_retries", 0), ("upstream_busy_retries", 0), ("max_retry_wait", 0), ("max_retry_wait", 0.0),
    ("max_retry_wait", 1e308),
])
def test_edge_retry_settings_are_accepted(api, name, good):
    api.make(**{name: good})


def test_constructor_is_keyword_only(api):
    with pytest.raises(TypeError):
        api.cls(KEY)


def test_version_and_exports():
    assert contrastapi.__version__ == "2.0.0"
    for name in contrastapi.__all__:
        assert getattr(contrastapi, name) is not None
    assert set(contrastapi.__all__) == {
        "APIConnectionError", "APITimeoutError", "AsyncContrastAPI", "AuthenticationError",
        "BadRequestError", "ContrastAPI", "ContrastAPIError", "NotFoundError", "PackageItem",
        "RateLimitError", "RateLimitInfo", "UpstreamError", "__version__",
    }

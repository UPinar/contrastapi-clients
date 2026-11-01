"""call() validation, generated methods, request() and client lifetime."""

from __future__ import annotations

import httpx
import pytest
from conftest import Server

from contrastapi import AsyncContrastAPI, ContrastAPI
from contrastapi._operations import OPERATIONS


@pytest.mark.parametrize("operation", ["no_such_op", "", "CVE_LOOKUP", "__class__"])
def test_unknown_operation_is_refused_before_sending(api, operation):
    server = Server()
    with pytest.raises(ValueError):
        api.make(server).call(operation, {})
    assert server.requests == []


@pytest.mark.parametrize("args", [["cve_id"], "cve_id=x", 5, (("cve_id", "x"),)])
def test_args_must_be_a_mapping(api, args):
    server = Server()
    with pytest.raises(TypeError):
        api.make(server).call("cve_lookup", args)
    assert server.requests == []


def test_unexpected_argument_is_named(api):
    server = Server()
    with pytest.raises(TypeError, match="'bogus'"):
        api.make(server).call("cve_lookup", {"cve_id": "CVE-1", "bogus": 1})
    with pytest.raises(TypeError, match="'cve_id'"):
        api.make(server).call("health", {"cve_id": "CVE-1"})
    assert server.requests == []


@pytest.mark.parametrize("operation, args, name", [
    ("cve_lookup", {}, "'cve_id'"),
    ("cve_lookup", {"cve_id": None}, "'cve_id'"),
    ("cve_lookup", None, "'cve_id'"),
    ("cve_lookup_bulk", {}, "'cve_ids'"),
    ("cve_lookup_bulk", {"cve_ids": None}, "'cve_ids'"),
])
def test_missing_required_argument_is_named(api, operation, args, name):
    server = Server()
    with pytest.raises(TypeError, match=name):
        api.make(server).call(operation, args)
    assert server.requests == []


def test_args_none_and_empty_mean_no_arguments(api):
    server = Server()
    client = api.make(server)
    client.call("health")
    client.call("health", None)
    client.call("health", {})
    assert [r.url.raw_path for r in server.requests] == [b"/health"] * 3


def test_operations_table_is_read_only():
    with pytest.raises(TypeError):
        OPERATIONS["x"] = {}  # type: ignore[index]
    assert {"health", "cve_lookup", "cve_search", "cve_lookup_bulk"} <= set(OPERATIONS)
    assert "image_inspect" not in OPERATIONS
    assert OPERATIONS["cve_lookup"]["params"][0] == {"name": "cve_id", "in": "path", "required": True}


def test_generated_methods(api):
    server = Server()
    client = api.make(server)
    assert client.health() == {"ok": True}
    assert server.raw == "/health"
    client.cve_lookup(cve_id="CVE-2021-44228")
    assert server.raw == "/cve_lookup/CVE-2021-44228"
    client.cve_search()
    assert server.raw == "/cve_search"
    client.cve_search(limit=5, in_kev=False, vendor=None)
    assert server.raw == "/cve_search?in_kev=false&limit=5"
    client.cve_search(severity="CRITICAL", vendor="v", product="p", cwe_id="CWE-1", min_cvss=9.0,
                      min_epss=0.5, in_kev=True, known_ransomware=True, has_nuclei_template=True,
                      published_after="2025-01-01", published_before="2025-02-01", sort="cvss",
                      limit=1, offset=2)
    assert server.raw == ("/cve_search?severity=CRITICAL&vendor=v&product=p&cwe_id=CWE-1&min_cvss=9"
                          "&min_epss=0.5&in_kev=true&known_ransomware=true&has_nuclei_template=true"
                          "&published_after=2025-01-01&published_before=2025-02-01&sort=cvss&limit=1&offset=2")
    client.cve_lookup_bulk(cve_ids=["CVE-1", "CVE-2"])
    assert server.requests[-1].method == "POST"
    assert server.body() == {"cve_ids": ["CVE-1", "CVE-2"]}


def test_generated_methods_are_keyword_only(api):
    client = api.make()
    with pytest.raises(TypeError):
        client.client.cve_lookup("CVE-1")


def test_request_escape_hatch(api):
    server = Server()
    client = api.make(server)
    assert client.request("GET", "/health") == {"ok": True}
    assert server.url == "https://api.contrastcyber.com/health"
    client.request("get", "/cve_search", query={"limit": 5, "skip": None, "in_kev": True, "q": "a b"})
    assert server.requests[-1].method == "GET"
    assert server.raw == "/cve_search?limit=5&in_kev=true&q=a%20b"
    client.request("GET", "/cve_search", query={})
    assert server.raw == "/cve_search"
    client.request("POST", "/cve_lookup_bulk", body={"cve_ids": ["A"]})
    assert server.requests[-1].method == "POST"
    assert server.body() == {"cve_ids": ["A"]}
    assert server.requests[-1].headers["Content-Type"] == "application/json"
    client.request("POST", "/x")
    assert "Content-Type" not in server.requests[-1].headers


@pytest.mark.parametrize("path", ["health", "", "https://evil.example/x"])
def test_request_path_must_start_with_slash(api, path):
    server = Server()
    with pytest.raises(ValueError):
        api.make(server).request("GET", path)
    assert server.requests == []


class ClosingTransport(httpx.MockTransport):
    def __init__(self, server):
        super().__init__(server)
        self.closed = False

    def close(self):
        self.closed = True

    async def aclose(self):
        self.closed = True


def test_sync_context_manager_closes():
    server = Server()
    transport = ClosingTransport(server)
    with ContrastAPI(transport=transport) as client:
        assert isinstance(client, ContrastAPI)
        assert client.health() == {"ok": True}
        assert transport.closed is False
    assert transport.closed is True


def test_sync_close():
    transport = ClosingTransport(Server())
    client = ContrastAPI(transport=transport)
    client.close()
    assert transport.closed is True


async def test_async_context_manager_closes():
    server = Server()
    transport = ClosingTransport(server)
    async with AsyncContrastAPI(transport=transport) as client:
        assert isinstance(client, AsyncContrastAPI)
        assert await client.health() == {"ok": True}
        assert await client.cve_lookup(cve_id="CVE-2021-44228") == {"ok": True}
        assert transport.closed is False
    assert transport.closed is True
    assert server.raw == "/cve_lookup/CVE-2021-44228"


async def test_async_aclose():
    transport = ClosingTransport(Server())
    client = AsyncContrastAPI(transport=transport)
    await client.aclose()
    assert transport.closed is True


PROBE = {
    "method_name": "probe",
    "method": "POST",
    "path": "/probe/{item_id}/x",
    "params": (
        {"name": "item_id", "in": "path", "required": True},
        {"name": "page", "in": "query", "required": False},
        {"name": "needed", "in": "body", "required": True},
        {"name": "extra", "in": "body", "required": False},
    ),
}


def test_mixed_operation_places_each_argument(api, monkeypatch):
    """A generated table will hold path, query and optional body params together."""
    from types import MappingProxyType

    from contrastapi import _client
    monkeypatch.setattr(_client, "OPERATIONS", MappingProxyType({"probe": PROBE}))
    server = Server()
    client = api.make(server)
    client.call("probe", {"item_id": "a b", "needed": [1], "extra": None, "page": None})
    assert server.raw == "/probe/a%20b/x"
    assert server.requests[-1].content == b'{"needed":[1]}'
    client.call("probe", {"extra": {"k": False}, "page": 2, "needed": 0, "item_id": 7})
    assert server.raw == "/probe/7/x?page=2"
    assert server.requests[-1].content == b'{"needed":0,"extra":{"k":false}}'

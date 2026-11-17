"""Tests for tools/_api.py.

Run from the repository root:
python3 -m unittest discover -s dify-plugin/tests -t dify-plugin -v
"""

import hashlib
import json
import sys
import types
import unittest
import zlib
from unittest import mock


def _install_dify_stub():
    """Put a small stand-in for the dify_plugin package into sys.modules.

    The real package is not installed where these tests run. The stand-in has
    only the names the plugin imports.
    """
    def module(name):
        found = sys.modules.get(name)
        if found is None:
            found = types.ModuleType(name)
            found.__path__ = []
            sys.modules[name] = found
        return found

    root = module("dify_plugin")
    module("dify_plugin.entities")
    entities_tool = module("dify_plugin.entities.tool")
    module("dify_plugin.errors")
    errors_tool = module("dify_plugin.errors.tool")

    class Tool:
        def __init__(self, runtime=None):
            self.runtime = runtime

        def create_json_message(self, data):
            return ("json", data)

    class ToolProvider:
        pass

    class ToolProviderCredentialValidationError(Exception):
        pass

    for owner, name, value in (
        (root, "Tool", Tool),
        (root, "ToolProvider", ToolProvider),
        (root, "Plugin", object),
        (root, "DifyPluginEnv", object),
        (entities_tool, "ToolInvokeMessage", object),
        (errors_tool, "ToolProviderCredentialValidationError", ToolProviderCredentialValidationError),
    ):
        if not hasattr(owner, name):
            setattr(owner, name, value)


_install_dify_stub()

import requests  # noqa: E402

from tools import _api as api  # noqa: E402

BASE = "https://api.contrastcyber.com"


def _make_key(body48="0123456789abcdef" * 3):
    return api.KEY_PREFIX + body48 + format(zlib.crc32(body48.encode("ascii")), "08x")


class FakeResponse:
    def __init__(self, status_code, body="", headers=None):
        self.status_code = status_code
        self.text = body if isinstance(body, str) else json.dumps(body)
        self.headers = headers or {}

    def json(self):
        return json.loads(self.text)


class FakeTool:
    def __init__(self, credentials=None):
        self.runtime = types.SimpleNamespace(credentials=credentials) if credentials is not None else None
        self.messages = []

    def create_json_message(self, data):
        self.messages.append(data)
        return ("json", data)


class BuildRequestTest(unittest.TestCase):
    def test_url_and_headers(self):
        method, url, query, body, headers = api.build_request("cve_lookup", {"cve_id": "CVE-2021-44228"}, "")
        self.assertEqual(method, "GET")
        self.assertEqual(url, f"{BASE}/cve_lookup/CVE-2021-44228")
        self.assertEqual(query, {})
        self.assertIsNone(body)
        self.assertEqual(headers["User-Agent"], "contrastapi-dify/0.9.0")
        self.assertEqual(headers["Accept"], "application/json")
        self.assertNotIn("X-API-Key", headers)
        key = _make_key()
        headers = api.build_request("cve_lookup", {"cve_id": "CVE-2021-44228"}, key)[4]
        self.assertEqual(headers["X-API-Key"], key)
        headers = api.build_request("cve_lookup", {"cve_id": "CVE-2021-44228"}, "   ")[4]
        self.assertNotIn("X-API-Key", headers)
        headers = api.build_request("cve_lookup", {"cve_id": "CVE-2021-44228"}, None)[4]
        self.assertNotIn("X-API-Key", headers)
        with self.assertRaises(api.ContrastAPIError):
            api.build_request("no_such_tool", {}, "")

    def test_boolean_and_const(self):
        def query(params):
            return api.build_request("cve_search", params, "")[2]

        self.assertEqual(query({"in_kev": False}), {"in_kev": "false"})
        self.assertEqual(query({"in_kev": True}), {"in_kev": "true"})
        self.assertEqual(query({"in_kev": "false"}), {"in_kev": "false"})
        self.assertEqual(query({"in_kev": "TRUE"}), {"in_kev": "true"})
        self.assertEqual(query({"known_ransomware": False}), {})
        self.assertEqual(query({"known_ransomware": "false"}), {})
        self.assertEqual(query({"known_ransomware": True}), {"known_ransomware": "true"})
        self.assertEqual(query({"vendor": "", "severity": "   ", "cwe_id": None, "in_kev": ""}), {})
        self.assertEqual(query({"vendor": " apache "}), {"vendor": "apache"})
        with self.assertRaises(api.ContrastAPIError):
            query({"in_kev": "maybe"})
        body = api.build_request("watchlist_edit", {"in_kev": False, "clear": True, "known_ransomware": False}, "")[3]
        self.assertEqual(body, {"in_kev": False, "clear": True})
        self.assertIs(body["in_kev"], False)
        self.assertIs(body["clear"], True)
        self.assertEqual(api.build_request("watchlist_edit", {}, "")[3], {})

    def test_integer_cast(self):
        def query(params):
            return api.build_request("cve_search", params, "")[2]

        self.assertEqual(query({"limit": 20.0}), {"limit": 20})
        self.assertIs(type(query({"limit": 20.0})["limit"]), int)
        self.assertEqual(query({"limit": "35"}), {"limit": 35})
        self.assertEqual(query({"limit": 7}), {"limit": 7})
        for bad in (20.5, "20.5", "twenty", True, float("nan"), float("inf")):
            with self.assertRaises(api.ContrastAPIError, msg=repr(bad)):
                query({"limit": bad})
        self.assertEqual(query({"min_cvss": 7}), {"min_cvss": "7.0"})
        self.assertEqual(query({"min_cvss": "7.5"}), {"min_cvss": "7.5"})
        with self.assertRaises(api.ContrastAPIError):
            query({"min_cvss": float("nan")})
        body = api.build_request("watchlist_edit", {"min_epss": 0.25}, "")[3]
        self.assertEqual(body, {"min_epss": 0.25})

    def test_path_is_quoted(self):
        url = api.build_request("email_address_check", {"email": "a+b@x.com"}, "")[1]
        self.assertEqual(url, f"{BASE}/email_address_check/a%2Bb%40x.com")
        url = api.build_request("dns_lookup", {"domain": "a/b"}, "")[1]
        self.assertEqual(url, f"{BASE}/dns_lookup/a%2Fb")
        url = api.build_request("dns_lookup", {"domain": "x.com?y=1#z"}, "")[1]
        self.assertEqual(url, f"{BASE}/dns_lookup/x.com%3Fy%3D1%23z")
        for bad in ({}, {"domain": ""}, {"domain": "  "}, {"domain": ".."}, {"domain": "."}):
            with self.assertRaises(api.ContrastAPIError, msg=repr(bad)):
                api.build_request("dns_lookup", bad, "")

    def test_arrays(self):
        for value in ("CVE-1-1, CVE-2-2", '["CVE-1-1","CVE-2-2"]', ["CVE-1-1", "CVE-2-2"], "CVE-1-1,, CVE-2-2, "):
            method, url, query, body, _ = api.build_request("cve_lookup_bulk", {"cve_ids": value}, "")
            self.assertEqual(method, "POST")
            self.assertEqual(url, f"{BASE}/cve_lookup_bulk")
            self.assertEqual(query, {})
            self.assertEqual(body, {"cve_ids": ["CVE-1-1", "CVE-2-2"]}, repr(value))
        for bad in ('["CVE-1-1", 2]', "[not json", [1, 2], {"a": 1}):
            with self.assertRaises(api.ContrastAPIError, msg=repr(bad)):
                api.build_request("cve_lookup_bulk", {"cve_ids": bad}, "")
        items = [{"ecosystem": "npm", "name": "lodash", "version": "4.17.20"}]
        body = api.build_request("package_check_bulk", {"items": json.dumps(items)}, "")[3]
        self.assertEqual(body, {"items": items})
        body = api.build_request("package_check_bulk", {"items": items}, "")[3]
        self.assertEqual(body, {"items": items})
        for bad in ("npm lodash 4.17.20", '{"ecosystem": "npm"}', '["lodash"]', "lodash,express", [["npm"]]):
            with self.assertRaises(api.ContrastAPIError, msg=repr(bad)):
                api.build_request("package_check_bulk", {"items": bad}, "")

    def test_password_hash(self):
        method, url, query, body, headers = api.build_request("password_check", {"password": "password"}, "")
        self.assertEqual(method, "GET")
        self.assertEqual(url, f"{BASE}/password_check/5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8")
        secret = "pässwörd"
        expected = hashlib.sha1(b"p\xc3\xa4ssw\xc3\xb6rd").hexdigest().upper()
        request = api.build_request("password_check", {"password": secret, "sha1_hash": "AA"}, "")
        self.assertEqual(request[1], f"{BASE}/password_check/{expected}")
        for part in (request[1], json.dumps(request[2]), json.dumps(request[3]), json.dumps(request[4])):
            self.assertNotIn(secret, part)
            self.assertNotIn("p%C3%A4ssw%C3%B6rd", part)
        with mock.patch("requests.request") as sent:
            for empty in ("", None):
                with self.assertRaises(api.ContrastAPIError):
                    list(api.invoke_operation(FakeTool({}), "password_check", {"password": empty}))
            with self.assertRaises(api.ContrastAPIError):
                list(api.invoke_operation(FakeTool({}), "password_check", {"sha1_hash": "AA" * 20}))
            sent.assert_not_called()


class ErrorTextTest(unittest.TestCase):
    def test_error_text(self):
        body = {"error": {"code": "payment_required", "message": "No credits.", "retry_after_seconds": 120}}
        text = api.error_text(402, json.dumps(body), "45")
        self.assertIn("Retry in 120 seconds", text)
        self.assertIn(api.PRICING_URL, text)
        text = api.error_text(429, "", "30")
        self.assertIn("Retry in 30 seconds", text)
        self.assertIn(api.PRICING_URL, text)
        text = api.error_text(429, "", None)
        self.assertNotIn("Retry in", text)
        self.assertIn(api.PRICING_URL, text)
        self.assertNotIn("Retry in", api.error_text(429, "", "soon; rm -rf"))
        body = {"error": {"code": "invalid_api_key", "message": "Unknown key."}}
        text = api.error_text(401, json.dumps(body), None)
        self.assertTrue(text.startswith("The API key was refused"))
        self.assertIn("Unknown key.", text)
        text = api.error_text(500, "<html>Bad Gateway</html>", None)
        self.assertIn("500", text)
        self.assertNotIn("<html>", text)
        body = {"error": {"code": "not_found", "message": "CVE not found."}}
        self.assertEqual(api.error_text(404, json.dumps(body), None),
                         "ContrastAPI answered 404 not_found: CVE not found.")
        long_body = {"error": {"code": "bad_request", "message": "x" * 5000}}
        text = api.error_text(400, json.dumps(long_body), None)
        self.assertIn("x" * 300, text)
        self.assertNotIn("x" * 301, text)


class InvokeTest(unittest.TestCase):
    def test_invoke_yields_json_and_raises(self):
        key = _make_key()
        tool = FakeTool({"api_key": key})
        payload = {"cve_id": "CVE-2021-44228", "cvss_v3": 10.0}
        with mock.patch("requests.request", return_value=FakeResponse(200, payload)) as sent:
            messages = list(api.invoke_operation(tool, "cve_lookup", {"cve_id": "CVE-2021-44228"}))
        self.assertEqual(messages, [("json", payload)])
        self.assertEqual(tool.messages, [payload])
        sent.assert_called_once()
        args, kwargs = sent.call_args
        self.assertEqual(args, ("GET", f"{BASE}/cve_lookup/CVE-2021-44228"))
        self.assertEqual(kwargs["timeout"], api.TIMEOUT_SECONDS)
        self.assertEqual(kwargs["headers"]["X-API-Key"], key)
        self.assertIs(kwargs["allow_redirects"], False)

        for no_key_tool in (FakeTool(None), FakeTool({}), FakeTool({"api_key": None})):
            with mock.patch("requests.request", return_value=FakeResponse(200, {})) as sent:
                list(api.invoke_operation(no_key_tool, "health", {}))
            self.assertNotIn("X-API-Key", sent.call_args.kwargs["headers"])

        missing = {"error": {"code": "not_found", "message": "CVE not found."}}
        with mock.patch("requests.request", return_value=FakeResponse(404, missing)) as sent:
            with self.assertRaises(api.ContrastAPIError) as caught:
                list(api.invoke_operation(tool, "cve_lookup", {"cve_id": "CVE-1999-0001"}))
        self.assertIn("404", str(caught.exception))
        sent.assert_called_once()

        with mock.patch("requests.request", side_effect=requests.ConnectionError("boom")) as sent:
            with self.assertRaises(api.ContrastAPIError) as caught:
                list(api.invoke_operation(tool, "cve_lookup", {"cve_id": "CVE-2021-44228"}))
        self.assertIn("ConnectionError", str(caught.exception))
        sent.assert_called_once()

        with mock.patch("requests.request", return_value=FakeResponse(200, "not json")):
            with self.assertRaises(api.ContrastAPIError):
                list(api.invoke_operation(tool, "cve_lookup", {"cve_id": "CVE-2021-44228"}))

        with mock.patch("requests.request", return_value=FakeResponse(302, "", {"Location": "https://x"})):
            with self.assertRaises(api.ContrastAPIError):
                list(api.invoke_operation(tool, "health", {}))

    def test_generated_tool_class_calls_api(self):
        from tools.cve_lookup import CveLookupTool

        tool = CveLookupTool(types.SimpleNamespace(credentials={}))
        with mock.patch("requests.request", return_value=FakeResponse(200, {"ok": 1})) as sent:
            messages = list(tool._invoke({"cve_id": "CVE-2021-44228"}))
        self.assertEqual(messages, [("json", {"ok": 1})])
        self.assertEqual(sent.call_args.args[1], f"{BASE}/cve_lookup/CVE-2021-44228")


class KeyFormatTest(unittest.TestCase):
    def test_key_format(self):
        body48 = "0123456789abcdef" * 3
        key = _make_key(body48)
        self.assertEqual(len(key), 68)
        self.assertTrue(api.is_key_format_valid(key))
        changed = "1" + body48[1:]
        self.assertFalse(api.is_key_format_valid(api.KEY_PREFIX + changed + key[-8:]))
        self.assertFalse(api.is_key_format_valid(key.upper()))
        self.assertFalse(api.is_key_format_valid(api.KEY_PREFIX + body48.upper() + key[-8:]))
        self.assertEqual(key[-8:], "b73ba778")
        self.assertFalse(api.is_key_format_valid(key[:-8] + key[-8:].upper()))
        self.assertFalse(api.is_key_format_valid(key[:-1]))
        self.assertFalse(api.is_key_format_valid(key + "0"))
        self.assertFalse(api.is_key_format_valid(key[len(api.KEY_PREFIX):]))
        self.assertFalse(api.is_key_format_valid("contrastapx_" + key[len(api.KEY_PREFIX):]))
        self.assertFalse(api.is_key_format_valid(""))
        self.assertFalse(api.is_key_format_valid(None))


if __name__ == "__main__":
    unittest.main()

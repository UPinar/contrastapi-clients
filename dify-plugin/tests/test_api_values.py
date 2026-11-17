"""Tests that pin literal values, error branches and the request wiring of _api.

Run: python3 -m unittest discover -s dify-plugin/tests -t dify-plugin -v
"""

import json
import unittest
import zlib
from unittest import mock

from tests import test_api as base  # installs the dify_plugin stub
from tools import _api as api
from provider.contrastapi import ContrastAPIProvider

PRICING = "https://api.contrastcyber.com/pricing"


def _literal_key():
    body48 = "0123456789abcdef" * 3
    return "contrastapi_" + body48 + "b73ba778"


class ConstantsTest(unittest.TestCase):
    def test_literals(self):
        self.assertEqual(format(zlib.crc32(("0123456789abcdef" * 3).encode("ascii")), "08x"), "b73ba778")
        self.assertTrue(api.is_key_format_valid(_literal_key()))
        self.assertEqual(api.TIMEOUT_SECONDS, 30)
        self.assertIn(PRICING, api.error_text(429, "", None))


class ErrorBranchTest(unittest.TestCase):
    def test_branches(self):
        self.assertEqual(api.error_text(401, "", None), "The API key was refused: HTTP 401")
        only_message = json.dumps({"error": {"message": "Bad vendor."}})
        self.assertEqual(api.error_text(400, only_message, None), "ContrastAPI answered 400: Bad vendor.")
        only_code = json.dumps({"error": {"code": "bad_request"}})
        self.assertEqual(api.error_text(400, only_code, None), "ContrastAPI answered HTTP 400.")

    def test_retry_parsing(self):
        zero = json.dumps({"error": {"retry_after_seconds": 0}})
        self.assertIn("Retry in 0 seconds", api.error_text(429, zero, "77"))
        flag = json.dumps({"error": {"retry_after_seconds": True}})
        self.assertIn("Retry in 77 seconds", api.error_text(429, flag, "77"))
        self.assertNotIn("Retry in", api.error_text(429, "", "1" * 10))

    def test_429_with_key_offers_no_pro_key(self):
        body = json.dumps({"error": {"code": "rate_limited", "message": "x", "retry_after_seconds": 120}})
        self.assertEqual(api.error_text(429, body, None, key_sent=True),
                         "Hourly credits are used up. Retry in 120 seconds.")
        self.assertEqual(api.error_text(429, "", None, key_sent=True), "Hourly credits are used up.")
        self.assertEqual(api.error_text(429, body, None),
                         f"Hourly credits are used up. Retry in 120 seconds, or add a Pro API key: {PRICING}")
        self.assertIn(PRICING, api.error_text(402, body, None, key_sent=True))

    def test_code_shape_and_control_characters(self):
        def answer(code, message="Bad."):
            return api.error_text(400, json.dumps({"error": {"code": code, "message": message}}), None)
        self.assertEqual(answer("Bad Code!"), "ContrastAPI answered 400: Bad.")
        self.assertEqual(answer("a" * 41), "ContrastAPI answered 400: Bad.")
        self.assertEqual(answer("a" * 40), "ContrastAPI answered 400 " + "a" * 40 + ": Bad.")
        self.assertEqual(answer("bad_request", "a\x1bb\nc\x7fd"), "ContrastAPI answered 400 bad_request: a b c d")


class BuildRequestValuesTest(unittest.TestCase):
    def test_dot_segment_message(self):
        with self.assertRaises(api.ContrastAPIError) as caught:
            api.build_request("dns_lookup", {"domain": ".."}, "")
        self.assertEqual(str(caught.exception), "domain is not a valid value.")
        with self.assertRaises(api.ContrastAPIError) as caught:
            api.build_request("dns_lookup", {"domain": ""}, "")
        self.assertEqual(str(caught.exception), "domain is required.")

    def test_lone_surrogate_password(self):
        with mock.patch("requests.request") as sent:
            with self.assertRaises(api.ContrastAPIError) as caught:
                list(api.invoke_operation(base.FakeTool({}), "password_check", {"password": "a\ud800b"}))
        sent.assert_not_called()
        self.assertNotIn("\ud800", str(caught.exception))
        self.assertNotIn("position", str(caught.exception))


class InvokeWiringTest(unittest.TestCase):
    def test_query_and_body_reach_requests(self):
        tool = base.FakeTool({})
        with mock.patch("requests.request", return_value=base.FakeResponse(200, {})) as sent:
            list(api.invoke_operation(tool, "cve_search", {"vendor": "apache", "limit": 5}))
        self.assertEqual(sent.call_args.kwargs["params"], {"vendor": "apache", "limit": 5})
        self.assertIsNone(sent.call_args.kwargs["json"])
        with mock.patch("requests.request", return_value=base.FakeResponse(200, {})) as sent:
            list(api.invoke_operation(tool, "cve_lookup_bulk", {"cve_ids": "CVE-1-1"}))
        self.assertEqual(sent.call_args.kwargs["json"], {"cve_ids": ["CVE-1-1"]})
        self.assertEqual(sent.call_args.kwargs["params"], {})

    def test_retry_header_and_redirect_with_json(self):
        tool = base.FakeTool({})
        with mock.patch("requests.request", return_value=base.FakeResponse(429, "", {"Retry-After": "30"})):
            with self.assertRaises(api.ContrastAPIError) as caught:
                list(api.invoke_operation(tool, "health", {}))
        self.assertIn("Retry in 30 seconds", str(caught.exception))
        self.assertIn(PRICING, str(caught.exception))
        with mock.patch("requests.request", return_value=base.FakeResponse(302, {"x": 1}, {"Location": "https://x"})):
            with self.assertRaises(api.ContrastAPIError):
                list(api.invoke_operation(tool, "health", {}))

    def test_429_with_saved_key(self):
        tool = base.FakeTool({"api_key": _literal_key()})
        with mock.patch("requests.request", return_value=base.FakeResponse(429, "", {"Retry-After": "30"})):
            with self.assertRaises(api.ContrastAPIError) as caught:
                list(api.invoke_operation(tool, "health", {}))
        self.assertEqual(str(caught.exception), "Hourly credits are used up. Retry in 30 seconds.")

    def test_saved_key_format(self):
        with mock.patch("requests.request") as sent:
            with self.assertRaises(api.ContrastAPIError) as caught:
                list(api.invoke_operation(base.FakeTool({"api_key": "not-a-key"}), "health", {}))
        sent.assert_not_called()
        self.assertNotIn("not-a-key", str(caught.exception))
        with mock.patch("requests.request", return_value=base.FakeResponse(200, {})) as sent:
            list(api.invoke_operation(base.FakeTool({"api_key": " " + _literal_key() + " "}), "health", {}))
        self.assertEqual(sent.call_args.kwargs["headers"]["X-API-Key"], _literal_key())


class ProviderExtraTest(unittest.TestCase):
    def test_retry_and_accept(self):
        key = "contrastapi_" + "fedcba9876543210" * 3
        key += format(zlib.crc32(key[12:].encode("ascii")), "08x")
        resp = base.FakeResponse(429, "", {"Retry-After": "30"})
        with mock.patch("requests.request", return_value=resp) as sent:
            with self.assertRaises(Exception) as caught:
                ContrastAPIProvider()._validate_credentials({"api_key": key})
        self.assertIn("Retry in 30 seconds", str(caught.exception))
        self.assertEqual(sent.call_args.kwargs["headers"]["Accept"], "application/json")


if __name__ == "__main__":
    unittest.main()

"""Tests for provider/contrastapi.py.

Run from the repository root:
python3 -m unittest discover -s dify-plugin/tests -t dify-plugin -v
"""

import json
import sys
import types
import unittest
import zlib
from unittest import mock


def _install_dify_stub():
    """Put a small stand-in for the dify_plugin package into sys.modules.

    The real package is not installed where these tests run. The stand-in has
    only the names the plugin imports. test_api.py installs the same names, so
    either file may run first.
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
from dify_plugin.errors.tool import ToolProviderCredentialValidationError  # noqa: E402

from provider.contrastapi import ContrastAPIProvider  # noqa: E402
from tools import _api as api  # noqa: E402

BODY48 = "fedcba9876543210" * 3
GOOD_KEY = api.KEY_PREFIX + BODY48 + format(zlib.crc32(BODY48.encode("ascii")), "08x")


class FakeResponse:
    def __init__(self, status_code, body=""):
        self.status_code = status_code
        self.text = body if isinstance(body, str) else json.dumps(body)
        self.headers = {}

    def json(self):
        return json.loads(self.text)


class ValidateCredentialsTest(unittest.TestCase):
    def setUp(self):
        self.provider = ContrastAPIProvider()

    def test_validate_credentials(self):
        with mock.patch("requests.request") as sent:
            self.provider._validate_credentials({})
            self.provider._validate_credentials({"api_key": ""})
            self.provider._validate_credentials({"api_key": "   "})
            self.provider._validate_credentials({"api_key": None})
            sent.assert_not_called()

        for bad in ("not-a-key", GOOD_KEY.upper(), GOOD_KEY[:-1] + ("0" if GOOD_KEY[-1] != "0" else "1")):
            with mock.patch("requests.request") as sent:
                with self.assertRaises(ToolProviderCredentialValidationError) as caught:
                    self.provider._validate_credentials({"api_key": bad})
                sent.assert_not_called()
                self.assertIn("contrastapi_ followed by 56 hex characters", str(caught.exception))
                self.assertNotIn(bad, str(caught.exception))

        with mock.patch("requests.request", return_value=FakeResponse(200, {"status": "ok"})) as sent:
            self.provider._validate_credentials({"api_key": f"  {GOOD_KEY} "})
        sent.assert_called_once()
        args, kwargs = sent.call_args
        self.assertEqual(args, ("GET", "https://api.contrastcyber.com/health"))
        self.assertEqual(kwargs["headers"]["X-API-Key"], GOOD_KEY)
        self.assertEqual(kwargs["headers"]["User-Agent"], api.USER_AGENT)
        self.assertEqual(kwargs["timeout"], api.TIMEOUT_SECONDS)
        self.assertIs(kwargs["allow_redirects"], False)

        refused = {"error": {"code": "invalid_api_key", "message": "Unknown key."}}
        with mock.patch("requests.request", return_value=FakeResponse(401, refused)):
            with self.assertRaises(ToolProviderCredentialValidationError) as caught:
                self.provider._validate_credentials({"api_key": GOOD_KEY})
        self.assertTrue(str(caught.exception).startswith("The API key was refused"))
        self.assertNotIn(GOOD_KEY, str(caught.exception))

        with mock.patch("requests.request", return_value=FakeResponse(503, "busy")):
            with self.assertRaises(ToolProviderCredentialValidationError) as caught:
                self.provider._validate_credentials({"api_key": GOOD_KEY})
        self.assertTrue(str(caught.exception).startswith("ContrastAPI could not check the key"))

        with mock.patch("requests.request", side_effect=requests.ConnectionError("down")):
            with self.assertRaises(ToolProviderCredentialValidationError) as caught:
                self.provider._validate_credentials({"api_key": GOOD_KEY})
        self.assertTrue(str(caught.exception).startswith("ContrastAPI could not check the key"))
        self.assertIn("ConnectionError", str(caught.exception))


if __name__ == "__main__":
    unittest.main()

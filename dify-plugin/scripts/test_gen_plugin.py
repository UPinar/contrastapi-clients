"""Tests for gen_plugin.py.

Run: python3 -m unittest discover -s dify-plugin/scripts -v
"""

import contextlib
import io
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path

import gen_plugin as gen

try:
    import yaml
except ImportError:
    yaml = None

ROOT = Path(__file__).resolve().parent.parent.parent
PLUGIN = ROOT / gen.PLUGIN_DIR
HAND_FILES = ("README.md", "PRIVACY.md", "manifest.yaml")
COUNT_PATTERNS = (re.compile(r"\b\d+\s+tools\b", re.IGNORECASE), re.compile(r"Tools \(\d+\)", re.IGNORECASE))
EM_DASH = "\u2014"


def _real_document():
    with open(ROOT / gen.SOURCE, encoding="utf-8") as handle:
        return json.load(handle)


def _readme_text():
    with open(PLUGIN / "README.md", encoding="utf-8") as handle:
        return handle.read()


def _fixture_op(op_id, params=None, method="get"):
    operation = {
        "operationId": op_id,
        "summary": op_id.title(),
        "description": f"Does {op_id}. More text.",
        "tags": ["Fixture"],
        "x-credit-cost": 1,
        "parameters": params or [],
    }
    return {f"/{op_id}": {method: operation}}


def _fixture_document(*path_items):
    paths = {}
    for item in path_items:
        paths.update(item)
    return {"openapi": "3.1.0", "paths": paths, "components": {"schemas": {}}}


def _tool(tools, op_id):
    return next(tool for tool in tools if tool["id"] == op_id)


def _param(tool, name):
    return next(param for param in tool["params"] if param["name"] == name)


class LoadToolsTest(unittest.TestCase):
    def test_tools_are_tagged_operations_without_excluded(self):
        tools = gen.load_tools(_real_document())
        ids = [tool["id"] for tool in tools]
        self.assertEqual(len(ids), 36)
        self.assertEqual(ids, sorted(ids))
        for absent in ("vendor_key_edit", "image_inspect", "api_key_claim", "crypto_checkout"):
            self.assertNotIn(absent, ids)
        for present in ("password_check", "watchlist_edit", "health"):
            self.assertIn(present, ids)

    def test_missing_excluded_tool_raises(self):
        document = _fixture_document(_fixture_op("alpha_tool"))
        with self.assertRaises(gen.GenError):
            gen.load_tools(document)

    def test_param_without_text_raises(self):
        bare = {"name": "zz_unknown", "in": "query", "schema": {"type": "string"}}
        document = _fixture_document(
            _fixture_op("vendor_key_edit", method="post"),
            _fixture_op("alpha_tool", [bare]),
        )
        with self.assertRaises(gen.GenError):
            gen.load_tools(document)
        bare["description"] = "Now it has a text"
        self.assertEqual(_param(_tool(gen.load_tools(document), "alpha_tool"), "zz_unknown")["text"],
                         "Now it has a text")

    def test_fallback_text_used(self):
        tools = gen.load_tools(_real_document())
        search = _tool(tools, "cve_search")
        self.assertTrue(_param(search, "vendor")["text"].startswith(gen.PARAM_TEXT_FALLBACK["vendor"]))
        self.assertTrue(_param(search, "limit")["text"].startswith(gen.PARAM_TEXT_FALLBACK["limit"]))
        self.assertTrue(_param(search, "limit")["text"].endswith("Maximum 100. Default 20."))
        products_vendor = _param(_tool(tools, "cve_products"), "vendor")["text"]
        self.assertFalse(products_vendor.startswith(gen.PARAM_TEXT_FALLBACK["vendor"]))
        events_limit = _param(_tool(tools, "watchlist_events"), "limit")["text"]
        self.assertFalse(events_limit.startswith(gen.PARAM_TEXT_FALLBACK["limit"]))


class HelperTest(unittest.TestCase):
    def test_dify_type_map(self):
        self.assertEqual(gen.dify_type({"type": "string", "enum": ["a", "b"]}), "select")
        self.assertEqual(gen.dify_type({"type": "integer", "enum": [1, 2]}), "select")
        self.assertEqual(gen.dify_type({"type": "integer"}), "number")
        self.assertEqual(gen.dify_type({"type": "number"}), "number")
        self.assertEqual(gen.dify_type({"type": "boolean"}), "boolean")
        self.assertEqual(gen.dify_type({"type": "string"}), "string")
        self.assertEqual(gen.dify_type({"type": "array", "items": {"type": "string"}}), "string")

    def test_label_text(self):
        self.assertEqual(gen.label_text("cve_ids"), "CVE IDs")
        self.assertEqual(gen.label_text("sha1_hash"), "SHA-1 Hash")
        self.assertEqual(gen.label_text("min_epss"), "Min EPSS")
        self.assertEqual(gen.label_text("dkim_selector"), "DKIM Selector")
        self.assertEqual(gen.label_text("include_full_header_values"), "Include Full Header Values")


class RenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = _real_document()
        cls.tools = gen.load_tools(cls.document)
        cls.outputs = gen.render_outputs(cls.document, _readme_text())

    def _yaml(self, relative):
        if yaml is None:
            self.skipTest("PyYAML is not installed")
        return yaml.safe_load(self.outputs[relative])

    def _yaml_param(self, op_id, name):
        loaded = self._yaml(f"tools/{op_id}.yaml")
        return next(p for p in loaded["parameters"] if p["name"] == name)

    def test_password_override(self):
        loaded = self._yaml("tools/password_check.yaml")
        params = loaded["parameters"]
        self.assertEqual([p["name"] for p in params], ["password"])
        password = params[0]
        self.assertEqual(password["type"], "secret-input")
        self.assertEqual(password["form"], "llm")
        self.assertIs(password["required"], True)
        self.assertEqual(password["label"]["en_US"], "Password")
        self.assertIn("passes through the AI model", password["human_description"]["en_US"])
        self.assertIn("passes through the AI model", password["llm_description"])
        self.assertIn("passes through the AI model", loaded["description"]["llm"])
        self.assertTrue(loaded["description"]["llm"].endswith("Costs 1 credit."))
        self.assertNotIn("sha1_hash", self.outputs["tools/password_check.yaml"])

    def test_tool_yaml_parses(self):
        names = sorted(key for key in self.outputs if key.startswith("tools/") and key.endswith(".yaml"))
        self.assertEqual(len(names), 36)
        for relative in names:
            stem = Path(relative).stem
            loaded = self._yaml(relative)
            self.assertEqual(loaded["identity"]["name"], stem)
            self.assertEqual(loaded["identity"]["author"], gen.AUTHOR)
            self.assertEqual(loaded["extra"]["python"]["source"], f"tools/{stem}.py")
            for param in loaded.get("parameters") or []:
                self.assertTrue(param["human_description"]["en_US"].strip(), f"{stem}.{param['name']}")
                self.assertTrue(param["llm_description"].strip(), f"{stem}.{param['name']}")
        self.assertIs(self._yaml_param("cve_lookup", "cve_id")["required"], True)
        self.assertIs(self._yaml_param("cve_lookup", "include_ghsa")["required"], False)
        self.assertIs(self._yaml_param("package_check_bulk", "items")["required"], True)
        self.assertIs(self._yaml_param("watchlist_edit", "action")["required"], False)
        self.assertTrue(self._yaml_param("cve_lookup_bulk", "cve_ids")["llm_description"].endswith(
            " Give a JSON array, or a comma-separated list of strings."))
        self.assertTrue(self._yaml_param("package_check_bulk", "items")["llm_description"].endswith(
            " Give a JSON array of objects."))

    def test_provider_yaml(self):
        loaded = self._yaml("provider/contrastapi.yaml")
        api_key = loaded["credentials_for_provider"]["api_key"]
        self.assertIs(api_key["required"], False)
        self.assertEqual(api_key["type"], "secret-input")
        self.assertEqual(len(loaded["tools"]), 36)
        self.assertEqual(loaded["tools"], sorted(loaded["tools"]))
        self.assertIn("tools/password_check.yaml", loaded["tools"])
        self.assertNotIn("tools/vendor_key_edit.yaml", loaded["tools"])
        keys = list(loaded)
        self.assertLess(keys.index("tools"), keys.index("extra"))
        self.assertEqual(loaded["extra"]["python"]["source"], "provider/contrastapi.py")

    def test_ops_kinds(self):
        namespace = {}
        exec(self.outputs["tools/_ops.py"], namespace)
        operations = namespace["OPERATIONS"]
        self.assertEqual(sorted(operations), sorted(tool["id"] for tool in self.tools))

        def param(op_id, name):
            return next(p for p in operations[op_id]["params"] if p["name"] == name)

        self.assertEqual(param("cve_search", "in_kev")["kind"], "boolean")
        self.assertEqual(param("cve_search", "known_ransomware")["kind"], "const_true")
        self.assertEqual(param("cve_search", "limit")["kind"], "integer")
        self.assertEqual(param("cve_search", "min_cvss")["kind"], "number")
        self.assertEqual(param("cve_search", "severity")["kind"], "string")
        self.assertEqual(param("cve_lookup_bulk", "cve_ids")["kind"], "string_array")
        self.assertEqual(param("cve_lookup_bulk", "cve_ids")["place"], "body")
        self.assertEqual(param("package_check_bulk", "items")["kind"], "object_array")
        self.assertEqual(param("cve_lookup", "cve_id")["place"], "path")
        self.assertEqual(param("cve_search", "limit")["place"], "query")
        self.assertEqual(operations["cve_lookup"]["path"], "/cve_lookup/{cve_id}")
        self.assertEqual(operations["cve_lookup_bulk"]["method"], "POST")
        self.assertEqual(operations["cve_lookup"]["method"], "GET")

    def test_select_options(self):
        severity = self._yaml_param("cve_search", "severity")
        self.assertEqual(severity["type"], "select")
        self.assertEqual([o["value"] for o in severity["options"]], ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"])
        self.assertEqual([o["label"]["en_US"] for o in severity["options"]],
                         ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"])
        sort = self._yaml_param("cve_search", "sort")
        self.assertEqual(sort["type"], "select")
        self.assertNotIn("default", sort)
        limit = self._yaml_param("cve_search", "limit")
        self.assertEqual(limit["type"], "number")
        self.assertEqual(limit["default"], 20)

    def test_outputs_deterministic(self):
        again = gen.render_outputs(self.document, _readme_text())
        self.assertEqual(list(again), list(self.outputs))
        for relative, text in self.outputs.items():
            self.assertEqual(again[relative].encode("utf-8"), text.encode("utf-8"), relative)
            self.assertTrue(text.endswith("\n"), relative)
            self.assertNotIn("\r", text, relative)

    def test_no_em_dash_no_count(self):
        texts = dict(self.outputs)
        for name in HAND_FILES:
            with open(PLUGIN / name, encoding="utf-8") as handle:
                texts[name] = handle.read()
        for relative, text in texts.items():
            self.assertNotIn(EM_DASH, text, relative)
            for pattern in COUNT_PATTERNS:
                self.assertIsNone(pattern.search(text), f"{relative}: {pattern.pattern}")


class CheckModeTest(unittest.TestCase):
    def _run(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = gen.main(list(argv))
        return code, out.getvalue()

    def test_check_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(PLUGIN, root / gen.PLUGIN_DIR, ignore=shutil.ignore_patterns("__pycache__"))
            (root / gen.SOURCE).parent.mkdir(parents=True)
            shutil.copyfile(ROOT / gen.SOURCE, root / gen.SOURCE)
            code, output = self._run("--check", "--root", str(root))
            self.assertEqual(code, 0, output)
            edited = root / gen.PLUGIN_DIR / "tools" / "cve_lookup.yaml"
            edited.write_text(edited.read_text(encoding="utf-8") + "# drift\n", encoding="utf-8")
            code, output = self._run("--check", "--root", str(root))
            self.assertEqual(code, 1)
            self.assertIn("tools/cve_lookup.yaml", output)
            self.assertTrue(edited.read_text(encoding="utf-8").endswith("# drift\n"))


if __name__ == "__main__":
    unittest.main()

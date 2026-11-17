"""Tests that pin the values gen_plugin.py writes, read back from a fresh render.

Run: python3 -m unittest discover -s dify-plugin/scripts -v
"""

import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import gen_plugin as gen
from test_gen_plugin import _fixture_document, _fixture_op

try:
    import yaml
except ImportError:
    yaml = None

ROOT = Path(__file__).resolve().parent.parent.parent
PLUGIN = ROOT / gen.PLUGIN_DIR


@unittest.skipIf(yaml is None, "PyYAML is not installed")
class RenderedValuesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(ROOT / gen.SOURCE, encoding="utf-8") as handle:
            cls.doc = json.load(handle)
        with open(PLUGIN / "README.md", encoding="utf-8") as handle:
            cls.out = gen.render_outputs(cls.doc, handle.read())

    def loaded(self, relative):
        return yaml.safe_load(self.out[relative])

    def label(self, op_id, name):
        params = self.loaded(f"tools/{op_id}.yaml")["parameters"]
        return next(p for p in params if p["name"] == name)["label"]["en_US"]

    def test_human_llm_label(self):
        op = self.doc["paths"]["/cve_lookup/{cve_id}"]["get"]
        tool = self.loaded("tools/cve_lookup.yaml")
        self.assertEqual(tool["identity"]["label"]["en_US"], op["summary"])
        self.assertTrue(tool["description"]["llm"].startswith(op["description"]))
        self.assertTrue(tool["description"]["llm"].endswith(" Costs 1 credit."))
        self.assertLess(len(tool["description"]["human"]), len(tool["description"]["llm"]))
        self.assertEqual(self.label("cve_search", "in_kev"), "In KEV")
        self.assertEqual(self.label("ip_lookup", "ip_address"), "IP Address")

    def test_credit_texts(self):
        self.assertIn("per item", self.loaded("tools/cve_lookup_bulk.yaml")["description"]["llm"])
        self.assertEqual(self.loaded("tools/cert_search.yaml")["description"]["llm"].count("Costs"), 1)
        self.assertFalse(self.loaded("tools/health.yaml")["description"]["llm"].endswith("Free."))

    def test_provider_and_readme(self):
        api_key = self.loaded("provider/contrastapi.yaml")["credentials_for_provider"]["api_key"]
        self.assertEqual(api_key["url"], "https://api.contrastcyber.com/pricing")
        self.assertIn("shared Dify host", api_key["help"]["en_US"])
        self.assertIn("### CVE Intelligence", self.out["README.md"])
        self.assertIn("### IP Intelligence", self.out["README.md"])
        kev = next(p for p in self.loaded("tools/cve_search.yaml")["parameters"] if p["name"] == "in_kev")
        self.assertTrue(kev["llm_description"].startswith("true: only CVEs in the CISA KEV catalog."))

    def test_yaml_line_breaks_are_escaped(self):
        for char in ("\u0085", "\u2028", "\u2029"):
            quoted = gen._q(f"a{char}b")
            self.assertNotIn(char, quoted)
            self.assertEqual(yaml.safe_load(quoted), f"a{char}b")


class PathShapeTest(unittest.TestCase):
    def test_path_that_changes_the_host_raises(self):
        excluded = _fixture_op("vendor_key_edit")
        for bad in ("@evil.com/x", "/x/../y", "//evil.com/x", "/x?y=1"):
            item = _fixture_op("tool_a")
            document = _fixture_document(excluded, {bad: item["/tool_a"]})
            with self.assertRaises(gen.GenError, msg=bad):
                gen.load_tools(document)
        document = _fixture_document(excluded, _fixture_op("tool_a"))
        self.assertEqual([tool["path"] for tool in gen.load_tools(document)], ["/tool_a"])


class StaleFileTest(unittest.TestCase):
    def test_write_mode_removes_stale_tool_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(PLUGIN, root / gen.PLUGIN_DIR, ignore=shutil.ignore_patterns("__pycache__"))
            (root / gen.SOURCE).parent.mkdir(parents=True)
            shutil.copyfile(ROOT / gen.SOURCE, root / gen.SOURCE)
            tools_dir = root / gen.PLUGIN_DIR / "tools"
            (tools_dir / "old_tool.yaml").write_text("identity: {}\n", encoding="utf-8")
            (tools_dir / "old_tool.py").write_text("\n", encoding="utf-8")
            kept = (tools_dir / "cve_lookup.yaml").read_text(encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = gen.main(["--root", str(root)])
            self.assertEqual(code, 0)
            self.assertFalse((tools_dir / "old_tool.yaml").exists())
            self.assertFalse((tools_dir / "old_tool.py").exists())
            self.assertTrue((tools_dir / "_api.py").exists())
            self.assertEqual((tools_dir / "cve_lookup.yaml").read_text(encoding="utf-8"), kept)


if __name__ == "__main__":
    unittest.main()

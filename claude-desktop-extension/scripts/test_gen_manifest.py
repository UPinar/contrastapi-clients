"""Tests for gen_manifest.py.

Run: python3 -m unittest discover -s claude-desktop-extension/scripts -v
"""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import gen_manifest as gen


def _tool(name, title, description, category):
    return {
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": {"type": "object"},
        "annotations": {"readOnlyHint": True},
        "_meta": {gen.CATEGORY_KEY: category},
    }


FIXTURE_TOOLS = [
    _tool("zeta_tool", "Zeta Tool", "Reads zeta. More text here.", "Beta Group"),
    _tool("alpha_tool", "Alpha: Tool", "Checks e.g. CVE-2021-44228. Then more.", "Alpha Group"),
    _tool("mid_tool", "Mid Tool", "Decodes CVSS v3.0/v3.1 vectors", "Beta Group"),
]

FIXTURE_SNAPSHOT = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"tools": FIXTURE_TOOLS}})

FIXTURE_MANIFEST = {
    "manifest_version": "0.3",
    "name": "fixture",
    "version": "9.9.9",
    "description": "Keeps “quotes” and — dashes.",
    "server": {"type": "node", "entry_point": "server/index.js"},
    "tools": [{"name": "old_tool", "description": "Old."}],
    "keywords": ["a", "b"],
}

FIXTURE_README = (
    "# Title\n\nIntro.\n\n<!-- tools:start -->\nold list\n<!-- tools:end -->\n\n## After\n\nKept.\n"
)


class FirstSentenceTest(unittest.TestCase):
    def test_cuts_at_period_before_space(self):
        self.assertEqual(gen.first_sentence("One two. Three four."), "One two.")

    def test_does_not_cut_inside_eg(self):
        self.assertEqual(
            gen.first_sentence("Pass a host, e.g. www.example.com, here. Next."),
            "Pass a host, e.g. www.example.com, here.",
        )

    def test_does_not_cut_inside_ie(self):
        self.assertEqual(
            gen.first_sentence("Use the id, i.e. the CVE id, as is. Next."),
            "Use the id, i.e. the CVE id, as is.",
        )

    def test_does_not_cut_after_cf_or_vs(self):
        self.assertEqual(
            gen.first_sentence("Rank by EPSS vs. CVSS, cf. cve_triage. Next."),
            "Rank by EPSS vs. CVSS, cf. cve_triage.",
        )

    def test_does_not_cut_inside_version(self):
        self.assertEqual(
            gen.first_sentence("Decode a CVSS v3.0/v3.1 vector of 1.2 weight. Next."),
            "Decode a CVSS v3.0/v3.1 vector of 1.2 weight.",
        )

    def test_does_not_cut_inside_cve_id_or_sub_technique(self):
        self.assertEqual(
            gen.first_sentence("Look up CVE-2021-44228 and T1055.012 together. Next."),
            "Look up CVE-2021-44228 and T1055.012 together.",
        )

    def test_cve_id_at_sentence_end_ends_it(self):
        self.assertEqual(gen.first_sentence("Look up CVE-2021-44228. Next."), "Look up CVE-2021-44228.")

    def test_next_sentence_may_start_lowercase(self):
        self.assertEqual(
            gen.first_sentence("Full record by id. affected_products is a page."),
            "Full record by id.",
        )

    def test_closing_bracket_stays_with_sentence(self):
        self.assertEqual(gen.first_sentence("Many at once (max 50.) Next."), "Many at once (max 50.)")

    def test_question_and_exclamation_marks_end_a_sentence(self):
        self.assertEqual(gen.first_sentence("Is it up? Next."), "Is it up?")
        self.assertEqual(gen.first_sentence("Stop now! Next."), "Stop now!")

    def test_does_not_cut_inside_us(self):
        self.assertEqual(gen.first_sentence("Ask a U.S. agency now. Next."), "Ask a U.S. agency now.")

    def test_does_not_cut_after_eg_in_brackets_or_cf_at_start(self):
        self.assertEqual(gen.first_sentence("Rank (e.g. by EPSS) here. Next."), "Rank (e.g. by EPSS) here.")
        self.assertEqual(gen.first_sentence("Cf. the docs here. Next."), "Cf. the docs here.")

    def test_text_without_end_is_whole(self):
        self.assertEqual(gen.first_sentence("No end  here"), "No end here")


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.tools = gen.load_tools(FIXTURE_SNAPSHOT)
        self.manifest_text = json.dumps(FIXTURE_MANIFEST, indent=2, ensure_ascii=False) + "\n"
        self.out = json.loads(gen.render_manifest(self.manifest_text, self.tools))

    def test_description_is_title_separator_first_sentence(self):
        self.assertEqual(self.out["tools"][1]["description"], "Alpha: Tool. Checks e.g. CVE-2021-44228.")
        self.assertEqual(self.out["tools"][2]["description"], "Mid Tool. Decodes CVSS v3.0/v3.1 vectors")

    def test_tools_keep_snapshot_order(self):
        self.assertEqual([t["name"] for t in self.out["tools"]], ["zeta_tool", "alpha_tool", "mid_tool"])

    def test_tool_entries_hold_name_and_description_only(self):
        for entry in self.out["tools"]:
            self.assertEqual(list(entry), ["name", "description"])

    def test_other_keys_keep_value_and_order(self):
        self.assertEqual(list(self.out), list(FIXTURE_MANIFEST))
        for key, value in FIXTURE_MANIFEST.items():
            if key != "tools":
                self.assertEqual(self.out[key], value)

    def test_formatting_is_indent_two_unescaped_with_newline(self):
        text = gen.render_manifest(self.manifest_text, self.tools)
        self.assertTrue(text.endswith("}\n"))
        self.assertIn("“quotes” and — dashes", text)
        self.assertIn('\n  "name": "fixture",\n', text)

    def test_unchanged_tools_round_trip_byte_for_byte(self):
        once = gen.render_manifest(self.manifest_text, self.tools)
        self.assertEqual(gen.render_manifest(once, self.tools), once)

    def _assert_snapshot_refused(self, change):
        snapshot = json.loads(FIXTURE_SNAPSHOT)
        change(snapshot["result"]["tools"])
        with self.assertRaises(gen.SnapshotError):
            gen.load_tools(json.dumps(snapshot))

    def test_tool_without_title_is_refused(self):
        self._assert_snapshot_refused(lambda tools: tools[0].pop("title"))

    def test_tool_without_description_is_refused(self):
        self._assert_snapshot_refused(lambda tools: tools[0].pop("description"))

    def test_tool_without_category_is_refused(self):
        self._assert_snapshot_refused(lambda tools: tools[0].pop("_meta"))

    def test_empty_tool_list_is_refused(self):
        self._assert_snapshot_refused(lambda tools: tools.clear())

    def test_title_and_category_spaces_are_stripped(self):
        tool = _tool("a_tool", " A Tool ", "Does a. More.", " G ")
        self.assertEqual(gen.manifest_description(tool), "A Tool. Does a.")
        self.assertEqual(gen.render_tool_section([tool]), "### G\n\n- **A Tool** (`a_tool`)")


class VersionTest(unittest.TestCase):
    def test_package_versions_equal_the_manifest_version(self):
        root = Path(__file__).resolve().parent.parent
        version = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
        package = json.loads((root / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], version)
        self.assertEqual(lock["version"], version)
        self.assertEqual(lock["packages"][""]["version"], version)


class ReadmeTest(unittest.TestCase):
    def setUp(self):
        self.tools = gen.load_tools(FIXTURE_SNAPSHOT)

    def test_section_between_markers_is_rewritten(self):
        out = gen.render_readme(FIXTURE_README, self.tools)
        self.assertEqual(
            out,
            "# Title\n\nIntro.\n\n<!-- tools:start -->\n\n"
            "### Beta Group\n\n"
            "- **Zeta Tool** (`zeta_tool`)\n"
            "- **Mid Tool** (`mid_tool`)\n\n"
            "### Alpha Group\n\n"
            "- **Alpha: Tool** (`alpha_tool`)\n\n"
            "<!-- tools:end -->\n\n## After\n\nKept.\n",
        )

    def test_rewrite_is_stable(self):
        once = gen.render_readme(FIXTURE_README, self.tools)
        self.assertEqual(gen.render_readme(once, self.tools), once)

    def test_missing_marker_is_refused(self):
        with self.assertRaises(gen.SnapshotError):
            gen.render_readme("# Title\n<!-- tools:start -->\n", self.tools)

    def test_two_start_markers_are_refused(self):
        with self.assertRaises(gen.SnapshotError):
            gen.render_readme(FIXTURE_README.replace("old list", gen.README_START), self.tools)

    def test_end_marker_before_start_is_refused(self):
        with self.assertRaises(gen.SnapshotError):
            gen.render_readme("<!-- tools:end -->\nx\n<!-- tools:start -->\n", self.tools)


class CheckModeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "tools_list.json").write_text(FIXTURE_SNAPSHOT, encoding="utf-8")
        (self.root / "manifest.json").write_text(
            json.dumps(FIXTURE_MANIFEST, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (self.root / "README.md").write_text(FIXTURE_README, encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, *args):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(io.StringIO()):
            code = gen.main([*args, "--root", str(self.root)])
        return code, stdout.getvalue()

    def write_snapshot(self, snapshot):
        (self.root / "tools_list.json").write_text(json.dumps(snapshot), encoding="utf-8")

    def test_check_reports_stale_files_and_writes_nothing(self):
        before = {name: (self.root / name).read_bytes() for name in ("manifest.json", "README.md")}
        code, out = self.run_main("--check")
        self.assertEqual(code, 1)
        self.assertIn("manifest.json: would change", out)
        self.assertIn("README.md: would change", out)
        self.assertIn("removed: old_tool", out)
        self.assertIn("added: zeta_tool", out)
        self.assertEqual({name: (self.root / name).read_bytes() for name in before}, before)

    def test_check_names_a_changed_description_and_a_new_order(self):
        self.run_main()
        snapshot = json.loads(FIXTURE_SNAPSHOT)
        snapshot["result"]["tools"][0]["description"] = "Reads zeta again. More."
        self.write_snapshot(snapshot)
        self.assertIn("description: zeta_tool", self.run_main("--check")[1])
        self.run_main()
        snapshot["result"]["tools"].reverse()
        self.write_snapshot(snapshot)
        self.assertIn("order changed", self.run_main("--check")[1])

    def test_check_is_clean_after_generation(self):
        self.assertEqual(self.run_main()[0], 0)
        self.assertEqual(self.run_main("--check"), (0, ""))

    def test_check_flags_a_readme_only_change(self):
        self.run_main()
        readme = self.root / "README.md"
        readme.write_text(readme.read_text(encoding="utf-8").replace("Zeta Tool", "Zeta"), encoding="utf-8")
        code, out = self.run_main("--check")
        self.assertEqual(code, 1)
        self.assertNotIn("manifest.json", out)
        self.assertIn("README.md: would change", out)

    def test_bad_snapshot_exits_two(self):
        (self.root / "tools_list.json").write_text('{"error": {}}', encoding="utf-8")
        self.assertEqual(self.run_main("--check")[0], 2)

    def test_bad_manifest_exits_two(self):
        (self.root / "manifest.json").write_text("{", encoding="utf-8")
        self.assertEqual(self.run_main("--check")[0], 2)
        (self.root / "manifest.json").write_text('{"name": "x"}', encoding="utf-8")
        self.assertEqual(self.run_main("--check")[0], 2)


if __name__ == "__main__":
    unittest.main()

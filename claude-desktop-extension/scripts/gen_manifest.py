#!/usr/bin/env python3
"""Generate the extension's tool list from the server's tools/list snapshot.

The bridge forwards the host's tools/list to the server and lists no tool
of its own. This script keeps the ``tools`` array of ``manifest.json``, and
the tool section of ``README.md``, in step with the committed snapshot
``tools_list.json`` (the JSON-RPC response of the C server's
``make -s tools-list``).

Each manifest description is the tool's title, an em dash, and the first
sentence of its description. The em dash is the separator because titles
("Watchlist: CVE and Domain Monitoring") and descriptions ("Database
freshness: ...") already hold colons.

Usage: gen_manifest.py [--check] [--root DIR]
"""

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

DESCRIPTION_SEPARATOR = ". "
CATEGORY_KEY = "com.contrastcyber/category"
README_START = "<!-- tools:start -->"
README_END = "<!-- tools:end -->"

_SENTENCE_END = re.compile(r"[.!?][)\"']*(?=\s|$)")
_ABBREVIATIONS = frozenset({"cf.", "vs."})
_DOTTED_INITIALS = re.compile(r"(?:[A-Za-z]\.){2,}")


class SnapshotError(Exception):
    """The snapshot, manifest or README cannot be used as it is."""


def first_sentence(text):
    """Return the first sentence of text, with its closing punctuation.

    A sentence ends at ".", "!" or "?" (and any closing parenthesis or quote)
    that whitespace or the end of the text follows. A period inside a token,
    as in "1.2", "v3.1" or "T1055.012", has no whitespace after it. A period
    after "e.g.", "i.e.", "U.S.", "cf." or "vs." does not end a sentence.
    A text with no sentence end is returned whole.
    """
    flat = " ".join(text.split())
    for match in _SENTENCE_END.finditer(flat):
        head = flat[: match.end()]
        token = head.rsplit(" ", 1)[-1].lstrip("([\"'").rstrip(")\"'")
        if token.lower() in _ABBREVIATIONS or _DOTTED_INITIALS.fullmatch(token):
            continue
        return head
    return flat


def load_tools(snapshot_text):
    """Return the tool list of a tools/list JSON-RPC response."""
    try:
        response = json.loads(snapshot_text)
        tools = response["result"]["tools"]
    except (ValueError, KeyError, TypeError) as exc:
        raise SnapshotError(f"snapshot is not a tools/list result: {exc}") from exc
    if not isinstance(tools, list) or not tools:
        raise SnapshotError("snapshot holds no tools")
    for index, tool in enumerate(tools):
        for key in ("name", "title", "description"):
            if not isinstance(tool.get(key), str) or not tool[key].strip():
                raise SnapshotError(f"tool #{index} has no {key}")
        category = (tool.get("_meta") or {}).get(CATEGORY_KEY)
        if not isinstance(category, str) or not category.strip():
            raise SnapshotError(f"tool {tool['name']} has no category")
    return tools


def manifest_description(tool):
    """Return the manifest description of one tool."""
    return f"{tool['title'].strip()}{DESCRIPTION_SEPARATOR}{first_sentence(tool['description'])}"


def render_manifest(manifest_text, tools):
    """Return manifest_text with its tools array rebuilt from tools.

    Every other key keeps its value and its place.
    """
    manifest = json.loads(manifest_text)
    if "tools" not in manifest:
        raise SnapshotError("manifest.json has no tools key")
    manifest["tools"] = [
        {"name": tool["name"], "description": manifest_description(tool)}
        for tool in tools
    ]
    return json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"


def render_tool_section(tools):
    """Return the README tool list, grouped by category in first-seen order."""
    groups = {}
    for tool in tools:
        category = tool["_meta"][CATEGORY_KEY].strip()
        line = f"- **{tool['title'].strip()}** (`{tool['name']}`)"
        groups.setdefault(category, []).append(line)
    return "\n\n".join(
        f"### {category}\n\n" + "\n".join(lines) for category, lines in groups.items()
    )


def render_readme(readme_text, tools):
    """Return readme_text with the text between the tool markers rebuilt."""
    if readme_text.count(README_START) != 1 or readme_text.count(README_END) != 1:
        raise SnapshotError("README.md needs exactly one start and one end tool marker")
    start = readme_text.index(README_START) + len(README_START)
    end = readme_text.index(README_END)
    if end < start:
        raise SnapshotError("README.md tool end marker comes before the start marker")
    section = render_tool_section(tools)
    return f"{readme_text[:start]}\n\n{section}\n\n{readme_text[end:]}"


def diff_summary(name, old, new):
    """Return one line that says how many lines would change in a file."""
    added = removed = 0
    for line in difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm=""):
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1
    return f"{name}: would change (+{added} -{removed} lines)"


def tool_changes(old_manifest, new_manifest):
    """Return lines naming the tools that are added, removed or rewritten."""
    old = {t["name"]: t.get("description") for t in json.loads(old_manifest).get("tools", [])}
    new = {t["name"]: t["description"] for t in json.loads(new_manifest)["tools"]}
    lines = [f"  added: {n}" for n in new if n not in old]
    lines += [f"  removed: {n}" for n in old if n not in new]
    lines += [f"  description: {n}" for n in new if n in old and old[n] != new[n]]
    if not lines and list(old) != list(new):
        lines.append("  order changed")
    return lines


def _read(path):
    with open(path, encoding="utf-8", newline="") as handle:
        return handle.read()


def _write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def main(argv=None):
    """Rewrite manifest.json and README.md, or with --check only report.

    Returns 0 when nothing changes (or after a rewrite), 1 when --check
    finds a file that would change, and 2 on unusable input.
    """
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="exit 1 if a file would change; write nothing")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="extension directory (default: the parent of scripts/)")
    args = parser.parse_args(argv)

    snapshot_path = args.root / "tools_list.json"
    manifest_path = args.root / "manifest.json"
    readme_path = args.root / "README.md"
    try:
        tools = load_tools(_read(snapshot_path))
        old_manifest = _read(manifest_path)
        old_readme = _read(readme_path)
        new_manifest = render_manifest(old_manifest, tools)
        new_readme = render_readme(old_readme, tools)
    except (OSError, ValueError, SnapshotError) as exc:
        print(f"gen_manifest: {exc}", file=sys.stderr)
        return 2

    changed = []
    if new_manifest != old_manifest:
        changed.append(diff_summary("manifest.json", old_manifest, new_manifest))
        changed.extend(tool_changes(old_manifest, new_manifest))
    if new_readme != old_readme:
        changed.append(diff_summary("README.md", old_readme, new_readme))

    if args.check:
        for line in changed:
            print(line)
        return 1 if changed else 0

    if new_manifest != old_manifest:
        _write(manifest_path, new_manifest)
    if new_readme != old_readme:
        _write(readme_path, new_readme)
    for line in changed:
        print(line.replace("would change", "rewritten", 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

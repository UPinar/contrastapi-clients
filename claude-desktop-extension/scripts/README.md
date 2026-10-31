# Tool list generator

`manifest.json` `tools` and the tool section of `README.md` come from `tools_list.json`, a committed snapshot of the server's tools/list answer.

1. Refresh the snapshot from the C server repository:
   `make -s -C <C repo> tools-list > claude-desktop-extension/tools_list.json`
2. Regenerate both files: `python3 claude-desktop-extension/scripts/gen_manifest.py`
3. Check that they match the snapshot (exit 1 if a file would change):
   `python3 claude-desktop-extension/scripts/gen_manifest.py --check`
4. Run the tests: `python3 -m unittest discover -s claude-desktop-extension/scripts -v`

`scripts/` and `tools_list.json` stay out of the `.mcpb` bundle (see `.mcpbignore`).

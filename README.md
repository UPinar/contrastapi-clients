# ContrastAPI clients

This repository holds the clients of [ContrastAPI](https://api.contrastcyber.com).
ContrastAPI is a security data API and an MCP server.
The server itself lives in a separate repository.

| Client | Directory | Install |
|---|---|---|
| Node.js SDK | [`sdk/node`](sdk/node) | `npm install contrastapi` |
| Python SDK | [`sdk/python`](sdk/python) | `pip install contrastapi` |
| VS Code extension | [`vscode-extension`](vscode-extension) | `code --install-extension ContrastAPI.contrastapi`, or search "ContrastAPI" in the VS Code Marketplace |
| Claude Desktop extension | [`claude-desktop-extension`](claude-desktop-extension) | Download the `.mcpb` file from the [Releases](https://github.com/UPinar/contrastapi-clients/releases) page and open it in Claude Desktop |

`sdk/gen` holds the generator that writes the operation files of both SDKs from `sdk/openapi.json`.

## Documentation

- API quickstart: https://api.contrastcyber.com/quickstart
- MCP setup (Claude Desktop, Cursor, Windsurf and others): https://api.contrastcyber.com/mcp-setup

Each client has its own README with the details.

## Running the tests

Run these from the repository root.
CI runs the same commands (`.github/workflows/tests.yml`).

```bash
# Node.js SDK
(cd sdk/node && npm test)

# Python SDK
(cd sdk/python && python3 -m venv .venv && .venv/bin/pip install -e '.[test]' && .venv/bin/python -m pytest)

# SDK generator: its tests, then a check that the generated files are up to date
python3 -m unittest discover -s sdk/gen
python3 sdk/gen/gen_sdk.py --check

# VS Code extension: type check, build and tests (the tests need no VS Code window)
(cd vscode-extension && npm ci && npx tsc --noEmit -p . && npm run build && npm test)

# Claude Desktop extension: manifest generator tests and a check of the generated files
python3 -m unittest discover -s claude-desktop-extension/scripts
python3 claude-desktop-extension/scripts/gen_manifest.py --check
```

## Security

Please report a vulnerability privately.
The policy is in [SECURITY.md](.github/SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

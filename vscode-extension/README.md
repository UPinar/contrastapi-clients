# ContrastAPI — Security Intelligence for VS Code

Security lookups in your editor. The extension reads its tools from the ContrastAPI server. A new server tool appears after the next refresh of the tool list, without an extension update.

It talks to the server over MCP. This is the same endpoint that agents in Claude Desktop, Cursor and Windsurf use. See the [MCP setup page](https://api.contrastcyber.com/mcp-setup).

## What you can do

- **Browse tools.** Open the ContrastAPI icon in the Activity Bar. The Security Tools view groups the server's tools by category, for example CVE, domain, IP and package checks.
- **Run any tool.** Command Palette, then `ContrastAPI: Run Tool…`. The form asks for the required fields. Optional fields sit behind **Add filter…**. The menu shows the values already set, and picking one changes or clears it.
- **Use a shortcut.** The palette has direct commands for CVE Lookup, IP Lookup, DNS Lookup, SSL Check and Package Check.
- **Read the result.** The result opens in a panel beside the editor. **Copy JSON** puts the raw answer on the clipboard.

## Watchlist

The Watchlist view needs a Pro API key. Without one, the view says so. A notification then offers a button that opens the pricing page.

- The view lists your watch items with the count against the limit.
- Events stand under the item they matched. An event that matches two items shows under both.
- Add or remove one item, or clear the whole list. Clearing the list deletes the read position, and so does removing the last item.
- **Fetch New Events** adds the new events to the ones the view shows. When there is no new event, the view keeps its events and a notification says "No new events." The view keeps at most 500 events and drops the oldest first.
- **Fetch New Events** moves the read position of your API key. Every client that uses the same key shares this position, agents included. An agent's next plain call starts after the events you fetched here.
- **Refresh Watchlist** re-reads the items and keeps the shown events. It does not move the position.
- The shown events are kept between sessions on this machine, one set per server. A new API key or a new server URL clears them. The first open without kept events re-reads the last batch of events, which does not move the position.
- A **Watch** button in the result panel adds the item you just looked up. Only tools the watchlist can watch get the button, for example CVE Lookup, DNS Lookup and SSL/TLS Certificate Check.

## Credits and the tool list

Most calls spend 1 credit. A few cost more, and `health` is free. The status bar shows the credits left after your last call. Before the first call it shows no number. Click it to set an API key.

The extension stores the tool list and reuses it. At start-up it fetches a new list when the stored one is older than 24 hours. The refresh button in the Security Tools view fetches a new list at any time. Fetching the list costs 1 credit.

You can use the extension without an API key. Anonymous callers get a smaller hourly credit allowance than callers with a key. A key raises it. Get one at [contrastcyber.com](https://contrastcyber.com).

## API key

Run `ContrastAPI: Set API Key` from the Command Palette, or click the status bar item. `ContrastAPI: Clear API Key` removes it.

- VS Code stores the key in its SecretStorage.
- The extension sends the key only to `api.contrastcyber.com` over https, or to localhost over http or https.

## Settings

- `contrastapi.baseUrl`: the server URL. The default is `https://api.contrastcyber.com`. It must use https, except for localhost. It is an application-level setting, so a workspace cannot change it.
- `contrastapi.mcp.register`: `off` (default) or `on`. With `on`, the extension also registers the server with VS Code's own MCP support. An agent in VS Code chat can then call the tools with your API key and your credits. The server marks most tools read-only, and VS Code runs tools marked read-only without asking. Leave it `off` if you do not want that. It is an application-level setting too, so a workspace cannot turn it on. If the server refuses your API key, the extension does not start the MCP server and shows a warning instead.

## Requirements

- VS Code 1.101 or newer
- Internet connection

## Links

- [MCP Setup](https://api.contrastcyber.com/mcp-setup) — Claude Desktop, Cursor and Windsurf
- [GitHub](https://github.com/UPinar/contrastapi) — source code and issues
- [Website](https://contrastcyber.com)

## License

MIT

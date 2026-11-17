# Privacy

This plugin runs inside your Dify instance. It sends each tool call to https://api.contrastcyber.com and to no other host. The call carries the tool's arguments and, if you saved one, your API key. The plugin stores nothing itself.

The password_check tool takes a password, computes its SHA-1 in the plugin and sends only the hash. ContrastAPI sends Have I Been Pwned only the first 5 hex digits of that hash. The text you type still passes through the AI model and Dify's own logs, so check a candidate password, not one in use.

What ContrastAPI keeps, in short:

- Rate limiting: one row per credit budget, under an HMAC of your IP address or the SHA-256 of your API key. A cleanup job deletes it shortly after its hour ends.
- Usage log: one line per connection, with no IP address, no API key and no argument value.
- Kept answers: some lookups keep their answer for a while, stored under the host name, registrable domain or CVE id, with no API key and no IP address of the caller.
- Web server: its access log holds the IP address, the request path without its query, the user agent and the referer. It logs nothing about a /password_check/ request.
- Watchlist: a Pro key's watched items and their change events.

The full policy is at https://api.contrastcyber.com/privacy.

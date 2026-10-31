import * as crypto from "crypto";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Returns a fresh random nonce for the page's script policy. */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

const URL_REGEX = /^https?:\/\/\S+$/;

function isUrl(v: string): boolean {
  return URL_REGEX.test(v);
}

function formatKey(key: string): string {
  return esc(
    key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  );
}

function badgeClass(value: string): string {
  const v = value.toLowerCase();
  if (v === "critical") return "badge-critical";
  if (v === "high")     return "badge-high";
  if (v === "medium")   return "badge-medium";
  if (v === "low")      return "badge-low";
  return "badge-info";
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return esc(String(value));
  if (typeof value === "string") {
    if (isUrl(value)) {
      return `<a href="${esc(value)}">${esc(value)}</a>`;
    }
    return esc(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "-";
    if (typeof value[0] === "object" && value[0] !== null) {
      return renderTable(value);
    }
    return esc(value.join(", "));
  }
  if (typeof value === "object") {
    return renderKvPairs(value as Record<string, unknown>);
  }
  return esc(String(value));
}

function renderKvPairs(obj: Record<string, unknown>): string {
  const rows = Object.entries(obj)
    .map(
      ([k, v]) =>
        `<div class="kv-row"><span class="kv-key">${formatKey(k)}</span><span class="kv-value">${renderValue(v)}</span></div>`,
    )
    .join("\n");
  return `<div class="section">${rows}</div>`;
}

function renderTable(arr: Record<string, unknown>[]): string {
  const keys = Object.keys(arr[0]);
  const ths = keys.map((k) => `<th>${formatKey(k)}</th>`).join("");
  const rows = arr
    .map((row) => {
      const tds = keys.map((k) => `<td>${renderValue(row[k])}</td>`).join("");
      return `<tr>${tds}</tr>`;
    })
    .join("\n");
  return `<table class="result-table"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderBody(data: unknown): string {
  if (data === null || data === undefined) return "<p>No data</p>";
  if (typeof data !== "object") return `<p>${renderValue(data)}</p>`;
  if (Array.isArray(data)) {
    if (data.length === 0) return "<p>No results</p>";
    if (typeof data[0] === "object" && data[0] !== null) {
      return renderTable(data as Record<string, unknown>[]);
    }
    return `<p>${esc(data.join(", "))}</p>`;
  }

  const obj = data as Record<string, unknown>;
  let html = "";

  if (obj.summary) {
    html += `<p class="result-summary">${esc(String(obj.summary))}</p>`;
  }

  if (obj.grade !== undefined || obj.score !== undefined) {
    const label = obj.grade !== undefined ? String(obj.grade) : String(obj.score);
    html += `<p><span class="badge ${badgeClass(label)}">${esc(label)}</span></p>`;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === "summary" || key === "grade" || key === "score") continue;
    if (typeof value === "object" && value !== null) {
      html += `<div class="section"><div class="section-title">${formatKey(key)}</div>${renderValue(value)}</div>`;
    } else {
      html += `<div class="kv-row"><span class="kv-key">${formatKey(key)}</span><span class="kv-value">${renderValue(value)}</span></div>`;
    }
  }

  return html;
}

function renderWatchButton(watchLabel: string | undefined): string {
  return watchLabel === undefined ? "" : `<button class="copy-btn" id="watchBtn">${esc(watchLabel)}</button>`;
}

function renderWatchScript(watchLabel: string | undefined): string {
  if (watchLabel === undefined) {
    return "";
  }
  return `
    const watchBtn = document.getElementById('watchBtn');
    watchBtn.addEventListener('click', () => {
      watchBtn.disabled = true;
      vscode.postMessage({ type: 'watch' });
    });
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'watched' && typeof msg.label === 'string') {
        watchBtn.textContent = msg.label;
      } else if (msg && msg.type === 'watchFailed') {
        watchBtn.disabled = false;
      }
    });`;
}

/**
 * Renders a tool answer as the result panel's page.
 * cssUri is the webview URI of result.css as text, so this module needs no vscode import and runs in tests.
 * watchLabel adds a Watch button next to Copy JSON.
 * Without watchLabel the page has no Watch button and no watch script.
 * The label is escaped, and the button's later text is set with textContent, so a label never becomes markup.
 */
export function renderResult(
  title: string,
  data: unknown,
  cssUri: string,
  nonce: string,
  cspSource: string,
  watchLabel?: string,
): string {
  const now = new Date().toISOString();
  const jsonStr = JSON.stringify(data, null, 2)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>${esc(title)}</title>
</head>
<body>
  <div class="result-header">
    <div class="header-title">
      <h2>${esc(title)}</h2>
      <span class="timestamp">${esc(now)}</span>
    </div>
    <div class="header-actions">
      ${renderWatchButton(watchLabel)}
      <button class="copy-btn" id="copyBtn">Copy JSON</button>
    </div>
  </div>
  ${renderBody(data)}
  <details>
    <summary>Raw JSON</summary>
    <pre>${jsonStr}</pre>
  </details>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const jsonData = ${JSON.stringify(JSON.stringify(data, null, 2)).replace(/</g, "\\u003c")};
    document.getElementById('copyBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'copy', text: jsonData });
    });${renderWatchScript(watchLabel)}
  </script>
</body>
</html>`;
}

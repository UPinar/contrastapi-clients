"""Check the optional ContrastAPI key that a Dify user saves for the plugin."""

from typing import Any

import requests
from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools._api import BASE_URL, TIMEOUT_SECONDS, USER_AGENT, error_text, is_key_format_valid

_FORMAT_MESSAGE = (
    "The API key does not have the ContrastAPI key format "
    "(contrastapi_ followed by 56 hex characters)."
)
_CHECK_FAILED = "ContrastAPI could not check the key: "


class ContrastAPIProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        """Accept an empty key, refuse a malformed one, and ask /health about the rest.

        An empty key is valid, because every tool but the watchlist ones works
        without a key. A key of the wrong shape is refused before any request,
        so a typo is never sent. /health costs no credits and answers 401 to a
        key the server does not know. A redirect is not followed, so the key is
        never sent to another host.
        """
        raw = credentials.get("api_key") or ""
        key = raw.strip() if isinstance(raw, str) else ""
        if not key:
            return
        if not is_key_format_valid(key):
            raise ToolProviderCredentialValidationError(_FORMAT_MESSAGE)
        try:
            response = requests.request(
                "GET",
                BASE_URL + "/health",
                headers={"Accept": "application/json", "User-Agent": USER_AGENT, "X-API-Key": key},
                timeout=TIMEOUT_SECONDS,
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            raise ToolProviderCredentialValidationError(_CHECK_FAILED + type(exc).__name__) from None
        if response.status_code == 200:
            return
        text = error_text(response.status_code, response.text, response.headers.get("Retry-After"), key_sent=True)
        if response.status_code == 401:
            raise ToolProviderCredentialValidationError(text)
        raise ToolProviderCredentialValidationError(_CHECK_FAILED + text)

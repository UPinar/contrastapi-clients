"""Error classes of the ContrastAPI SDK.

The server answers an error with `{"error": {"code": ..., "message": ...}}`.
Each error keeps the HTTP status, the code, the Retry-After seconds and the
rate-limit info of the answer. An error holds neither the request nor the
response, and its text never repeats the API key.
"""

from __future__ import annotations

import json
import unicodedata
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ._client import RateLimitInfo

MAX_MESSAGE_CHARS = 300


_DROPPED_CATEGORIES = frozenset({"Cf", "Cs"})


def _clean_text(text: str) -> str:
    """_clean_text drops control, format and surrogate characters and caps the length.

    The text comes from the server and may reach a terminal or a log.
    An escape sequence or a newline must not pass. C1 includes the one-byte CSI.
    A format character (Unicode Cf), such as U+202E, can reorder the text on screen.
    A lone surrogate makes print() raise UnicodeEncodeError.
    The cap counts the code points that are left.
    """
    kept = "".join(ch for ch in text if ch >= " " and not "\x7f" <= ch <= "\x9f"
                   and unicodedata.category(ch) not in _DROPPED_CATEGORIES)
    return kept[:MAX_MESSAGE_CHARS]


def _refuse_constant(name: str) -> Any:
    raise ValueError(f"JSON holds {name}")


def _parse_json(content: bytes) -> Any:
    """_parse_json parses a body as strict UTF-8 JSON and drops one leading BOM.

    json.loads alone would guess UTF-16 or UTF-32 and accept NaN and Infinity.
    The Node SDK refuses both. _parse_json raises ValueError or RecursionError.
    """
    return json.loads(content.decode("utf-8-sig"), parse_constant=_refuse_constant)


class ContrastAPIError(Exception):
    """ContrastAPIError is the base class of every SDK error."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        retry_after: int | None = None,
        rate_limit: RateLimitInfo | None = None,
    ) -> None:
        cleaned = _clean_text(message)
        super().__init__(cleaned)
        self.message = cleaned
        self.status = status
        self.code = code
        self.retry_after = retry_after
        self.rate_limit = rate_limit


class BadRequestError(ContrastAPIError):
    """BadRequestError is an HTTP 400 answer."""


class AuthenticationError(ContrastAPIError):
    """AuthenticationError is an HTTP 401 answer."""


class NotFoundError(ContrastAPIError):
    """NotFoundError is an HTTP 404 answer."""


class RateLimitError(ContrastAPIError):
    """RateLimitError is an HTTP 429 answer."""


class UpstreamError(ContrastAPIError):
    """UpstreamError is an HTTP 502, 503 or 504 answer."""


class APIConnectionError(ContrastAPIError):
    """APIConnectionError means no usable answer arrived. Its status is None."""


class APITimeoutError(APIConnectionError):
    """APITimeoutError means the request ran past its timeout."""


_STATUS_CLASSES: dict[int, type[ContrastAPIError]] = {
    400: BadRequestError,
    401: AuthenticationError,
    404: NotFoundError,
    429: RateLimitError,
    502: UpstreamError,
    503: UpstreamError,
    504: UpstreamError,
}


def _error_class_for_status(status: int) -> type[ContrastAPIError]:
    return _STATUS_CLASSES.get(status, ContrastAPIError)


def _parse_error_body(content: bytes) -> tuple[str | None, str | None]:
    """_parse_error_body returns the code and the message of an error body.

    A field that is missing or not a string comes back as None.
    This function cleans the code. ContrastAPIError cleans the message.
    """
    try:
        body: Any = _parse_json(content)
    except (ValueError, RecursionError):
        return None, None
    detail = body.get("error") if isinstance(body, dict) else None
    if not isinstance(detail, dict):
        return None, None
    code = detail.get("code")
    message = detail.get("message")
    return (_clean_text(code) if isinstance(code, str) else None,
            message if isinstance(message, str) else None)

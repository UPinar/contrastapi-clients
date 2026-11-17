"""Turn one Dify tool call into one ContrastAPI request.

tools/_ops.py, which gen_plugin.py writes from sdk/openapi.json, says where each
argument goes and what kind it is. This module converts the values that Dify
hands over, sends the request to BASE_URL and turns an error answer into a
sentence for the agent. It retries nothing.
"""

import hashlib
import json
import math
import re
import urllib.parse
import zlib
from collections.abc import Generator
from typing import Any

import requests

from tools._ops import OPERATIONS

BASE_URL = "https://api.contrastcyber.com"
TIMEOUT_SECONDS = 30
PLUGIN_VERSION = "0.9.0"
USER_AGENT = f"contrastapi-dify/{PLUGIN_VERSION}"
KEY_PREFIX = "contrastapi_"
PRICING_URL = "https://api.contrastcyber.com/pricing"
PASSWORD_TOOL = "password_check"

_PASSWORD_PARAM = "password"
_HASH_PARAM = "sha1_hash"
_KEY_BODY_HEX = 48
_KEY_CRC_HEX = 8
_KEY_LENGTH = len(KEY_PREFIX) + _KEY_BODY_HEX + _KEY_CRC_HEX
_LOWER_HEX = re.compile(r"[0-9a-f]+")
_DIGITS = re.compile(r"[0-9]{1,9}")
# _MESSAGE_MAX caps the server's error message in the text the agent reads.
_MESSAGE_MAX = 300
# _CODE_SHAPE is the shape of a server error code; any other code is dropped.
_CODE_SHAPE = re.compile(r"[a-z_]{1,40}")
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_PLACEHOLDER = re.compile(r"\{([a-z_][a-z0-9_]*)\}")


class ContrastAPIError(Exception):
    """ContrastAPIError carries a sentence that Dify shows the agent."""


def is_key_format_valid(key: str) -> bool:
    """Return True when key has the ContrastAPI key format.

    The format is KEY_PREFIX, 48 lower-case hex digits, and the zlib CRC-32 of
    those 48 digits as 8 lower-case hex digits. The server checks the same
    shape before it looks the key up.
    """
    if not isinstance(key, str) or len(key) != _KEY_LENGTH or not key.startswith(KEY_PREFIX):
        return False
    body = key[len(KEY_PREFIX):len(KEY_PREFIX) + _KEY_BODY_HEX]
    crc = key[len(KEY_PREFIX) + _KEY_BODY_HEX:]
    if not _LOWER_HEX.fullmatch(body) or not _LOWER_HEX.fullmatch(crc):
        return False
    return crc == format(zlib.crc32(body.encode("ascii")), "08x")


def _is_empty(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _to_bool(name, value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    raise ContrastAPIError(f"{name} must be true or false.")


def _to_int(name, value) -> int:
    if isinstance(value, bool):
        raise ContrastAPIError(f"{name} must be a whole number.")
    if isinstance(value, int):
        return value
    try:
        number = float(value.strip() if isinstance(value, str) else value)
    except (TypeError, ValueError):
        raise ContrastAPIError(f"{name} must be a whole number.") from None
    if not math.isfinite(number) or not number.is_integer():
        raise ContrastAPIError(f"{name} must be a whole number.")
    return int(number)


def _to_float(name, value) -> float:
    if isinstance(value, bool):
        raise ContrastAPIError(f"{name} must be a number.")
    try:
        number = float(value.strip() if isinstance(value, str) else value)
    except (TypeError, ValueError):
        raise ContrastAPIError(f"{name} must be a number.") from None
    if not math.isfinite(number):
        raise ContrastAPIError(f"{name} must be a finite number.")
    return number


def _to_string_list(name, value) -> list:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("["):
            try:
                value = json.loads(text)
            except ValueError:
                raise ContrastAPIError(f"{name} is not a valid JSON array.") from None
        else:
            value = [item.strip() for item in text.split(",") if item.strip()]
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ContrastAPIError(f"{name} must be a list of strings.")
    return value


def _to_object_list(name, value) -> list:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            raise ContrastAPIError(f"{name} must be a JSON array of objects.") from None
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ContrastAPIError(f"{name} must be a JSON array of objects.")
    return value


def _convert(name, kind, value, place):
    """Return the value to send, or None when the argument is left out."""
    if kind in ("boolean", "const_true"):
        flag = _to_bool(name, value)
        if kind == "const_true" and not flag:
            return None
        if place == "query":
            return "true" if flag else "false"
        return flag
    if kind == "integer":
        return _to_int(name, value)
    if kind == "number":
        number = _to_float(name, value)
        return str(number) if place == "query" else number
    if kind == "string_array":
        return _to_string_list(name, value)
    if kind == "object_array":
        return _to_object_list(name, value)
    return value.strip() if isinstance(value, str) else str(value)


def _password_parameters(tool_parameters) -> dict:
    """Return the arguments of password_check with the password replaced by its SHA-1.

    The password never leaves this function. Only the upper-case hex SHA-1 goes on.
    """
    password = tool_parameters.get(_PASSWORD_PARAM)
    if not isinstance(password, str) or password == "":
        raise ContrastAPIError("password_check needs a password to check.")
    try:
        encoded = password.encode("utf-8")
    except UnicodeEncodeError:
        raise ContrastAPIError("The password holds a character that is not valid Unicode text.") from None
    return {_HASH_PARAM: hashlib.sha1(encoded).hexdigest().upper()}


def build_request(operation_id, tool_parameters, api_key) -> tuple[str, str, dict, dict | None, dict]:
    """Return (method, url, query, json_body, headers) of one tool call.

    An argument that is None or blank is left out. A path value is quoted as
    one path segment, so it cannot change the path or the host.
    """
    operation = OPERATIONS.get(operation_id)
    if operation is None:
        raise ContrastAPIError(f"Unknown tool {operation_id}.")
    parameters = dict(tool_parameters or {})
    if operation_id == PASSWORD_TOOL:
        parameters = _password_parameters(parameters)

    path_values = {}
    query = {}
    body = {} if operation["method"] == "POST" else None
    for param in operation["params"]:
        name, place = param["name"], param["place"]
        value = parameters.get(name)
        if _is_empty(value):
            continue
        converted = _convert(name, param["kind"], value, place)
        if converted is None:
            continue
        if place == "path":
            path_values[name] = converted
        elif place == "query":
            query[name] = converted
        elif body is not None:
            body[name] = converted

    def path_segment(match):
        name = match.group(1)
        value = path_values.get(name)
        if value is None or str(value) == "":
            raise ContrastAPIError(f"{name} is required.")
        if str(value) in (".", ".."):
            raise ContrastAPIError(f"{name} is not a valid value.")
        return urllib.parse.quote(str(value), safe="")

    url = BASE_URL + _PLACEHOLDER.sub(path_segment, operation["path"])
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    key = api_key.strip() if isinstance(api_key, str) else ""
    if key:
        headers["X-API-Key"] = key
    return operation["method"], url, query, body, headers


def _retry_seconds(error, retry_after):
    """Return the wait in whole seconds from the body or the Retry-After header, or None."""
    seconds = error.get("retry_after_seconds")
    if isinstance(seconds, int) and not isinstance(seconds, bool) and seconds >= 0:
        return seconds
    if isinstance(retry_after, str) and _DIGITS.fullmatch(retry_after.strip()):
        return int(retry_after.strip())
    return None


def error_text(status, body, retry_after, key_sent=False) -> str:
    """Return the sentence the agent reads for a non-2xx answer.

    The code and message come from the JSON error object. A body that is not
    that JSON gives only the HTTP status, so no HTML page reaches the agent.
    A code of another shape is dropped. Control characters in the message
    become spaces.
    A call with a key that gets 429 has used the key's own credits, so its
    text does not offer a Pro key. A call without a key gets the offer.
    """
    error = {}
    try:
        parsed = json.loads(body) if body else None
    except (TypeError, ValueError):
        parsed = None
    if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
        error = parsed["error"]
    code = error.get("code") if isinstance(error.get("code"), str) else ""
    if not _CODE_SHAPE.fullmatch(code):
        code = ""
    message = error.get("message") if isinstance(error.get("message"), str) else ""
    message = _CONTROL_CHARS.sub(" ", message[:_MESSAGE_MAX])

    if status in (402, 429):
        seconds = _retry_seconds(error, retry_after)
        if status == 429 and key_sent:
            if seconds is None:
                return "Hourly credits are used up."
            return f"Hourly credits are used up. Retry in {seconds} seconds."
        if seconds is None:
            return f"Hourly credits are used up. Add a Pro API key: {PRICING_URL}"
        return f"Hourly credits are used up. Retry in {seconds} seconds, or add a Pro API key: {PRICING_URL}"
    if status == 401:
        return f"The API key was refused: {message or f'HTTP {status}'}"
    if code and message:
        return f"ContrastAPI answered {status} {code}: {message}"
    if message:
        return f"ContrastAPI answered {status}: {message}"
    return f"ContrastAPI answered HTTP {status}."


def _saved_key(tool) -> str:
    runtime = getattr(tool, "runtime", None)
    credentials = getattr(runtime, "credentials", None) if runtime is not None else None
    if not credentials:
        return ""
    key = credentials.get("api_key", "")
    key = key.strip() if isinstance(key, str) else ""
    if key and not is_key_format_valid(key):
        raise ContrastAPIError("The saved API key does not have the ContrastAPI key format. Save the key again in the plugin settings.")
    return key


def invoke_operation(tool, operation_id, tool_parameters) -> Generator[Any, None, None]:
    """Send one tool call and yield its JSON answer as one Dify message.

    A redirect is not followed, so the key is never sent to another host.
    """
    method, url, query, json_body, headers = build_request(operation_id, tool_parameters, _saved_key(tool))
    try:
        response = requests.request(method, url, params=query, json=json_body, headers=headers,
                                    timeout=TIMEOUT_SECONDS, allow_redirects=False)
    except requests.RequestException as exc:
        raise ContrastAPIError(f"ContrastAPI could not be reached: {type(exc).__name__}") from None
    if not 200 <= response.status_code < 300:
        raise ContrastAPIError(error_text(response.status_code, response.text, response.headers.get("Retry-After"),
                                          key_sent="X-API-Key" in headers))
    try:
        data = response.json()
    except ValueError:
        raise ContrastAPIError("ContrastAPI answered a body that is not JSON.") from None
    yield tool.create_json_message(data)

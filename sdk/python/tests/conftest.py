"""Pytest config and shared harness for the SDK tests.

`asyncio_mode = auto` (pytest.ini) runs `async def test_*` without a decorator.
The SDK's parent directory goes on `sys.path`, so the tests run from the repo
without `pip install -e .`.

Most tests take the `api` fixture. It runs each test twice: once against
`ContrastAPI` and once against `AsyncContrastAPI`. The async run drives each
coroutine on a private event loop, so one test body covers both clients.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from pathlib import Path
from typing import Any, Callable

import httpx
import pytest

_SDK_ROOT = Path(__file__).resolve().parent.parent
if str(_SDK_ROOT) not in sys.path:
    sys.path.insert(0, str(_SDK_ROOT))

import contrastapi  # noqa: E402
from contrastapi import _client  # noqa: E402

KEY = "not-a-real-key-marker"
MAX_SLEEPS = 50


def reply(status: int = 200, body: Any = None, *, content: bytes | None = None,
          headers: dict[str, str] | None = None) -> Callable[[httpx.Request], httpx.Response]:
    """reply builds a fresh httpx.Response for every request it answers."""
    def make(request: httpx.Request) -> httpx.Response:
        if content is not None:
            return httpx.Response(status, content=content, headers=headers)
        return httpx.Response(status, json={"ok": True} if body is None else body, headers=headers)
    return make


def error_reply(status: int, code: str | None = "some_code", message: str = "msg",
                headers: dict[str, str] | None = None) -> Callable[[httpx.Request], httpx.Response]:
    return reply(status, {"error": {"code": code, "message": message}}, headers=headers)


class Server:
    """Server answers each request with the next item; the last item repeats.

    An item is a reply callable or an exception to raise.
    """

    def __init__(self, *items: Any) -> None:
        self.items = list(items) or [reply()]
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        request.read()
        self.requests.append(request)
        item = self.items.pop(0) if len(self.items) > 1 else self.items[0]
        if isinstance(item, BaseException):
            raise item
        return item(request)

    @property
    def raw(self) -> str:
        return self.requests[-1].url.raw_path.decode("ascii")

    @property
    def url(self) -> str:
        return str(self.requests[-1].url)

    def body(self, index: int = -1) -> Any:
        return json.loads(self.requests[index].content)


class Handle:
    """Handle runs a client method and, for the async client, awaits it."""

    def __init__(self, client: Any, loop: asyncio.AbstractEventLoop | None) -> None:
        self.client = client
        self._loop = loop

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self.client, name)
        if not callable(attr):
            return attr

        def run(*args: Any, **kwargs: Any) -> Any:
            result = attr(*args, **kwargs)
            if inspect.iscoroutine(result):
                assert self._loop is not None, "sync client returned a coroutine"
                return self._loop.run_until_complete(result)
            return result
        return run


class Driver:
    def __init__(self, kind: str, monkeypatch: pytest.MonkeyPatch) -> None:
        self.kind = kind
        self.cls: type = contrastapi.ContrastAPI if kind == "sync" else contrastapi.AsyncContrastAPI
        self.loop = asyncio.new_event_loop() if kind == "async" else None
        self.sleeps: list[float] = []
        self._handles: list[Handle] = []

        def record(seconds: float) -> None:
            self.sleeps.append(seconds)
            if len(self.sleeps) > MAX_SLEEPS:
                raise AssertionError("the retry loop does not stop")

        async def arecord(seconds: float) -> None:
            record(seconds)

        def wrong_sync(seconds: float) -> None:
            raise AssertionError("async client used the blocking sleep")

        async def wrong_async(seconds: float) -> None:
            raise AssertionError("sync client used the async sleep")

        if kind == "sync":
            monkeypatch.setattr(_client, "_sleep", record)
            monkeypatch.setattr(_client, "_async_sleep", wrong_async)
        else:
            monkeypatch.setattr(_client, "_sleep", wrong_sync)
            monkeypatch.setattr(_client, "_async_sleep", arecord)

    def make(self, server: Server | None = None, **kwargs: Any) -> Handle:
        server = server if server is not None else Server()
        client = self.cls(transport=httpx.MockTransport(server), **kwargs)
        handle = Handle(client, self.loop)
        self._handles.append(handle)
        return handle

    def close(self) -> None:
        for handle in self._handles:
            if self.kind == "sync":
                handle.client.close()
            else:
                assert self.loop is not None
                self.loop.run_until_complete(handle.client.aclose())
        if self.loop is not None:
            self.loop.close()


@pytest.fixture(autouse=True)
def _no_env_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CONTRASTAPI_API_KEY", raising=False)


@pytest.fixture(params=["sync", "async"])
def api(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> Any:
    driver = Driver(request.param, monkeypatch)
    yield driver
    driver.close()

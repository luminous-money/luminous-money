"""A limit on request bodies (scale readiness, S4): nothing reads more than its route allows, so a
client can't fill the service's memory by sending, whether it says how much it's sending
(`Content-Length`, refused before a byte is read) or not (chunked, refused once past the limit).
Starlette and uvicorn read whatever they're sent, and the gateway can't limit bodies without
buffering responses too, which would hold up streamed ones.

The body is read here, up to the limit, then handed on as it came: FastAPI reads it whole anyway,
and reading it here lets an oversized one be answered 413, not whatever an endpoint makes of a
body cut short.
"""

from __future__ import annotations

import json
from typing import Callable

MB = 1024 * 1024

# A route's limit, and what a refusal says.
Limit = tuple[int, str]


class BodyLimit:
    """ASGI middleware refusing (413) a body over `limit_for(path)`."""

    def __init__(self, app, limit_for: Callable[[str], Limit]):
        self.app = app
        self.limit_for = limit_for

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit, message = self.limit_for(scope["path"])
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            return await refuse(send, message)

        received: list[dict] = []
        size = 0
        while True:
            event = await receive()
            if event["type"] != "http.request":  # the client went away
                received.append(event)
                break
            size += len(event.get("body", b""))
            if size > limit:
                return await refuse(send, message)
            received.append(event)
            if not event.get("more_body", False):
                break

        async def replay():
            return received.pop(0) if received else await receive()

        await self.app(scope, replay, send)


async def refuse(send, message: str) -> None:
    body = json.dumps({"detail": message}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": body})

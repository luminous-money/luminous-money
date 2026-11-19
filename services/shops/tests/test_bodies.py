"""Request bodies have a limit (scale readiness, S4), said or chunked: the middleware alone, as
ASGI, since this service's tests have no HTTP client."""

import asyncio

from shops.bodies import BodyLimit


def call(body_parts: list[bytes], declared: int | None = None):
    """Send `body_parts` through a 10-byte limit; what came back, and what the app read."""
    events = [{"type": "http.request", "body": p, "more_body": i < len(body_parts) - 1} for i, p in enumerate(body_parts)]
    read: list[bytes] = []
    sent: list[dict] = []

    async def app(scope, receive, send):
        while True:
            event = await receive()
            read.append(event["body"])
            if not event["more_body"]:
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive():
        return events.pop(0)

    async def send(event):
        sent.append(event)

    headers = [(b"content-length", str(declared).encode())] if declared is not None else []
    scope = {"type": "http", "path": "/api/shops/v1/books/b/amazon", "headers": headers}
    asyncio.run(BodyLimit(app, lambda _: (10, "a request is at most 10 bytes"))(scope, receive, send))
    return sent[0]["status"], b"".join(read)


def test_a_body_over_the_limit_is_refused_said_or_chunked():
    assert call([b"x" * 11], declared=11) == (413, b"")
    assert call([b"x" * 6, b"x" * 5]) == (413, b"")


def test_a_body_within_it_reaches_the_app_as_it_came():
    assert call([b"x" * 10], declared=10) == (200, b"x" * 10)
    assert call([b"hello", b"there"]) == (200, b"hellothere")

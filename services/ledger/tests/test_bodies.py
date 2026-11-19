"""Request bodies have a limit (scale readiness, S4), whether the client says how big they are or
sends them chunked."""

from conftest import USER, http
from ledger import api
from ledger.service import Ledger
from test_attachments import LUNCH, TEXT


def chunked(size: int, piece: int = 64 * 1024):
    """`size` bytes as an iterator: httpx sends it chunked, with no Content-Length."""
    while size > 0:
        yield b"x" * min(piece, size)
        size -= piece


def test_a_body_over_the_limit_is_refused_said_or_chunked(ledger, monkeypatch):
    monkeypatch.setattr(api, "BODY_LIMIT", 1024)
    client = http(ledger)
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    url = f"/api/ledger/v1/books/{book}/query"

    said = client.post(url, content=b"x" * 1025, headers={"content-type": "text/plain"})
    sent = client.post(url, content=chunked(1025), headers={"content-type": "text/plain"})

    for refused in (said, sent):
        assert refused.status_code == 413
        assert refused.json() == {"detail": "a request is at most 25 MB"}


def test_a_body_within_the_limit_reaches_its_endpoint(ledger, monkeypatch):
    monkeypatch.setattr(api, "BODY_LIMIT", 1024)
    client = http(ledger)
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    bql = b"SELECT account WHERE account ~ 'Assets'"

    said = client.post(f"/api/ledger/v1/books/{book}/query", content=bql, headers={"content-type": "text/plain"})
    sent = client.post(
        f"/api/ledger/v1/books/{book}/query", content=iter([bql]), headers={"content-type": "text/plain"}
    )

    assert said.status_code == sent.status_code == 200
    assert said.json() == sent.json()


def test_an_attachment_stops_at_5_mb_even_chunked(ledger):
    client = http(ledger)
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    lunch = ledger.create_transaction(book, LUNCH).id
    url = f"/api/ledger/v1/books/{book}/transactions/{lunch}/attachments"
    image = {"content-type": "image/jpeg"}

    refused = client.post(url, content=chunked(Ledger.ATTACHMENT_LIMIT + 1), headers=image)
    kept = client.post(url, content=chunked(Ledger.ATTACHMENT_LIMIT), headers=image)

    assert refused.status_code == 413
    assert refused.json() == {"detail": "an attachment is at most 5 MB"}
    assert kept.status_code == 201

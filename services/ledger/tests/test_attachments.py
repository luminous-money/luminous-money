"""Attachments (M16): files a transaction holds, kept beside the database."""

import pytest

from conftest import USER, http
from ledger import models
from ledger.service import NotFound, TooLarge

TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank USD
2026-01-01 open Expenses:Food
"""
LUNCH = models.TransactionIn(
    date="2026-02-01",
    flag="!",
    narration="Lunch",
    postings=[
        models.Posting(account="Assets:Bank", units=models.Amount(number="-12.00", currency="USD")),
        models.Posting(account="Expenses:Food"),
    ],
)


def test_a_transaction_holds_files_until_its_deleted(ledger, tmp_path):
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    lunch = ledger.create_transaction(book, LUNCH).id

    receipt = ledger.attach(book, lunch, "receipt.jpg", "image/jpeg", b"\xff\xd8 a photo")

    assert (receipt.filename, receipt.size, receipt.content_type) == ("receipt.jpg", 10, "image/jpeg")
    assert ledger.transaction(book, lunch).attachments == 1
    found, data = ledger.attachment(book, receipt.id)
    assert data == b"\xff\xd8 a photo" and found.sha256
    assert (tmp_path / "attachments" / book / receipt.id).exists()

    current = ledger.transaction(book, lunch)
    ledger.delete(book, lunch, expected=current.updated_at)
    with pytest.raises(NotFound):
        ledger.attachment(book, receipt.id)
    assert not (tmp_path / "attachments" / book / receipt.id).exists()


def test_attachments_over_the_api_and_the_limit(ledger):
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    lunch = ledger.create_transaction(book, LUNCH).id
    client = http(ledger)
    url = f"/api/ledger/v1/books/{book}"

    made = client.post(
        f"{url}/transactions/{lunch}/attachments",
        params={"filename": "receipt.png"},
        content=b"\x89PNG data",
        headers={"content-type": "image/png"},
    )
    assert made.status_code == 201
    listed = client.get(f"{url}/transactions/{lunch}/attachments").json()
    assert [a["filename"] for a in listed] == ["receipt.png"]
    got = client.get(f"{url}/attachments/{made.json()['id']}")
    assert got.content == b"\x89PNG data" and got.headers["content-type"] == "image/png"
    # A reader sees it; a stranger doesn't.
    assert http(ledger, "stranger").get(f"{url}/attachments/{made.json()['id']}").status_code == 404
    assert client.delete(f"{url}/attachments/{made.json()['id']}").status_code == 204

    with pytest.raises(TooLarge):
        ledger.attach(book, lunch, "big.jpg", "image/jpeg", b"x" * (5 * 1024 * 1024 + 1))

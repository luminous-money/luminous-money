"""Versioned edits: every edit names the version it read, and stale edits are refused."""

import pytest
from conftest import FEATURES, STAGED
from fastapi.testclient import TestClient

from ledger import models
from ledger.api import create_app
from ledger.store import StaleVersion

BASE = "/api/ledger/v1/books/book"


@pytest.fixture
def book(ledger):
    ledger.apply_file("book", FEATURES)
    return ledger


@pytest.fixture
def client(book):
    return TestClient(create_app(book))


@pytest.fixture
def staged(book):
    return book.transaction("book", book.create("book", STAGED).id)


def test_every_write_moves_the_version_forward(book, staged):
    first = staged.updated_at

    book.set_flag("book", staged.id, "*")
    second = book.transaction("book", staged.id).updated_at
    book.set_flag("book", staged.id, "!")
    third = book.transaction("book", staged.id).updated_at

    assert first < second < third
    assert book.transaction("book", staged.id).created_at == staged.created_at


def test_a_stale_edit_is_refused_and_changes_nothing(book, staged):
    book.set_flag("book", staged.id, "*")

    with pytest.raises(StaleVersion):
        book.set_flag("book", staged.id, "!", expected=staged.updated_at)

    assert book.transaction("book", staged.id).flag == "*"


def test_patch_changes_only_the_fields_given(client, staged):
    response = client.patch(f"{BASE}/transactions/{staged.id}", json={"narration": "Latte", "updatedAt": staged.updated_at})

    body = response.json()
    assert response.status_code == 200
    assert (body["narration"], body["payee"], body["flag"]) == ("Latte", "Corner Cafe", "!")
    assert body["postings"] == [p.model_dump(by_alias=True) for p in staged.postings]


def test_the_review_race_can_no_longer_restage_a_confirmed_transaction(client, staged):
    """A description save that read the old version, arriving after a confirm, is refused."""
    confirmed = client.patch(f"{BASE}/transactions/{staged.id}", json={"flag": "*", "updatedAt": staged.updated_at})
    late = client.patch(f"{BASE}/transactions/{staged.id}", json={"narration": "Latte", "updatedAt": staged.updated_at})

    assert confirmed.status_code == 200
    assert late.status_code == 409
    assert late.json()["updatedAt"] == confirmed.json()["updatedAt"]
    assert client.get(f"{BASE}/transactions/{staged.id}").json()["flag"] == "*"


def test_every_kind_of_edit_is_versioned(client, staged):
    stale = staged.updated_at
    current = client.patch(f"{BASE}/transactions/{staged.id}", json={"flag": "*", "updatedAt": stale}).json()["updatedAt"]
    full = staged.model_dump(mode="json", by_alias=True, include=set(models.TransactionIn.model_fields))
    text = {"content": STAGED, "headers": {"content-type": "text/plain"}}

    assert client.put(f"{BASE}/transactions/{staged.id}", json={**full, "updatedAt": stale}).status_code == 409
    assert client.put(f"{BASE}/directives/{staged.id}", params={"updatedAt": stale}, **text).status_code == 409
    assert client.delete(f"{BASE}/directives/{staged.id}", params={"updatedAt": stale}).status_code == 409

    assert client.put(f"{BASE}/directives/{staged.id}", params={"updatedAt": current}, **text).status_code == 200


def test_edits_must_name_a_version(client, staged):
    assert client.patch(f"{BASE}/transactions/{staged.id}", json={"flag": "*"}).status_code == 422
    assert client.delete(f"{BASE}/directives/{staged.id}").status_code == 422


def test_json_is_camel_case(client, staged):
    body = client.get(f"{BASE}/transactions/{staged.id}").json()

    assert {"createdAt", "updatedAt"} <= set(body)
    assert "updated_at" not in body

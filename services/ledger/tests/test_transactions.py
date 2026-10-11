"""Structured (JSON) transactions: what the app sends, and what it reads back."""

import datetime

import pytest
from conftest import FEATURES, USER, http
from pydantic import ValidationError

from ledger import engine, models

COFFEE = {
    "date": "2024-03-01",
    "payee": "Corner Cafe",
    "narration": "Coffee",
    "postings": [
        {"account": "Expenses:Food", "units": {"number": "4.50", "currency": "USD"}},
        {"account": "Assets:Bank:Checking"},
    ],
}

RICH = {
    "date": "2024-03-02",
    "flag": "*",
    "payee": "Broker",
    "narration": "Buy with \"quotes\"",
    "tags": ["invest", "q1"],
    "links": ["trade-42"],
    "meta": {
        "note": "plain text",
        "reviewed": True,
        "shares": {"number": "10"},
        "settles": {"date": "2024-03-04"},
        "fee": {"number": "1.25", "currency": "USD"},
    },
    "postings": [
        {
            "account": "Assets:Brokerage",
            "units": {"number": "10", "currency": "VTI"},
            "cost": {"number": "200.00", "currency": "USD", "date": "2024-03-02", "label": "lot-a"},
            "meta": {"lot": "first"},
        },
        {
            "account": "Assets:Bank:Checking",
            "units": {"number": "-2000.00", "currency": "USD"},
            "flag": "!",
        },
    ],
}

SELL = {
    "date": "2024-06-01",
    "flag": "*",
    "narration": "Sell",
    "postings": [
        {"account": "Assets:Brokerage", "units": {"number": "-5", "currency": "VTI"}, "cost": {}, "price": {"number": "250.00", "currency": "USD"}},
        {"account": "Assets:Bank:Checking", "units": {"number": "1250.00", "currency": "USD"}},
        {"account": "Income:Gains"},
    ],
}


@pytest.fixture
def book(ledger):
    ledger.apply_file("book", FEATURES, owner_id=USER)
    return ledger


def roundtrip(payload: dict) -> tuple[engine.Directive, models.TransactionIn]:
    directive = engine.transaction_directive(models.TransactionIn.model_validate(payload))
    [(directive_id, back)] = engine.transactions([directive.text])
    assert directive_id == directive.id
    return directive, back


@pytest.mark.parametrize("payload", [COFFEE, RICH, SELL], ids=["simple", "rich", "reduction"])
def test_json_round_trips_through_canonical_text_without_loss(payload):
    directive, back = roundtrip(payload)

    expected = models.TransactionIn.model_validate(payload).model_dump()
    assert back.model_dump() == expected


def test_the_rendered_text_is_ordinary_beancount():
    directive, _ = roundtrip(COFFEE)

    assert directive.text == (
        f'2024-03-01 ! "Corner Cafe" "Coffee"\n'
        f'  id: "{directive.id}"\n'
        f"  Expenses:Food         4.50 USD\n"
        f"  Assets:Bank:Checking\n"
    )


@pytest.mark.parametrize(
    "change",
    [
        {"postings": []},  # a transaction needs postings
        {"postings": [{"account": "Expenses:Food", "units": {"number": "4.5.0", "currency": "USD"}}]},
        {"postings": [{"account": "Expenses:Food", "units": {"number": 4.5, "currency": "USD"}}]},  # floats
        {"surprise": True},  # unknown fields are rejected, not ignored
    ],
)
def test_malformed_json_is_rejected_by_the_schema(change):
    with pytest.raises(ValidationError):
        models.TransactionIn.model_validate({**COFFEE, **change})


@pytest.mark.parametrize(
    "change",
    [
        {"postings": [{"account": "expenses:food"}, {"account": "Assets:Bank:Checking"}]},  # account syntax
        {"flag": "x"},  # not a Beancount flag
        {"meta": {"Bad Key": "x"}},  # metadata keys are lowercase identifiers
    ],
)
def test_json_that_isnt_valid_beancount_is_rejected_by_the_parser(change):
    with pytest.raises(engine.ParseFailure):
        engine.transaction_directive(models.TransactionIn.model_validate({**COFFEE, **change}))


def test_created_transactions_land_staged_and_validate(book):
    directive = book.create_transaction("book", models.TransactionIn.model_validate(COFFEE))

    [staged] = book.transactions("book", flag="!", date_from=datetime.date(2024, 1, 1))
    assert staged.id == directive.id
    assert staged.flag == "!"
    assert book.problems("book") == []


def test_updating_keeps_the_id_and_the_position(book):
    created = book.create_transaction("book", models.TransactionIn.model_validate(COFFEE))
    ordinal = book.store.get("book", created.id).ordinal

    edited = {**COFFEE, "flag": "*", "postings": [{**COFFEE["postings"][0], "account": "Expenses:Travel"}, COFFEE["postings"][1]]}
    book.update_transaction("book", created.id, models.TransactionIn.model_validate(edited))

    after = book.transaction("book", created.id)
    assert after.flag == "*"
    assert after.postings[0].account == "Expenses:Travel"
    assert book.store.get("book", created.id).ordinal == ordinal


def test_only_transactions_can_be_updated_as_transactions(book):
    an_open = next(r for r in book.store.live("book") if r.kind == "open")

    with pytest.raises(ValueError):
        book.update_transaction("book", an_open.id, models.TransactionIn.model_validate(COFFEE))


def test_transactions_written_as_text_read_back_as_json(book):
    [groceries] = [t for t in book.transactions("book") if t.narration == "Weekly groceries"]

    assert groceries.tags == ["food", "household"]
    assert groceries.links == ["receipt-001"]
    assert groceries.meta == {"receipt": "a multi\nline string", "verified": True}
    assert groceries.postings[0].meta == {"category-hint": "Expenses:Food"}
    assert groceries.postings[1].flag == "!"
    assert groceries.postings[1].units is None


def test_json_api_over_http(book):
    client = http(book)

    created = client.post("/api/ledger/v1/books/book/transactions", json=COFFEE)
    assert created.status_code == 201
    directive_id = created.json()["id"]

    listed = client.get("/api/ledger/v1/books/book/transactions", params={"flag": "!", "from": "2024-01-01"}).json()
    assert [t["id"] for t in listed] == [directive_id]
    assert listed[0]["postings"][0]["units"] == {"number": "4.50", "currency": "USD"}

    version = listed[0]["updated_at"]
    updated = client.put(
        f"/api/ledger/v1/books/book/transactions/{directive_id}", json={**COFFEE, "flag": "*", "updated_at": version}
    )
    assert updated.json()["flag"] == "*"
    assert updated.json()["updated_at"] > version

    assert client.post("/api/ledger/v1/books/book/transactions", json={**COFFEE, "postings": []}).status_code == 422
    assert client.post("/api/ledger/v1/books/book/transactions", json={**COFFEE, "flag": "x"}).status_code == 422
    assert client.get("/api/ledger/v1/books/book/transactions/missing").status_code == 404

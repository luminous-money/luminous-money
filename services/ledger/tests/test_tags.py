"""Tags (M17): Beancount's own `#tag`s on transactions, listed and filtered with SQL."""

import datetime
import sqlite3

import pytest
from pydantic import ValidationError

from conftest import USER, http
from ledger import migrations, models

D = datetime.date
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Liabilities:Card USD
2026-01-01 open Expenses:Travel
2026-01-01 open Expenses:Food
"""


def spend(day, amount, tags=(), account="Assets:Bank:Checking", other="Expenses:Food", payee="Shop"):
    return models.TransactionIn(
        date=day,
        flag="*",
        payee=payee,
        tags=list(tags),
        postings=[
            models.Posting(account=account, units=models.Amount(number=amount, currency="USD")),
            models.Posting(account=other),
        ],
    )


@pytest.fixture
def book(ledger):
    return ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id


def add(ledger, book, *transactions):
    return [d.id for d in ledger.create_transactions(book, list(transactions))]


def test_tags_are_kept_as_beancount_and_listed_with_their_uses(ledger, book):
    flight, hotel, lunch = add(
        ledger,
        book,
        spend(D(2026, 4, 3), "-600.00", ["italy-2026", "reimbursable"], other="Expenses:Travel"),
        spend(D(2026, 4, 9), "-400.00", ["italy-2026"], account="Liabilities:Card", other="Expenses:Travel"),
        spend(D(2026, 5, 1), "-12.00"),
    )

    assert "#italy-2026 #reimbursable" in ledger.export(book)
    assert ledger.transaction(book, flight).tags == ["italy-2026", "reimbursable"]
    assert [t.model_dump() for t in ledger.tags(book)] == [
        {"name": "italy-2026", "transactions": 2, "first": D(2026, 4, 3), "last": D(2026, 4, 9)},
        {"name": "reimbursable", "transactions": 1, "first": D(2026, 4, 3), "last": D(2026, 4, 3)},
    ]


def test_editing_and_deleting_keep_the_list_current(ledger, book):
    [flight] = add(ledger, book, spend(D(2026, 4, 3), "-600.00", ["reimbursable"]))
    version = ledger.transaction(book, flight).updated_at

    ledger.patch_transaction(book, flight, models.TransactionPatch(updated_at=version, tags=["claimed"]))
    assert [t.name for t in ledger.tags(book)] == ["claimed"]

    version = ledger.transaction(book, flight).updated_at
    ledger.apply_changes(book, models.TransactionChanges(delete=[models.Deletion(id=flight, updated_at=version)]))
    assert ledger.tags(book) == []


def test_filters_keep_transactions_with_every_tag(ledger, book):
    flight, hotel, lunch = add(
        ledger,
        book,
        spend(D(2026, 4, 3), "-600.00", ["italy-2026", "reimbursable"]),
        spend(D(2026, 4, 9), "-400.00", ["italy-2026"]),
        spend(D(2026, 5, 1), "-12.00"),
    )

    def journal(*tags):
        return [r.id for r in ledger.journal(book, tags=list(tags)).rows]

    assert journal("italy-2026") == [hotel, flight]
    assert journal("italy-2026", "reimbursable") == [flight]
    assert journal("italy-2026", "italy-2026") == [hotel, flight]  # a tag twice is one tag
    assert journal("nowhere") == []
    assert journal() == [lunch, hotel, flight]
    assert ledger.journal(book).rows[1].tags == ["italy-2026"]

    compact = ledger.compact(book, None, ["reimbursable"])
    assert [(t.id, t.tags) for t in compact] == [(flight, ["italy-2026", "reimbursable"])]
    assert [t.id for t in ledger.compact(book, D(2026, 4, 5), ["italy-2026"])] == [hotel]
    assert len(ledger.compact(book, None)) == 3  # `from` is optional: every transaction


def test_an_account_ledger_filtered_by_tag_keeps_its_balances(ledger, book):
    flight, hotel, lunch = add(
        ledger,
        book,
        spend(D(2026, 4, 3), "-600.00", ["italy-2026"]),
        spend(D(2026, 4, 9), "-400.00"),
        spend(D(2026, 5, 1), "-12.00", ["italy-2026"]),
    )

    page = ledger.account_ledger(book, "Assets:Bank:Checking", tags=["italy-2026"])

    assert [(r.id, r.balance.number, r.tags) for r in page.rows] == [
        (lunch, "-1012.00", ["italy-2026"]),
        (flight, "-600.00", ["italy-2026"]),
    ]


def test_a_tag_must_be_one_beancount_allows():
    with pytest.raises(ValidationError):
        models.TransactionIn(date=D(2026, 1, 1), tags=["two words"], postings=[models.Posting(account="Assets:A")])
    with pytest.raises(ValidationError):
        models.TransactionPatch(updated_at="x", tags=["#hash"])
    # What Beancount allows, imported books' capitals included
    models.TransactionPatch(updated_at="x", tags=["Trip2019", "a/b.c_d", "e-f"])


def test_tags_over_http(ledger, book):
    client = http(ledger)
    [flight] = add(ledger, book, spend(D(2026, 4, 3), "-600.00", ["italy-2026"]))
    add(ledger, book, spend(D(2026, 4, 4), "-5.00", ["reimbursable"]))
    base = f"/api/ledger/v1/books/{book}"

    assert [t["name"] for t in client.get(f"{base}/tags").json()] == ["italy-2026", "reimbursable"]
    rows = client.get(f"{base}/journal", params={"tag": ["italy-2026"]}).json()["rows"]
    assert [(r["id"], r["tags"]) for r in rows] == [(flight, ["italy-2026"])]
    rows = client.get(f"{base}/accounts/Assets:Bank:Checking/ledger", params={"tag": "reimbursable"}).json()["rows"]
    assert [r["tags"] for r in rows] == [["reimbursable"]]
    compact = client.get(f"{base}/transactions/compact", params={"tag": ["italy-2026"]}).json()
    assert [t["id"] for t in compact] == [flight]

    version = client.get(f"{base}/transactions/{flight}").json()["updated_at"]
    refused = client.patch(f"{base}/transactions/{flight}", json={"updated_at": version, "tags": ["no spaces"]})
    assert refused.status_code == 422


def test_tags_are_backfilled_for_books_from_before_migration_12(tmp_path):
    from ledger.store import Store

    path = tmp_path / "old.sqlite"
    conn = sqlite3.connect(path)
    for statement in [s for m in migrations.MIGRATIONS[:11] for s in m if isinstance(s, str)]:
        conn.execute(statement)
    conn.execute("PRAGMA user_version = 11")
    stamp = migrations.now()
    conn.execute("INSERT INTO book (id, header, seq, created_at, updated_at) VALUES ('b', '', 1, ?, ?)", (stamp, stamp))
    conn.execute(
        "INSERT INTO directive (id, book_id, date, kind, flag, ordinal, text, seq, created_at, updated_at)"
        " VALUES ('t1', 'b', '2024-01-01', 'transaction', '*', 1, ?, 1, ?, ?)",
        ('2024-01-01 * "Delta" #trip #Work\n  id: "t1"\n  Assets:A  -1 USD\n  Expenses:B\n', stamp, stamp),
    )
    conn.commit()
    conn.close()

    store = Store(str(path))

    assert [dict(r) for r in store.tags("b")] == [
        {"name": "Work", "transactions": 1, "first": "2024-01-01", "last": "2024-01-01"},
        {"name": "trip", "transactions": 1, "first": "2024-01-01", "last": "2024-01-01"},
    ]

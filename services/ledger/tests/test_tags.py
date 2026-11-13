"""Tags (M17), a split's since 2026-11-12: each posting's `tags:`, listed and filtered with SQL. A
transaction's own Beancount `#tag`s aren't read."""

import datetime
import sqlite3

import pytest
from pydantic import ValidationError

from conftest import USER, http
from ledger import engine, migrations, models

D = datetime.date
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Liabilities:Card USD
2026-01-01 open Expenses:Travel
2026-01-01 open Expenses:Food
2026-01-01 open Expenses:Gifts
"""


def usd(number):
    return models.Amount(number=number, currency="USD")


def spend(day, amount, tags=(), account="Assets:Bank:Checking", other="Expenses:Food", payee="Shop"):
    """A purchase, its expense split tagged."""
    return models.TransactionIn(
        date=day,
        flag="*",
        payee=payee,
        postings=[
            models.Posting(account=account, units=usd(amount)),
            models.Posting(account=other, tags=list(tags)),
        ],
    )


def receipt(day, items, account="Assets:Bank:Checking"):
    """A receipt: one split per item, (account, amount, tags), paid from `account`."""
    total = -sum(float(amount) for _, amount, _ in items)
    return models.TransactionIn(
        date=day,
        flag="*",
        payee="Megamart",
        postings=[
            models.Posting(account=account, units=usd(f"{total:.2f}")),
            *(models.Posting(account=a, units=usd(n), tags=list(t)) for a, n, t in items),
        ],
    )


@pytest.fixture
def book(ledger):
    return ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id


def add(ledger, book, *transactions):
    return [d.id for d in ledger.create_transactions(book, list(transactions))]


def test_a_splits_tags_are_its_posting_metadata_and_listed_with_their_uses(ledger, book):
    flight, hotel, lunch = add(
        ledger,
        book,
        spend(D(2026, 4, 3), "-600.00", ["reimbursable", "italy-2026"], other="Expenses:Travel"),
        spend(D(2026, 4, 9), "-400.00", ["italy-2026"], account="Liabilities:Card", other="Expenses:Travel"),
        spend(D(2026, 5, 1), "-12.00"),
    )

    assert '    tags: "#italy-2026 #reimbursable"\n' in ledger.export(book)
    stored = ledger.transaction(book, flight)
    assert [p.tags for p in stored.postings] == [[], ["italy-2026", "reimbursable"]]
    assert all("tags" not in p.meta for p in stored.postings)
    assert [t.model_dump() for t in ledger.tags(book)] == [
        {"name": "italy-2026", "transactions": 2, "first": D(2026, 4, 3), "last": D(2026, 4, 9)},
        {"name": "reimbursable", "transactions": 1, "first": D(2026, 4, 3), "last": D(2026, 4, 3)},
    ]


def test_tags_written_as_text_are_read_per_split_and_the_transactions_are_not():
    directive = engine.parse_one(
        '2026-04-03 * "Delta" "Flight" #trip\n  Assets:Bank:Checking  -600.00 USD\n  Expenses:Travel\n    tags: "work #Trip2019"\n'
    )
    [entry] = engine.transactions([directive.text])

    assert [p.tags for p in directive.postings] == [(), ("Trip2019", "work")]
    assert [p.tags for p in entry[1].postings] == [[], ["Trip2019", "work"]]
    assert "tags" not in entry[1].model_dump()
    # Written again, the transaction's own `#trip` goes and the split's tags are canonical.
    again = engine.transaction_directive(entry[1])
    assert "#trip" not in again.text
    assert 'tags: "#Trip2019 #work"' in again.text


def test_a_bad_tags_value_is_refused():
    for value in ('"two words!"', "TRUE"):
        with pytest.raises(engine.ParseFailure):
            engine.parse_one(f'2026-04-03 * "Delta"\n  Assets:Bank:Checking  -1 USD\n  Expenses:Travel\n    tags: {value}\n')


def test_editing_and_deleting_keep_the_list_current(ledger, book):
    [flight] = add(ledger, book, spend(D(2026, 4, 3), "-600.00", ["reimbursable"]))
    current = ledger.transaction(book, flight)
    postings = [current.postings[0], current.postings[1].model_copy(update={"tags": ["claimed"]})]

    ledger.patch_transaction(book, flight, models.TransactionPatch(updated_at=current.updated_at, postings=postings))
    assert [t.name for t in ledger.tags(book)] == ["claimed"]

    version = ledger.transaction(book, flight).updated_at
    ledger.apply_changes(book, models.TransactionChanges(delete=[models.Deletion(id=flight, updated_at=version)]))
    assert ledger.tags(book) == []


def test_filters_keep_transactions_with_a_split_that_has_every_tag(ledger, book):
    flight, hotel, lunch, shop = add(
        ledger,
        book,
        spend(D(2026, 4, 3), "-600.00", ["italy-2026", "reimbursable"]),
        spend(D(2026, 4, 9), "-400.00", ["italy-2026"]),
        spend(D(2026, 5, 1), "-12.00"),
        # The tags on different splits: neither has both.
        receipt(D(2026, 5, 2), [("Expenses:Food", "30.00", ["italy-2026"]), ("Expenses:Gifts", "20.00", ["reimbursable"])]),
    )

    def journal(*tags):
        return [r.id for r in ledger.journal(book, tags=list(tags)).rows]

    assert journal("italy-2026") == [shop, hotel, flight]
    assert journal("italy-2026", "reimbursable") == [flight]
    assert journal("italy-2026", "italy-2026") == [shop, hotel, flight]  # a tag twice is one tag
    assert journal("nowhere") == []
    assert journal() == [shop, lunch, hotel, flight]
    rows = ledger.journal(book).rows
    assert rows[0].tags == ["italy-2026", "reimbursable"]  # every tag its splits have
    assert [p.tags for p in rows[0].postings] == [[], ["italy-2026"], ["reimbursable"]]

    compact = ledger.compact(book, None, ["reimbursable"])
    assert [(t.id, t.tags) for t in compact] == [(flight, ["italy-2026", "reimbursable"]), (shop, ["italy-2026", "reimbursable"])]
    # Every split is there, each with its own tags.
    assert [p.tags for p in compact[1].postings] == [[], ["italy-2026"], ["reimbursable"]]
    assert [t.id for t in ledger.compact(book, D(2026, 4, 5), ["italy-2026"])] == [hotel, shop]
    assert len(ledger.compact(book, None)) == 4  # `from` is optional: every transaction


def test_an_account_ledger_filtered_by_tag_keeps_its_balances(ledger, book):
    flight, hotel, lunch = add(
        ledger,
        book,
        spend(D(2026, 4, 3), "-600.00", ["italy-2026"]),
        spend(D(2026, 4, 9), "-400.00"),
        spend(D(2026, 5, 1), "-12.00", ["italy-2026"]),
    )

    # The bank's ledger: the tag is on the other split, and the row is kept.
    page = ledger.account_ledger(book, "Assets:Bank:Checking", tags=["italy-2026"])

    assert [(r.id, r.balance.number, r.tags) for r in page.rows] == [
        (lunch, "-1012.00", ["italy-2026"]),
        (flight, "-600.00", ["italy-2026"]),
    ]


def test_a_tag_must_be_one_beancount_allows():
    with pytest.raises(ValidationError):
        models.Posting(account="Assets:A", tags=["two words"])
    with pytest.raises(ValidationError):
        models.Posting(account="Assets:A", tags=["#hash"])
    with pytest.raises(ValidationError):  # a transaction has no tags of its own
        models.TransactionIn(date=D(2026, 1, 1), tags=["trip"], postings=[models.Posting(account="Assets:A")])
    # What Beancount allows, imported books' capitals included
    models.Posting(account="Assets:A", tags=["Trip2019", "a/b.c_d", "e-f"])


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
    assert [p["tags"] for p in compact[0]["postings"]] == [[], ["italy-2026"]]

    stored = client.get(f"{base}/transactions/{flight}").json()
    assert [p["tags"] for p in stored["postings"]] == [[], ["italy-2026"]]
    postings = [stored["postings"][0], {**stored["postings"][1], "tags": ["no spaces"]}]
    refused = client.patch(f"{base}/transactions/{flight}", json={"updated_at": stored["updated_at"], "postings": postings})
    assert refused.status_code == 422
    refused = client.patch(f"{base}/transactions/{flight}", json={"updated_at": stored["updated_at"], "tags": ["trip"]})
    assert refused.status_code == 422  # a transaction's own tags are no more


def test_split_tags_are_backfilled_and_transaction_tags_dropped_by_migration_14(tmp_path):
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
        (
            '2024-01-01 * "Delta" #trip #Work\n  id: "t1"\n  Assets:A  -1 USD\n  Expenses:B\n    tags: "#flight"\n',
            stamp,
            stamp,
        ),
    )
    conn.commit()
    conn.close()

    store = Store(str(path))

    assert [dict(r) for r in store.tags("b")] == [
        {"name": "flight", "transactions": 1, "first": "2024-01-01", "last": "2024-01-01"},
    ]
    tables = {r[0] for r in store._conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "posting_tag" in tables and "transaction_tag" not in tables

"""The journal's search (payee, narration and split memos), and its filters by accounts and budgets."""

import datetime

import pytest

from conftest import USER, http
from ledger import models

D = datetime.date
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Liabilities:Card USD
2026-01-01 open Expenses:Home:Kitchen:Tools
2026-01-01 open Expenses:Home:Garden
2026-01-01 open Expenses:Food
2026-01-01 open Expenses:Food-Truck
"""


def usd(number):
    return models.Amount(number=number, currency="USD")


def spend(day, payee, narration="", splits=(("Expenses:Food", "5.00", None),), account="Assets:Bank:Checking"):
    total = sum(float(amount) for _, amount, _ in splits)
    return models.TransactionIn(
        date=day,
        flag="*",
        payee=payee,
        narration=narration,
        postings=[
            models.Posting(account=account, units=usd(f"{-total:.2f}")),
            *(
                models.Posting(account=other, units=usd(amount), meta={"memo": memo} if memo else {})
                for other, amount, memo in splits
            ),
        ],
    )


@pytest.fixture
def book(ledger):
    return ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id


@pytest.fixture
def made(ledger, book):
    ids = [
        d.id
        for d in ledger.create_transactions(
            book,
            [
                spend(D(2026, 3, 1), "Hardware Barn", "Spatula and hose", [("Expenses:Home:Kitchen:Tools", "12.00", None)]),
                spend(
                    D(2026, 3, 2),
                    "Megamart",
                    "Weekly shop",
                    [("Expenses:Food", "30.00", "Oat milk"), ("Expenses:Home:Garden", "8.00", "Seed packets")],
                    account="Liabilities:Card",
                ),
                spend(D(2026, 3, 3), "Taco Truck", "", [("Expenses:Food-Truck", "9.00", None)]),
                spend(D(2026, 3, 4), "100% Juice_Bar", "", [("Expenses:Food", "4.00", None)]),
            ],
        )
    ]
    return dict(zip(["barn", "megamart", "truck", "juice"], ids))


def test_search_reads_payees_narrations_and_split_memos_ignoring_case(ledger, book, made):
    def found(q):
        return [r.id for r in ledger.journal(book, search=q).rows]

    assert found("hardware") == [made["barn"]]  # the payee
    assert found("HOSE") == [made["barn"]]  # the narration
    assert found("seed") == [made["megamart"]]  # a split's memo
    assert found("megamart oat") == [made["megamart"]]  # every word, from any of them
    assert found("megamart hose") == []
    assert found("  ") == [made["juice"], made["truck"], made["megamart"], made["barn"]]
    # LIKE's wildcards are only themselves.
    assert found("100%") == [made["juice"]]
    assert found("e_b") == [made["juice"]]
    assert found("%") == [made["juice"]]


def test_accounts_keep_transactions_with_a_split_in_any_of_them_or_under_one(ledger, book, made):
    def found(*accounts):
        return [r.id for r in ledger.journal(book, accounts=list(accounts)).rows]

    assert found("Expenses:Home:Kitchen:Tools") == [made["barn"]]
    assert found("Expenses:Home") == [made["megamart"], made["barn"]]  # under it
    assert found("Expenses:Food") == [made["juice"], made["megamart"]]  # not Expenses:Food-Truck
    assert found("Expenses:Food-Truck", "Expenses:Home:Garden") == [made["truck"], made["megamart"]]
    assert found("Liabilities:Card") == [made["megamart"]]
    assert found("Expenses:Nowhere") == []


def test_search_and_accounts_page_and_combine_over_http(ledger, book, made):
    client = http(ledger)
    base = f"/api/ledger/v1/books/{book}/journal"

    rows = client.get(base, params={"q": "shop", "account": ["Expenses:Home"]}).json()["rows"]
    assert [r["id"] for r in rows] == [made["megamart"]]
    rows = client.get(base, params={"account": ["Expenses:Food", "Expenses:Home:Kitchen:Tools"]}).json()["rows"]
    assert [r["id"] for r in rows] == [made["juice"], made["megamart"], made["barn"]]

    first = client.get(base, params={"account": ["Expenses:Food", "Expenses:Home"], "limit": 2}).json()
    assert [r["id"] for r in first["rows"]] == [made["juice"], made["megamart"]]
    rest = client.get(
        base, params={"account": ["Expenses:Food", "Expenses:Home"], "limit": 2, "cursor": first["next_cursor"]}
    ).json()
    assert [r["id"] for r in rest["rows"]] == [made["barn"]] and rest["next_cursor"] is None


def test_budgeted_keeps_those_counted_in_budgets_or_those_kept_out(ledger, book, made):
    roof = spend(D(2026, 3, 5), "Roofer", "", [("Expenses:Home:Garden", "9000.00", None)])
    kept_out = ledger.create_transaction(book, roof.model_copy(update={"meta": {"budget": False}})).id

    def found(budgeted):
        return [r.id for r in ledger.journal(book, budgeted=budgeted, accounts=["Expenses:Home"]).rows]

    assert found(None) == [kept_out, made["megamart"], made["barn"]]
    assert found(True) == [made["megamart"], made["barn"]]
    assert found(False) == [kept_out]
    rows = http(ledger).get(f"/api/ledger/v1/books/{book}/journal", params={"budgeted": "true"}).json()["rows"]
    assert kept_out not in [r["id"] for r in rows]


def test_an_account_ledger_searches_as_the_journal_does_and_keeps_its_balances(ledger, book, made):
    """Its list's header has the search too (2026-11-14): the rows that match, with the
    account's running balances, as a tag filter keeps them."""
    page = ledger.account_ledger(book, "Assets:Bank:Checking", search="juice")
    assert [(r.id, r.balance.number) for r in page.rows] == [(made["juice"], "-25.00")]
    assert [r.id for r in ledger.account_ledger(book, "Liabilities:Card", search="seed").rows] == [made["megamart"]]
    assert len(ledger.account_ledger(book, "Assets:Bank:Checking", search=" ").rows) == 3

    over_http = http(ledger).get(
        f"/api/ledger/v1/books/{book}/accounts/Assets:Bank:Checking/ledger", params={"q": "hose"}
    )
    assert [r["id"] for r in over_http.json()["rows"]] == [made["barn"]]


def test_attached_keeps_those_holding_a_file_or_those_holding_none(ledger, book, made):
    """HSA tracking: eligible spending still needing its receipt is the tag with `attached=false`."""
    ledger.attach(book, made["megamart"], "receipt.pdf", "application/pdf", b"%PDF-1.4 made up")

    def found(attached):
        return [r.id for r in ledger.journal(book, attached=attached, accounts=["Expenses:Home"]).rows]

    assert found(None) == [made["megamart"], made["barn"]]
    assert found(True) == [made["megamart"]]
    assert found(False) == [made["barn"]]
    rows = http(ledger).get(f"/api/ledger/v1/books/{book}/journal", params={"attached": "false"}).json()["rows"]
    assert made["megamart"] not in [r["id"] for r in rows]


def test_an_account_ledger_keeps_those_holding_a_file_or_none_with_its_balances(ledger, book, made):
    """Attachments filter an account's ledger too (2026-11-21), its running balances the account's."""
    ledger.attach(book, made["truck"], "receipt.jpg", "image/jpeg", b"made up")

    def found(attached):
        page = ledger.account_ledger(book, "Assets:Bank:Checking", attached=attached)
        return [(r.id, r.balance.number) for r in page.rows]

    assert found(True) == [(made["truck"], "-21.00")]
    assert found(False) == [(made["juice"], "-25.00"), (made["barn"], "-12.00")]
    assert len(found(None)) == 3
    over_http = http(ledger).get(
        f"/api/ledger/v1/books/{book}/accounts/Assets:Bank:Checking/ledger", params={"attached": "true"}
    )
    assert [r["id"] for r in over_http.json()["rows"]] == [made["truck"]]

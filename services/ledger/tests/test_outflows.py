"""Outflows (Loans step 2): an asset or liability that counts as spending, the lens over the
posting stream (what's paid in counts, what it pays for is masked), and budgets read through it."""

import datetime

import pytest
from conftest import USER, http

from ledger import budgets, chart, engine, models, outflows

BOOK = "book"
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Assets:Escrow:Mortgage USD
2026-01-01 open Assets:Home USD
2026-01-01 open Liabilities:Loans:Mortgage USD
2026-01-01 open Expenses:Housing:Mortgage-Interest
2026-01-01 open Expenses:Housing:Mortgage-Principal
2026-01-01 open Expenses:Housing:Escrow
2026-01-01 open Expenses:Housing:Property-Tax
2026-01-01 open Expenses:Food:Groceries

2026-01-02 * "Bought the house"
  Assets:Home  300000.00 USD
  Liabilities:Loans:Mortgage
2026-10-01 * "Mortgage payment"
  Assets:Bank:Checking  -1839.35 USD
  Liabilities:Loans:Mortgage  451.85 USD
  Expenses:Housing:Mortgage-Interest  937.50 USD
  Assets:Escrow:Mortgage  450.00 USD
2026-10-05 * "Groceries"
  Assets:Bank:Checking  -120.00 USD
  Expenses:Food:Groceries
2026-10-10 * "County tax bill, from escrow"
  Assets:Escrow:Mortgage  -2550.00 USD
  Expenses:Housing:Property-Tax
2026-10-12 * "Escrow short: the rest from checking"
  Assets:Escrow:Mortgage  -100.00 USD
  Assets:Bank:Checking  -50.00 USD
  Expenses:Housing:Property-Tax  150.00 USD
2026-10-20 * "Escrow surplus applied to principal"
  Assets:Escrow:Mortgage  -30.00 USD
  Liabilities:Loans:Mortgage  30.00 USD
2026-10-25 * "Escrow refund"
  Assets:Escrow:Mortgage  -25.00 USD
  Assets:Bank:Checking
"""
ON = datetime.date(2026, 10, 31)


@pytest.fixture
def book(ledger):
    ledger.apply_text(BOOK, TEXT, owner_id=USER)
    return ledger


def count(ledger, account, as_):
    found = {a.name: a for a in ledger.accounts(BOOK)}[account]
    return ledger.set_account(BOOK, account, models.AccountPatch(updated_at=found.updated_at, outflow=as_))


def spending(ledger, lens="outflows"):
    """Each expense account's spending in October, as the lens reads it."""
    out: dict[str, str] = {}
    for t in ledger.compact(BOOK, datetime.date(2026, 10, 1), lens=lens):
        for p in t.postings:
            if p.account.startswith("Expenses:") and p.amount:
                out[p.account] = engine.decimal_text(
                    sum([__import__("decimal").Decimal(out.get(p.account, "0")), __import__("decimal").Decimal(p.amount.number)])
                )
    return out


def test_an_account_counts_as_spending_as_an_expense_account(book):
    counted = count(book, "Liabilities:Loans:Mortgage", "Expenses:Housing:Mortgage-Principal")
    assert counted.outflow == "Expenses:Housing:Mortgage-Principal"
    assert "outflow: \"Expenses:Housing:Mortgage-Principal\"" in book.export(BOOK)
    cleared = book.set_account(
        BOOK, "Liabilities:Loans:Mortgage", models.AccountPatch(updated_at=counted.updated_at, outflow="")
    )
    assert cleared.outflow is None


def test_only_an_asset_or_liability_counts_and_only_as_an_open_expense_leaf(book):
    with pytest.raises(engine.ParseFailure, match="only an asset or liability"):
        count(book, "Expenses:Food:Groceries", "Expenses:Housing:Escrow")
    with pytest.raises(engine.ParseFailure, match="isn't an open expense account"):
        count(book, "Assets:Escrow:Mortgage", "Assets:Bank:Checking")
    with pytest.raises(engine.ParseFailure, match="isn't an open expense account"):
        count(book, "Assets:Escrow:Mortgage", "Expenses:Housing")


def test_without_any_the_lens_changes_nothing(book):
    assert spending(book) == spending(book, lens=None)


def test_paid_in_counts_and_what_it_pays_for_is_masked(book):
    count(book, "Liabilities:Loans:Mortgage", "Expenses:Housing:Mortgage-Principal")
    count(book, "Assets:Escrow:Mortgage", "Expenses:Housing:Escrow")
    assert spending(book) == {
        # The payment: all of it is spending.
        "Expenses:Housing:Mortgage-Interest": "937.50",
        "Expenses:Housing:Mortgage-Principal": "481.85",  # 451.85, and the 30.00 surplus? no: see below
        "Expenses:Housing:Escrow": "450.00",
        "Expenses:Food:Groceries": "120.00",
        # The tax bill from escrow is masked; of the 150.00 short one, the 50.00 from checking counts.
        "Expenses:Housing:Property-Tax": "50.00",
    } | {"Expenses:Housing:Mortgage-Principal": "451.85"}
    # Borrowing (the house) and the refund are no one's spending.
    house = next(t for t in book.compact(BOOK, None, lens="outflows") if t.narration == "Bought the house")
    assert [p.outflow_of for p in house.postings] == [None, None]
    lensed = next(t for t in book.compact(BOOK, None, lens="outflows") if t.narration == "Mortgage payment")
    assert [(p.account, p.outflow_of) for p in lensed.postings if p.outflow_of] == [
        ("Expenses:Housing:Mortgage-Principal", "Liabilities:Loans:Mortgage"),
        ("Expenses:Housing:Escrow", "Assets:Escrow:Mortgage"),
    ]


def test_a_setting_covers_the_subtree():
    found = {"Assets:Escrow": "Expenses:Housing:Escrow"}
    assert outflows.target_of("Assets:Escrow:Mortgage", found) == ("Assets:Escrow", "Expenses:Housing:Escrow")
    assert outflows.target_of("Assets:Bank:Checking", found) is None


def test_budgets_count_outflows(book):
    budgets.put(
        book,
        BOOK,
        "Expenses:Housing",
        models.BudgetIn(start=datetime.date(2026, 10, 1), amount="2000", unit="month", every=1, updated_at=None),
    )
    before = {line.account: line for line in budgets.status(book, BOOK, ON, "period").lines}
    assert before["Expenses:Housing"].spent.number == "3637.50"  # interest and both tax bills
    count(book, "Liabilities:Loans:Mortgage", "Expenses:Housing:Mortgage-Principal")
    count(book, "Assets:Escrow:Mortgage", "Expenses:Housing:Escrow")
    after = {line.account: line for line in budgets.status(book, BOOK, ON, "period").lines}
    # Interest 937.50 + principal 451.85 + escrow 450.00 + the 50.00 of tax from checking.
    assert after["Expenses:Housing"].spent.number == "1889.35"


def test_a_renamed_target_is_followed(book):
    count(book, "Assets:Escrow:Mortgage", "Expenses:Housing:Escrow")
    chart.rename(book, BOOK, "Expenses:Housing", "Expenses:Home")
    found = {a.name: a for a in book.accounts(BOOK)}
    assert found["Assets:Escrow:Mortgage"].outflow == "Expenses:Home:Escrow"


def test_through_the_api(book):
    client = http(book)
    found = client.get(f"/api/ledger/v1/books/{BOOK}/accounts").json()
    escrow = next(a for a in found if a["name"] == "Assets:Escrow:Mortgage")
    patched = client.patch(
        f"/api/ledger/v1/books/{BOOK}/accounts/Assets:Escrow:Mortgage",
        json={"updated_at": escrow["updated_at"], "outflow": "Expenses:Housing:Escrow"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["outflow"] == "Expenses:Housing:Escrow"
    lensed = client.get(f"/api/ledger/v1/books/{BOOK}/transactions/compact?from=2026-10-01&lens=outflows").json()
    tax = next(t for t in lensed if t["narration"] == "County tax bill, from escrow")
    assert [p["account"] for p in tax["postings"]] == ["Assets:Escrow:Mortgage"]
    plain = client.get(f"/api/ledger/v1/books/{BOOK}/transactions/compact?from=2026-10-01").json()
    assert len(next(t for t in plain if t["narration"] == "County tax bill, from escrow")["postings"]) == 2

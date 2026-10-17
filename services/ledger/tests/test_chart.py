"""The chart of accounts (M10): the tree with rolled-up balances, renaming, archiving, deleting."""

import datetime

import pytest
from conftest import USER, http

from ledger import chart, models

BOOK = "book"
TEXT = """option "operating_currency" "USD"
2024-01-01 open Assets:Bank:Checking USD
2024-01-01 open Assets:Bank:Savings USD
2024-01-01 open Assets:Broker:Cash USD
2024-01-01 open Assets:Broker:VTI VTI
2024-01-01 open Expenses:Food:Groceries
2024-01-01 open Expenses:Food:Coffee
2024-01-01 open Expenses:Fun
2024-01-01 open Equity:Opening-Balances
2024-01-01 open Income:Salary

2024-01-02 * "Opening balance"
  Assets:Bank:Checking   1000.00 USD
  Equity:Opening-Balances

2024-02-01 * "Groceries"
  Assets:Bank:Checking   -50.00 USD
  Expenses:Food:Groceries

2024-02-02 * "Coffee"
  Assets:Bank:Checking   -4.50 USD
  Expenses:Food:Coffee

2024-02-03 * "Buy"
  Assets:Broker:VTI   2 VTI {100.00 USD}
  Assets:Bank:Checking  -200.00 USD

2024-02-04 price VTI 150.00 USD
2024-02-05 balance Expenses:Food:Coffee 4.50 USD
2024-02-05 note Expenses:Food:Coffee "a note"
2024-02-06 custom "budget" Expenses:Food:Coffee "monthly" 30.00 USD
"""


@pytest.fixture
def book(ledger):
    ledger.apply_text(BOOK, TEXT, owner_id=USER)
    return ledger


def by_name(ledger):
    return {a.name: a for a in chart.tree(ledger, BOOK)}


def test_the_tree_rolls_balances_up_and_values_holdings(book):
    accounts = by_name(book)

    assert accounts["Expenses:Food"].total == [models.Amount(number="54.50", currency="USD")]
    assert accounts["Expenses:Food"].balance == []
    assert accounts["Expenses:Food"].value.number == "54.50" and accounts["Expenses:Food"].unpriced == []
    assert accounts["Assets:Broker"].value == models.Amount(number="300.00", currency="USD")
    assert accounts["Assets"].value.number == "1045.50"  # 745.50 cash + 300.00 of VTI
    assert accounts["Expenses:Food:Coffee"].splits == 1
    assert accounts["Assets:Bank:Checking"].splits == 4
    assert accounts["Equity:Opening-Balances"].protected and accounts["Assets"].protected
    assert accounts["Assets:Broker:Cash"].protected and not accounts["Assets:Broker"].protected


def test_renaming_rewrites_every_directive_that_names_it_and_its_children(book):
    renamed = chart.rename(book, BOOK, "Expenses:Food", "Expenses:Eating")
    export = book.export(BOOK)

    assert renamed.name == "Expenses:Eating"
    assert "Expenses:Food" not in export
    for line in (
        "open Expenses:Eating:Coffee",
        "balance Expenses:Eating:Coffee",
        "note Expenses:Eating:Coffee",
        'custom "budget" Expenses:Eating:Coffee',
        "  Expenses:Eating:Groceries",
    ):
        assert line in export
    assert book.problems(BOOK) == []
    assert by_name(book)["Expenses:Eating"].total[0].number == "54.50"


def test_renames_that_would_break_something_are_refused(book):
    for old, new, why in [
        ("Expenses:Food", "Expenses:Fun", "merge"),
        ("Expenses:Food", "Assets:Food", "type"),
        ("Expenses:Food", "Expenses:Food:Sub", "under itself"),
        ("Equity:Opening-Balances", "Equity:Start", "system"),
        ("Assets:Broker:Cash", "Assets:Broker:Money", "brokerage"),
        ("Expenses", "Spending", "top-level"),
        ("Expenses:Fun", "Expenses:Food:Coffee:Fun", "under a leaf"),
    ]:
        with pytest.raises(chart.AccountRefused, match=why):
            chart.rename(book, BOOK, old, new)
    chart.rename(book, BOOK, "Assets:Broker", "Assets:Brokerage")  # its parts follow
    assert "Assets:Brokerage:VTI" in by_name(book)


def test_deleting_moves_every_split_to_the_substitute_and_drops_the_rest(book):
    before = by_name(book)["Assets:Bank:Checking"].total

    deleted = chart.delete(book, BOOK, "Expenses:Food", substitute="Expenses:Fun")

    accounts = by_name(book)
    export = book.export(BOOK)
    assert deleted == ["Expenses:Food", "Expenses:Food:Coffee", "Expenses:Food:Groceries"]
    assert "Expenses:Food" not in accounts and "Expenses:Food" not in export
    assert accounts["Expenses:Fun"].total[0].number == "54.50"
    assert accounts["Assets:Bank:Checking"].total == before
    assert 'custom "budget"' not in export  # a budget is the account's own: it goes with it
    assert book.problems(BOOK) == []


def test_deleting_needs_a_substitute_when_there_are_splits(book):
    with pytest.raises(chart.AccountRefused, match="choose an account"):
        chart.delete(book, BOOK, "Expenses:Food:Coffee", substitute=None)
    with pytest.raises(chart.AccountRefused, match="one of the accounts being deleted"):
        chart.delete(book, BOOK, "Expenses:Food", substitute="Expenses:Food:Coffee")
    assert chart.delete(book, BOOK, "Income:Salary", substitute=None) == ["Income:Salary"]


def test_archiving_closes_after_an_optional_closing_transfer_and_unarchiving_reopens(book):
    with pytest.raises(chart.AccountRefused, match="until 2024-02-03"):
        chart.archive(book, BOOK, "Assets:Bank:Checking", date=datetime.date(2024, 1, 15))

    closed = chart.archive(
        book, BOOK, "Assets:Bank:Checking", date=datetime.date(2024, 3, 1), transfer_to="Assets:Bank:Savings"
    )

    accounts = by_name(book)
    assert closed == ["Assets:Bank:Checking"]
    assert accounts["Assets:Bank:Checking"].close == datetime.date(2024, 3, 1)
    assert accounts["Assets:Bank:Checking"].total == []
    assert accounts["Assets:Bank:Savings"].total[0].number == "745.50"
    assert book.problems(BOOK) == []
    assert chart.unarchive(book, BOOK, "Assets:Bank:Checking") == ["Assets:Bank:Checking"]
    assert by_name(book)["Assets:Bank:Checking"].close is None


def test_over_http_with_display_names_and_versions(book):
    client = http(book)
    url = f"/api/ledger/v1/books/{BOOK}/accounts"
    coffee = next(a for a in client.get(f"{url}/tree").json() if a["name"] == "Expenses:Food:Coffee")

    named = client.patch(f"{url}/Expenses:Food:Coffee", json={"updated_at": coffee["updated_at"], "display_name": "Café"})
    assert named.json()["display_name"] == "Café"
    stale = client.post(f"{url}/Expenses:Food:Coffee/rename", json={"to": "Expenses:Cafe", "updated_at": coffee["updated_at"]})
    assert stale.status_code == 409
    refused = client.post(f"{url}/Expenses:Food:Coffee/rename", json={"to": "Expenses:Fun"})
    assert refused.status_code == 422 and "merge" in refused.json()["detail"]
    assert client.delete(f"{url}/Expenses:Fun").status_code == 200  # no splits: no substitute needed
    merged = client.delete(f"{url}/Expenses:Food:Coffee", params={"substitute": "Expenses:Food:Groceries"})
    assert merged.json() == ["Expenses:Food:Coffee"]


def test_what_has_no_price_is_named_beside_the_one_figure(book):
    book.apply_text(
        BOOK,
        """2024-01-01 open Assets:Vacation VACHR
2024-01-01 open Income:Vacation VACHR
2024-03-01 * "Accrued"
  Assets:Vacation  8 VACHR
  Income:Vacation
""",
    )
    assets = by_name(book)["Assets"]
    assert assets.value.number == "1045.50" and assets.unpriced == ["VACHR"]

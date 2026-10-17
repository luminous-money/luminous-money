"""Budgets (M11): versions kept as `custom "budget"` directives, the rule, and status."""

import datetime
import re

import pytest
from conftest import USER, http

from ledger import budgets, chart, models
from ledger.store import StaleVersion

BOOK = "book"
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Assets:Bank:Savings USD
2026-01-01 open Expenses:Housing:Rent
2026-01-01 open Expenses:Food:Groceries
2026-01-01 open Expenses:Food:Coffee
2026-01-01 open Expenses:Fun
2026-01-01 open Income:Salary

2026-10-01 * "Rent"
  Assets:Bank:Checking  -2000.00 USD
  Expenses:Housing:Rent
2026-10-03 * "Groceries"
  Assets:Bank:Checking  -120.00 USD
  Expenses:Food:Groceries
2026-10-05 ! "Coffee"
  Assets:Bank:Checking  -4.50 USD
  Expenses:Food:Coffee
2026-10-06 * "Grocery refund"
  Assets:Bank:Checking  20.00 USD
  Expenses:Food:Groceries
2026-10-07 * "Moved between food accounts"
  Expenses:Food:Coffee  10.00 USD
  Expenses:Food:Groceries
2026-10-08 * "Pay"
  Income:Salary  -5000.00 USD
  Assets:Bank:Checking
2026-10-09 * "Saved"
  Assets:Bank:Checking  -500.00 USD
  Assets:Bank:Savings
2026-09-20 * "Last month's groceries"
  Assets:Bank:Checking  -99.00 USD
  Expenses:Food:Groceries
"""
OCT = datetime.date(2026, 10, 1)
ON = datetime.date(2026, 10, 15)


@pytest.fixture
def book(ledger):
    ledger.apply_text(BOOK, TEXT, owner_id=USER)
    return ledger


def budget(ledger, account, amount, unit="month", every=1, start=OCT, updated_at=None):
    return budgets.put(
        ledger,
        BOOK,
        account,
        models.BudgetIn(start=start, amount=amount, unit=unit, every=every, updated_at=updated_at),
    )


def lines(ledger, basis="period", on=ON):
    return {line.account: line for line in budgets.status(ledger, BOOK, on, basis).lines}


def test_versions_are_custom_directives_and_a_top_level_account_is_a_string(book):
    budget(book, "Expenses", "10500")
    budget(book, "Expenses:Fun", "50", unit="week", every=2)
    budget(book, "Expenses:Food", "900", every=3)

    export = book.export(BOOK)
    assert '2026-10-01 custom "budget" "Expenses" "monthly" 10500 USD' in export
    assert re.search(r'2026-10-01 custom "budget" Expenses:Fun "weekly" 50 USD\n(  \w+: .*\n)*  every: 2', export)
    assert '2026-10-01 custom "budget" Expenses:Food "quarterly" 900 USD' in export
    found = {(v.account, v.unit, v.every) for v in budgets.versions(book, BOOK)}
    assert found == {("Expenses", "month", 1), ("Expenses:Fun", "week", 2), ("Expenses:Food", "month", 3)}
    assert book.problems(BOOK) == []


def test_a_change_is_a_new_version_and_the_same_start_replaces_it(book):
    first = budget(book, "Expenses:Food", "600", start=datetime.date(2026, 9, 1))
    budget(book, "Expenses:Food", "700")
    again = next(v for v in budgets.versions(book, BOOK) if v.start == OCT)

    with pytest.raises(StaleVersion):
        budget(book, "Expenses:Food", "750")  # a version starts then: say which was read
    budget(book, "Expenses:Food", "750", updated_at=again.updated_at)

    assert [(v.start, str(v.amount)) for v in budgets.versions(book, BOOK)] == [
        (datetime.date(2026, 9, 1), "600"),
        (OCT, "750"),
    ]
    assert lines(book, on=datetime.date(2026, 9, 15))["Expenses:Food"].budget.number == "600.00"
    assert lines(book)["Expenses:Food"].budget.number == "750.00"
    assert first.start == datetime.date(2026, 9, 1)


def test_ending_a_budget_keeps_earlier_periods_or_removes_it_when_nothing_was_before(book):
    budget(book, "Expenses:Food", "600", start=datetime.date(2026, 9, 1))
    assert budget(book, "Expenses:Food", "0") is not None  # ends it from October
    assert "Expenses:Food" not in lines(book)
    assert "Expenses:Food" in lines(book, on=datetime.date(2026, 9, 15))

    budget(book, "Expenses:Fun", "50")
    assert budget(book, "Expenses:Fun", "0", updated_at=budgets.versions(book, BOOK)[-1].updated_at) is None
    assert all(v.account != "Expenses:Fun" for v in budgets.versions(book, BOOK))


def test_no_budget_is_higher_per_year_than_one_above_it(book):
    budget(book, "Expenses:Food", "600")
    with pytest.raises(budgets.BudgetRefused, match="more than Expenses:Food's"):
        budget(book, "Expenses:Food:Groceries", "150", unit="week")  # about $7,826 a year against $7,200
    budget(book, "Expenses:Food:Groceries", "130", unit="week")  # about $6,782
    with pytest.raises(budgets.BudgetRefused, match="Expenses:Food:Groceries's budget, under it"):
        budget(book, "Expenses:Food", "500", updated_at=budgets.versions(book, BOOK)[0].updated_at)
    # Checked from its start on: a later, smaller version of the node is refused too.
    with pytest.raises(budgets.BudgetRefused):
        budget(book, "Expenses:Food", "100", start=datetime.date(2026, 12, 1))


def test_status_measures_each_period_with_refunds_transfers_and_unconfirmed(book):
    budget(book, "Expenses:Food", "600")
    budget(book, "Income:Salary", "5000")
    budget(book, "Assets:Bank:Savings", "400")

    found = lines(book)
    food = found["Expenses:Food"]
    # 120 - 20 refund + 4.50 coffee; the move from groceries to coffee nets to nothing.
    assert (food.spent.number, food.unconfirmed.number, food.left.number) == ("104.50", "4.50", "495.50")
    assert (food.period_start, food.period_end, food.kind) == (OCT, datetime.date(2026, 11, 1), "limit")
    assert (found["Income:Salary"].spent.number, found["Income:Salary"].kind) == ("5000.00", "goal")
    assert found["Assets:Bank:Savings"].spent.number == "500.00"


def test_periods_count_from_the_start(book):
    budget(book, "Expenses:Food", "100", unit="week", every=2, start=datetime.date(2026, 9, 28))
    food = lines(book)["Expenses:Food"]
    assert (food.period_start, food.period_end) == (datetime.date(2026, 10, 12), datetime.date(2026, 10, 26))
    assert food.spent.number == "0.00"  # nothing for food in the fortnight from the 12th

    v = budgets.versions(book, BOOK)[0]
    jan31 = budgets.Version(v.id, v.account, datetime.date(2026, 1, 31), v.amount, "USD", 1, "month", "")
    assert budgets.period_on(jan31, datetime.date(2026, 3, 1)) == (datetime.date(2026, 2, 28), datetime.date(2026, 3, 31))


def test_a_node_split_across_accounts_under_it_keeps_the_rest_as_other(book):
    budget(book, "Expenses", "10500")
    budget(book, "Expenses:Housing", "5000")
    budget(book, "Expenses:Food:Groceries", "100", unit="week")

    expenses = lines(book)["Expenses"]
    weekly_in_a_month = (100 * 365.25 / 7) / 12
    assert float(expenses.other.budget.number) == pytest.approx(10500 - 5000 - weekly_in_a_month, abs=0.01)
    # Everything spent but rent and groceries: the coffee (4.50 + 10 moved into it).
    assert expenses.other.spent.number == "14.50"
    assert lines(book)["Expenses:Housing"].other is None  # nothing budgeted under it


def test_over_allocating_and_moves_that_break_the_rule_are_flagged(book):
    budget(book, "Expenses:Food", "300")
    budget(book, "Expenses:Food:Groceries", "200")
    budget(book, "Expenses:Food:Coffee", "150")
    budget(book, "Expenses:Fun", "400")

    assert "add up to more than it" in lines(book)["Expenses:Food"].problems[0]
    chart.rename(book, BOOK, "Expenses:Fun", "Expenses:Food:Fun")  # allowed, and flagged
    assert "More than Expenses:Food's budget" in lines(book)["Expenses:Food:Fun"].problems[0]


def test_per_month_restates_every_budget_and_home_sums_the_highest_expense_ones(book):
    budget(book, "Expenses:Food", "100", unit="week")
    budget(book, "Expenses:Housing", "24000", unit="year")
    budget(book, "Expenses:Housing:Rent", "2000")
    budget(book, "Income:Salary", "5000")

    monthly = lines(book, basis="month")
    assert monthly["Expenses:Food"].budget.number == "434.82"  # 100 × 365.25 / 7 / 12
    assert monthly["Expenses:Housing"].budget.number == "2000.00"
    assert monthly["Expenses:Food"].period_start == OCT
    summary = budgets.status(book, BOOK, ON, "period").summary
    assert (summary.budget.number, summary.spent.number) == ("2434.82", "2104.50")  # income isn't in it


def test_archived_accounts_budgets_rest_and_deleted_accounts_budgets_go(book):
    budget(book, "Expenses:Fun", "50")
    budget(book, "Expenses:Food:Coffee", "30")
    chart.archive(book, BOOK, "Expenses:Fun", date=datetime.date(2026, 10, 10))
    assert "Expenses:Fun" not in lines(book)
    chart.unarchive(book, BOOK, "Expenses:Fun")
    assert "Expenses:Fun" in lines(book)

    chart.delete(book, BOOK, "Expenses:Food:Coffee", substitute="Expenses:Food:Groceries")
    assert [v.account for v in budgets.versions(book, BOOK)] == ["Expenses:Fun"]


def test_over_http(book):
    client = http(book)
    url = f"/api/ledger/v1/books/{BOOK}/budgets"

    put = client.put(f"{url}/Expenses:Food", json={"start": "2026-10-01", "amount": "600", "unit": "month"})
    refused = client.put(f"{url}/Expenses:Food:Coffee", json={"start": "2026-10-01", "amount": "700", "unit": "month"})
    status = client.get(f"{url}/status", params={"on": "2026-10-15"}).json()

    assert put.status_code == 200 and put.json()["amount"] == {"number": "600", "currency": "USD"}
    assert refused.status_code == 422 and "more than Expenses:Food's" in refused.json()["detail"]
    assert [line["account"] for line in status["lines"]] == ["Expenses:Food"]
    assert client.get(url).json()[0]["account"] == "Expenses:Food"
    assert client.put(f"{url}/Expenses:Nope", json={"start": "2026-10-01", "amount": "1", "unit": "month"}).status_code == 404


def test_a_transaction_kept_out_of_budgets_still_counts_everywhere_else(book):
    budget(book, "Expenses:Housing", "500")
    roof = next(t for t in book.transactions(BOOK) if t.narration == "Rent")
    book.patch_transaction(BOOK, roof.id, models.TransactionPatch(updated_at=roof.updated_at, meta={"budget": False}))

    assert lines(book)["Expenses:Housing"].spent.number == "0.00"
    assert book.balance(BOOK, "Expenses:Housing:Rent") == [models.Amount(number="2000.00", currency="USD")]
    assert "budget: FALSE" in book.export(BOOK)

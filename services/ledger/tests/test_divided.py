"""Dividing accounts (M15): one real account, held in the books as its parts."""

import datetime

import pytest

from ledger import chart, models, reconcile
from test_reconcile import add, book, spend  # noqa: F401 (book is a fixture)

D = datetime.date


def test_dividing_an_account_keeps_its_name_history_and_statements(ledger, book):
    checking = "Assets:Bank:Checking"
    opening, lunch = add(
        ledger,
        book,
        spend(D(2026, 1, 1), "10000.00", other="Equity:Opening-Balances"),
        spend(D(2026, 1, 5), "-12.00"),
    )
    reconcile.reconcile(ledger, book, checking, models.ReconcileIn(statement_date=D(2026, 1, 31), balance="9988.00", transactions=[opening, lunch]))
    version = next(a for a in ledger.accounts(book) if a.name == checking).updated_at

    whole = chart.divide(
        ledger,
        book,
        checking,
        models.DivideIn(main="General", parts=[models.DividePart(name="Padding", amount="5000.00")], date=D(2026, 2, 1), updated_at=version),
    )

    assert (whole.kind, whole.divided, whole.main_part) == ("node", True, f"{checking}:General")
    accounts = {a.name: a for a in chart.tree(ledger, book)}
    assert accounts[f"{checking}:General"].total == [models.Amount(number="4988.00", currency="USD")]
    assert accounts[f"{checking}:Padding"].total == [models.Amount(number="5000.00", currency="USD")]
    assert accounts[checking].total == [models.Amount(number="9988.00", currency="USD")]
    # Its history (marks too) is the main part's; its statement is still the whole's, holding.
    assert ledger.transaction(book, lunch).postings[0].account == f"{checking}:General"
    [statement] = reconcile.history(ledger, book, checking).reconciliations
    assert statement.off_by is None
    assert ledger.problems(book) == []
    # The whole's ledger says which part each touched; the transfer between them nets to nothing.
    [divided, *_] = ledger.account_ledger(book, checking).rows
    assert divided.amount.number == "0.00" or divided.amount.number == "0"
    assert {p.account for p in divided.parts} == {f"{checking}:General", f"{checking}:Padding"}


def test_a_main_part_is_kept_through_renames_and_cant_be_deleted(ledger, book):
    checking = "Assets:Bank:Checking"
    version = next(a for a in ledger.accounts(book) if a.name == checking).updated_at
    chart.divide(ledger, book, checking, models.DivideIn(parts=[models.DividePart(name="Padding", amount="0")], date=D(2026, 2, 1), updated_at=version))
    main = f"{checking}:General"

    with pytest.raises(chart.AccountRefused, match="where new money lands"):
        chart.delete(ledger, book, main, substitute=f"{checking}:Padding")
    with pytest.raises(chart.AccountRefused, match="where new money lands"):
        chart.archive(ledger, book, main)
    chart.rename(ledger, book, main, f"{checking}:Everyday")
    assert next(a for a in ledger.accounts(book) if a.name == checking).main_part == f"{checking}:Everyday"
    chart.rename(ledger, book, checking, "Assets:Bank:Joint")
    joint = next(a for a in ledger.accounts(book) if a.name == "Assets:Bank:Joint")
    assert joint.main_part == "Assets:Bank:Joint:Everyday"

    # Choosing another main part, then the old one can go.
    ledger.set_account(book, joint.name, models.AccountPatch(updated_at=joint.updated_at, main_part="Assets:Bank:Joint:Padding"))
    chart.delete(ledger, book, "Assets:Bank:Joint:Everyday", substitute="Assets:Bank:Joint:Padding")
    joint = next(a for a in ledger.accounts(book) if a.name == "Assets:Bank:Joint")
    with pytest.raises(Exception, match="isn't one of"):
        ledger.set_account(book, joint.name, models.AccountPatch(updated_at=joint.updated_at, main_part="Assets:Bank:Savings"))


def test_dividing_a_node_turns_on_its_first_part_as_main(ledger, book):
    pnc = next(a for a in ledger.accounts(book) if a.name == "Assets:PNC")
    ledger.set_account(book, "Assets:PNC", models.AccountPatch(updated_at=pnc.updated_at, divided=True))
    assert next(a for a in ledger.accounts(book) if a.name == "Assets:PNC").main_part == "Assets:PNC:General"
    pnc = next(a for a in ledger.accounts(book) if a.name == "Assets:PNC")
    ledger.set_account(book, "Assets:PNC", models.AccountPatch(updated_at=pnc.updated_at, divided=False))
    assert next(a for a in ledger.accounts(book) if a.name == "Assets:PNC").main_part is None


def test_a_divided_account_keeps_its_description_on_the_whole(ledger, book):
    checking = "Assets:Bank:Checking"
    version = next(a for a in ledger.accounts(book) if a.name == checking).updated_at
    version = ledger.set_account(book, checking, models.AccountPatch(updated_at=version, description="Joint, at the bank")).updated_at

    chart.divide(ledger, book, checking, models.DivideIn(parts=[models.DividePart(name="Padding", amount="0")], date=D(2026, 2, 1), updated_at=version))

    accounts = {a.name: a for a in ledger.accounts(book)}
    assert accounts[checking].description == "Joint, at the bank"
    assert accounts[f"{checking}:General"].description is None

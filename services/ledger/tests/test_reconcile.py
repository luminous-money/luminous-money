"""Reconciliation (M14): agreeing an account with a statement, kept as Beancount."""

import datetime
import re

import pytest

from conftest import USER, http
from ledger import models, reconcile
from ledger.reconcile import ReconcileRefused

D = datetime.date
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Assets:Bank:Savings USD
2026-01-01 open Assets:PNC
  kind: "node"
2026-01-01 open Assets:PNC:General USD
2026-01-01 open Assets:PNC:Padding USD
2026-01-01 open Liabilities:Card USD
2026-01-01 open Expenses:Food
2026-01-01 open Income:Salary
2026-01-01 open Equity:Opening-Balances
"""


def spend(day, amount, account="Assets:Bank:Checking", other="Expenses:Food", flag="*", payee="Shop"):
    return models.TransactionIn(
        date=day,
        flag=flag,
        payee=payee,
        postings=[
            models.Posting(account=account, units=models.Amount(number=amount, currency="USD")),
            models.Posting(account=other),
        ],
    )


@pytest.fixture
def book(ledger):
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    return book


def add(ledger, book, *transactions):
    return [d.id for d in ledger.create_transactions(book, list(transactions))]


def test_a_statement_reconciles_whats_ticked_into_the_books(ledger, book):
    opening, lunch, pay, late = add(
        ledger,
        book,
        spend(D(2026, 1, 1), "1000.00", other="Equity:Opening-Balances"),
        spend(D(2026, 1, 5), "-12.00", flag="!"),
        spend(D(2026, 1, 15), "500.00", other="Income:Salary"),
        spend(D(2026, 2, 3), "-30.00"),
    )

    state = reconcile.state(ledger, book, "Assets:Bank:Checking", D(2026, 1, 31))
    assert state.reconciled_balance.number == "0" and state.last is None
    assert [t.id for t in state.transactions] == [opening, lunch, pay, late]  # late: within 14 days
    assert [t.opening for t in state.transactions] == [True, False, False, False]

    done = reconcile.reconcile(
        ledger,
        book,
        "Assets:Bank:Checking",
        models.ReconcileIn(statement_date=D(2026, 1, 31), balance="1488.00", transactions=[opening, lunch, pay]),
    )

    assert done.confirmed == [lunch]
    assert (done.reconciliation.statement_date, done.reconciliation.transactions) == (D(2026, 1, 31), 3)
    assert done.reconciliation.off_by is None
    # The export carries it: the statement, and the marks.
    assert ledger.problems(book) == []
    text = ledger.export(book)
    assert re.search(r'2026-01-31 custom "statement" Assets:Bank:Checking +1488.00 USD', text)
    assert text.count("reconciled: 2026-01-31") == 3
    # Next time, it starts from there.
    after = reconcile.state(ledger, book, "Assets:Bank:Checking", D(2026, 2, 28))
    assert after.reconciled_balance.number == "1488.00" and after.last == D(2026, 1, 31)
    assert [t.id for t in after.transactions] == [late]


def test_it_wont_finish_until_it_balances_or_go_back_in_time(ledger, book):
    [lunch] = add(ledger, book, spend(D(2026, 1, 5), "-12.00"))
    statement = models.ReconcileIn(statement_date=D(2026, 1, 31), balance="-10.00", transactions=[lunch])

    with pytest.raises(ReconcileRefused, match="doesn't balance"):
        reconcile.reconcile(ledger, book, "Assets:Bank:Checking", statement)
    assert "reconciled:" not in ledger.export(book)

    reconcile.reconcile(ledger, book, "Assets:Bank:Checking", statement.model_copy(update={"balance": "-12.00"}))
    with pytest.raises(ReconcileRefused, match="must be later"):
        reconcile.reconcile(
            ledger, book, "Assets:Bank:Checking", models.ReconcileIn(statement_date=D(2026, 1, 20), balance="-12.00", transactions=[])
        )


def test_nothing_moves_what_isnt_on_the_statement_stays_outstanding(ledger, book):
    account = "Assets:Bank:Checking"
    cleared, outstanding = add(
        ledger,
        book,
        spend(D(2026, 2, 2), "-20.00", payee="Written the 2nd, on January's statement"),
        spend(D(2026, 1, 28), "-50.00", payee="Check, not cashed yet"),
    )

    reconcile.reconcile(ledger, book, account, models.ReconcileIn(statement_date=D(2026, 1, 31), balance="-20.00", transactions=[cleared]))

    assert ledger.transaction(book, cleared).date == D(2026, 2, 2)
    assert ledger.transaction(book, outstanding).date == D(2026, 1, 28)
    [statement] = reconcile.history(ledger, book, account).reconciliations
    assert statement.off_by is None  # by what's reconciled with it, not by dates
    # February's statement has the check.
    reconcile.reconcile(ledger, book, account, models.ReconcileIn(statement_date=D(2026, 2, 28), balance="-70.00", transactions=[outstanding]))
    assert all(r.off_by is None for r in reconcile.history(ledger, book, account).reconciliations)


def test_a_transfer_its_two_banks_date_apart_reconciles_on_each_side(ledger, book):
    """Checking's bank says the money left Jan 30; savings' says it arrived Feb 2. One
    transaction, each side reconciled with its own bank's statement."""
    checking, savings = "Assets:Bank:Checking", "Assets:Bank:Savings"
    [move] = add(ledger, book, spend(D(2026, 1, 30), "-100.00", other=savings))

    reconcile.reconcile(ledger, book, checking, models.ReconcileIn(statement_date=D(2026, 1, 31), balance="-100.00", transactions=[move]))
    reconcile.reconcile(ledger, book, savings, models.ReconcileIn(statement_date=D(2026, 1, 31), balance="0", transactions=[]))
    reconcile.reconcile(ledger, book, savings, models.ReconcileIn(statement_date=D(2026, 2, 28), balance="100.00", transactions=[move]))

    moved = ledger.transaction(book, move)
    assert moved.date == D(2026, 1, 30) and len(moved.postings) == 2
    assert [p.meta["reconciled"] for p in moved.postings] == [
        models.MetaDate(date=D(2026, 1, 31)),
        models.MetaDate(date=D(2026, 2, 28)),
    ]
    for account in (checking, savings):
        assert all(r.off_by is None for r in reconcile.history(ledger, book, account).reconciliations)
    assert ledger.problems(book) == []


def test_an_imported_books_balance_assertions_are_checked_by_date(ledger, book):
    add(ledger, book, spend(D(2026, 1, 5), "-12.00"))
    ledger.create(book, "2026-02-01 balance Assets:Bank:Checking -10.00 USD\n")

    [check] = reconcile.history(ledger, book, "Assets:Bank:Checking").reconciliations

    assert (check.statement, check.statement_date) == (False, D(2026, 1, 31))
    assert check.off_by == models.Amount(number="2.00", currency="USD")


def test_undo_takes_the_latest_off(ledger, book):
    a, b = add(ledger, book, spend(D(2026, 1, 5), "-12.00"), spend(D(2026, 2, 5), "-8.00"))
    account = "Assets:Bank:Checking"
    reconcile.reconcile(ledger, book, account, models.ReconcileIn(statement_date=D(2026, 1, 31), balance="-12.00", transactions=[a]))
    reconcile.reconcile(ledger, book, account, models.ReconcileIn(statement_date=D(2026, 2, 28), balance="-20.00", transactions=[b]))

    with pytest.raises(ReconcileRefused, match="latest"):
        reconcile.undo(ledger, book, account, D(2026, 1, 31))
    reconcile.undo(ledger, book, account, D(2026, 2, 28))

    history = reconcile.history(ledger, book, account).reconciliations
    assert [r.statement_date for r in history] == [D(2026, 1, 31)]
    assert reconcile.state(ledger, book, account, None).reconciled_balance.number == "-12.00"
    assert ledger.export(book).count("reconciled:") == 1


def test_a_divided_account_reconciles_as_one(ledger, book):
    pnc = "Assets:PNC"
    version = next(a for a in ledger.accounts(book) if a.name == pnc).updated_at
    ledger.set_account(book, pnc, models.AccountPatch(updated_at=version, divided=True))
    pay, move, lunch = add(
        ledger,
        book,
        spend(D(2026, 1, 2), "1000.00", account="Assets:PNC:General", other="Income:Salary"),
        spend(D(2026, 1, 3), "-400.00", account="Assets:PNC:General", other="Assets:PNC:Padding"),
        spend(D(2026, 1, 9), "-25.00", account="Assets:PNC:Padding"),
    )

    # Its sub-accounts aren't reconciled themselves.
    with pytest.raises(ReconcileRefused, match="part of Assets:PNC"):
        reconcile.state(ledger, book, "Assets:PNC:General", None)
    state = reconcile.state(ledger, book, pnc, D(2026, 1, 31))
    assert [t.id for t in state.transactions] == [pay, lunch] and state.internal == 1

    reconcile.reconcile(ledger, book, pnc, models.ReconcileIn(statement_date=D(2026, 1, 31), balance="975.00", transactions=[pay, lunch]))

    # The transfer between them reconciled itself.
    assert all(p.meta.get("reconciled") for p in ledger.transaction(book, move).postings)
    assert ledger.problems(book) == []
    assert re.search(r'2026-01-31 custom "statement" Assets:PNC +975.00 USD', ledger.export(book))


def test_only_asset_and_liability_nodes_are_divided_once(ledger, book):
    accounts = {a.name: a for a in ledger.accounts(book)}
    with pytest.raises(Exception, match="can be divided"):
        ledger.set_account(book, "Assets:PNC:General", models.AccountPatch(updated_at=accounts["Assets:PNC:General"].updated_at, divided=True))
    # An implicit node is opened to hold it; then nothing above or below it can take it.
    ledger.set_account(book, "Assets:Bank", models.AccountPatch(updated_at="", divided=True))
    bank = next(a for a in ledger.accounts(book) if a.name == "Assets:Bank")
    assert bank.divided and not bank.implicit
    ledger.create_account(book, models.AccountIn(name="Assets:Bank:Joint", kind="node"))
    joint = next(a for a in ledger.accounts(book) if a.name == "Assets:Bank:Joint")
    with pytest.raises(Exception, match="part of Assets:Bank"):
        ledger.set_account(book, "Assets:Bank:Joint", models.AccountPatch(updated_at=joint.updated_at, divided=True))
    # Undivided, its sub-accounts reconcile themselves again.
    ledger.set_account(book, "Assets:Bank", models.AccountPatch(updated_at=bank.updated_at, divided=False))
    assert reconcile.state(ledger, book, "Assets:Bank:Checking", None).account == "Assets:Bank:Checking"


def test_edits_keep_marks_and_a_broken_balance_shows(ledger, book):
    [lunch] = add(ledger, book, spend(D(2026, 1, 5), "-12.00"))
    account = "Assets:Bank:Checking"
    reconcile.reconcile(ledger, book, account, models.ReconcileIn(statement_date=D(2026, 1, 31), balance="-12.00", transactions=[lunch]))

    current = ledger.transaction(book, lunch)
    # The client's postings don't carry the mark (or try to clear it): the ledger keeps it.
    postings = [models.Posting(account=account, units=models.Amount(number="-12.40", currency="USD")), models.Posting(account="Expenses:Food")]
    ledger.patch_transaction(book, lunch, models.TransactionPatch(updated_at=current.updated_at, postings=postings))

    assert ledger.transaction(book, lunch).postings[0].meta["reconciled"] == models.MetaDate(date=D(2026, 1, 31))
    [last] = reconcile.history(ledger, book, account).reconciliations
    assert last.off_by == models.Amount(number="0.40", currency="USD")
    # A new transaction doesn't arrive reconciled, whatever it says.
    marked = spend(D(2026, 2, 1), "-1.00")
    marked.postings[0].meta["reconciled"] = models.MetaDate(date=D(2026, 1, 31))
    [new] = add(ledger, book, marked)
    assert "reconciled" not in ledger.transaction(book, new).postings[0].meta


def test_ledgers_filter_by_reconciliation(ledger, book):
    a, b = add(ledger, book, spend(D(2026, 1, 5), "-12.00"), spend(D(2026, 2, 5), "-8.00"))
    [food_only] = add(ledger, book, spend(D(2026, 2, 6), "-3.00", account="Expenses:Food", other="Income:Salary"))
    account = "Assets:Bank:Checking"
    reconcile.reconcile(ledger, book, account, models.ReconcileIn(statement_date=D(2026, 1, 31), balance="-12.00", transactions=[a]))

    yes = ledger.account_ledger(book, account, reconciled=True)
    no = ledger.account_ledger(book, account, reconciled=False)
    assert [r.id for r in yes.rows] == [a] and yes.rows[0].reconciled == D(2026, 1, 31)
    assert [r.id for r in no.rows] == [b] and no.rows[0].balance.number == "-20.00"  # the account's balance

    journal = {r.id: r.reconciled for r in ledger.journal(book).rows}
    assert journal == {a: True, b: False, food_only: None}
    assert [r.id for r in ledger.journal(book, reconciled=True).rows] == [a]
    assert [r.id for r in ledger.journal(book, reconciled=False).rows] == [b]


def test_day_balances_and_the_api(ledger, book):
    add(ledger, book, spend(D(2026, 1, 5), "-12.00"), spend(D(2026, 1, 5), "-3.00"), spend(D(2026, 1, 9), "100.00", other="Income:Salary"))
    client = http(ledger)
    url = f"/api/ledger/v1/books/{book}/accounts/Assets:Bank:Checking"

    days = client.get(f"{url}/balances", params={"from": "2026-01-06", "to": "2026-01-31"}).json()
    assert days["before"] == "-15.00" and days["days"] == [{"date": "2026-01-09", "balance": "85.00"}]

    state = client.get(f"{url}/reconciliation", params={"through": "2026-01-31"}).json()
    ids = [t["id"] for t in state["transactions"]]
    refused = client.post(f"{url}/reconciliations", json={"statement_date": "2026-01-31", "balance": "1.00", "transactions": ids})
    assert refused.status_code == 422
    done = client.post(f"{url}/reconciliations", json={"statement_date": "2026-01-31", "balance": "85.00", "transactions": ids})
    assert done.status_code == 201
    assert client.get(f"{url}/reconciliations").json()["reconciliations"][0]["statement_date"] == "2026-01-31"
    assert client.get(f"{url}/ledger", params={"reconciled": "false"}).json()["rows"] == []
    assert client.delete(f"{url}/reconciliations/2026-01-31").status_code == 204
    assert client.get(f"/api/ledger/v1/books/{book}/accounts/Expenses:Food/reconciliation").status_code == 422


def test_automatic_reconciliations_roll_forward_within_a_month(ledger, book):
    account = "Assets:Bank:Checking"
    a, b, c = add(ledger, book, spend(D(2026, 1, 5), "-12.00"), spend(D(2026, 1, 20), "-8.00"), spend(D(2026, 2, 3), "-5.00"))

    def bank(day, balance, ids):
        reconcile.reconcile(ledger, book, account, models.ReconcileIn(statement_date=day, balance=balance, transactions=ids, automatic=True))

    bank(D(2026, 1, 10), "-12.00", [a])
    bank(D(2026, 1, 25), "-20.00", [b])  # replaces the 10th's
    bank(D(2026, 2, 4), "-25.00", [c])  # a new month: a new one

    history = reconcile.history(ledger, book, account).reconciliations
    assert [(r.statement_date, r.automatic, r.transactions) for r in history] == [
        (D(2026, 2, 4), True, 1),
        (D(2026, 1, 25), True, 2),
    ]
    assert ledger.problems(book) == []

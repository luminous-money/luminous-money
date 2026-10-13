"""Opening balances, account summaries, balances from SQL, and account ledgers (M1, M2)."""

import datetime
from decimal import Decimal

import pytest
from conftest import USER, http

from ledger import engine, migrations, models

OPENING = 'option "operating_currency" "USD"\n2020-01-01 open Expenses:Food\n2020-01-01 open Income:Salary\n'


@pytest.fixture
def book(ledger):
    ledger.apply_text("book", OPENING, owner_id=USER)
    return ledger


def bank(ledger, name="Assets:Bank:PNC-Checking", balance="1000.00", as_of=datetime.date(2024, 1, 1)):
    """An account with an opening balance, summarized."""
    opening = models.OpeningBalance(amount=balance, date=as_of)
    ledger.create_account("book", models.AccountIn(name=name, opening_balance=opening))
    return summary(ledger, name)


def summary(ledger, name="Assets:Bank:PNC-Checking"):
    [found] = ledger.summary("book", [name])
    return found


def spend(ledger, account, amount, date="2024-01-10", flag="*", narration="Groceries", other="Expenses:Food"):
    return ledger.create_transaction(
        "book",
        models.TransactionIn(
            date=date,
            flag=flag,
            narration=narration,
            postings=[
                models.Posting(account=account, units=models.Amount(number=amount, currency="USD")),
                models.Posting(account=other),
            ],
        ),
    )


def test_an_opening_balance_opens_the_account_on_its_date_with_that_balance(book):
    account = bank(book)

    assert account.name == "Assets:Bank:PNC-Checking"
    assert (account.open, account.as_of) == (datetime.date(2024, 1, 1), datetime.date(2024, 1, 1))
    assert account.currencies == ["USD"]
    assert account.balance == [models.Amount(number="1000.00", currency="USD")]
    assert {a.name: a.kind for a in book.accounts("book")}["Assets:Bank"] == "node"
    assert "Equity:Opening-Balances" in {a.name for a in book.accounts("book") if not a.implicit}
    assert book.problems("book") == []

def test_a_zero_balance_still_gets_an_opening_transaction_to_date_it(book):
    account = bank(book, balance="0")

    assert [t.narration for t in book.transactions("book")] == ["Opening balance"]
    assert account.as_of == datetime.date(2024, 1, 1)
    assert sum(Decimal(b.number) for b in account.balance) == 0
    assert book.problems("book") == []


def _opening(ledger):
    return next(t for t in ledger.transactions("book") if t.narration == "Opening balance")


def test_moving_the_opening_balance_back_moves_the_account_open_and_its_as_of(book):
    bank(book)
    opening = _opening(book)

    book.patch_transaction("book", opening.id, models.TransactionPatch(date="2023-08-02", updated_at=opening.updated_at))

    account = summary(book)
    assert (account.open, account.as_of) == (datetime.date(2023, 8, 2), datetime.date(2023, 8, 2))
    assert book.problems("book") == []


def test_a_book_left_with_postings_before_an_open_is_put_right_by_the_next_write(ledger):
    ledger.apply_text(
        "book",
        """2024-01-10 open Assets:Cash
2024-01-01 open Expenses:Food
2024-01-05 * "Too early"
  Assets:Cash  -1.00 USD
  Expenses:Food
""",
        owner_id=USER,
    )
    assert ledger.problems("book")

    spend(ledger, "Assets:Cash", "-2.00", date="2024-01-20")

    assert {a.name: a.open for a in ledger.accounts("book")}["Assets:Cash"] == datetime.date(2024, 1, 5)
    assert ledger.problems("book") == []


def test_moving_the_opening_balance_forward_moves_the_as_of_but_not_the_open(book):
    bank(book)
    opening = _opening(book)

    book.patch_transaction("book", opening.id, models.TransactionPatch(date="2024-02-01", updated_at=opening.updated_at))

    account = summary(book)
    assert (account.open, account.as_of) == (datetime.date(2024, 1, 1), datetime.date(2024, 2, 1))


def test_any_posting_before_its_account_opens_moves_the_open_back_to_meet_it(book):
    account = bank(book).name
    book.create_account("book", models.AccountIn(name="Expenses:Coffee", kind="leaf", open=datetime.date(2024, 6, 1)))

    spend(book, account, "-3.00", date="2023-12-30", other="Expenses:Coffee")
    book.create_transactions(
        "book",
        [
            models.TransactionIn(
                date="2023-11-15",
                narration="Older",
                postings=[
                    models.Posting(account=account, units=models.Amount(number="-1.00", currency="USD")),
                    models.Posting(account="Expenses:Coffee"),
                ],
            )
        ],
    )

    opens = {a.name: a.open for a in book.accounts("book")}
    assert opens[account] == opens["Expenses:Coffee"] == datetime.date(2023, 11, 15)
    assert opens["Expenses:Food"] == datetime.date(2020, 1, 1)  # untouched: already open
    assert summary(book).as_of == datetime.date(2024, 1, 1)  # still the opening balance
    assert book.problems("book") == []


def test_any_account_can_have_an_opening_balance_but_only_a_leaf(book):
    card = bank(book, name="Liabilities:Cards:Chase", balance="-250.00")

    assert card.balance == [models.Amount(number="-250.00", currency="USD")]
    assert card.type == "liability"
    with pytest.raises(engine.ParseFailure):
        book.create_account(
            "book",
            models.AccountIn(
                name="Assets:Shared", kind="node", opening_balance=models.OpeningBalance(amount="1", date="2024-01-01")
            ),
        )

def test_an_account_without_an_opening_balance_has_no_as_of(book):
    book.create_account("book", models.AccountIn(name="Assets:Cash"))

    assert summary(book, "Assets:Cash").as_of is None
    assert summary(book, "Assets:Cash").balance == []

def test_summaries_are_of_the_accounts_asked_for_in_order(book):
    bank(book)
    book.create_account("book", models.AccountIn(name="Assets:Cash"))

    found = book.summary("book", ["Assets:Cash", "Assets:Nope", "Assets:Bank:PNC-Checking", "Assets:Cash"])

    assert [a.name for a in found] == ["Assets:Cash", "Assets:Bank:PNC-Checking"]

def test_balances_include_pending_and_fill_in_elided_amounts(book):
    account = bank(book).name
    spend(book, account, "-25.50")
    spend(book, account, "-4.50", flag="!")
    book.create_transaction(  # the bank side elided: filled in as 2000.00
        "book",
        models.TransactionIn(
            date="2024-01-15",
            flag="*",
            narration="Paycheck",
            postings=[
                models.Posting(account="Income:Salary", units=models.Amount(number="-2000.00", currency="USD")),
                models.Posting(account=account),
            ],
        ),
    )

    assert book.balance("book", account) == [models.Amount(number="2970.00", currency="USD")]


def test_amounts_only_booking_could_say_fall_back_to_beancount(book):
    assert engine.parse_one(
        '2024-01-01 * "x"\n  Assets:Brokerage  1 VTI {100 USD}\n  Assets:Cash\n'
    ).postings[1].amount is None  # behind a cost: left to booking

    book.create_account("book", models.AccountIn(name="Assets:Brokerage"))
    book.create_account("book", models.AccountIn(name="Assets:Cash"))
    book.create("book", '2024-02-01 * "Buy"\n  Assets:Brokerage  2 VTI {100 USD}\n  Assets:Cash\n')

    assert book.balance("book", "Assets:Cash") == [models.Amount(number="-200", currency="USD")]


def test_the_backfill_fills_in_amounts_payees_and_narrations_written_before_it(book):
    account = bank(book).name
    spend(book, account, "-25.50")
    conn = book.store._conn
    conn.execute("UPDATE posting SET amount = NULL, amount_currency = NULL")
    conn.execute("UPDATE directive SET payee = NULL, narration = NULL")

    migrations._backfill_derived_columns(conn)

    assert book.balance("book", account) == [models.Amount(number="974.50", currency="USD")]
    assert {r["narration"] for r in book.store.account_entries("book", account)} == {"Opening balance", "Groceries"}


def test_an_account_ledger_is_newest_first_with_running_balances(book):
    account = bank(book).name
    spend(book, account, "-25.50", date="2024-01-10")
    spend(book, account, "-4.50", date="2024-01-12", flag="!")
    book.create_transaction(
        "book",
        models.TransactionIn(
            date="2024-01-11",
            narration="Split",
            postings=[
                models.Posting(account=account, units=models.Amount(number="-30", currency="USD")),
                models.Posting(account="Expenses:Food", units=models.Amount(number="20", currency="USD")),
                models.Posting(account="Income:Salary", units=models.Amount(number="10", currency="USD")),
            ],
        ),
    )

    rows = book.account_ledger("book", account).rows

    assert [(str(r.date), r.amount.number, r.balance.number) for r in rows] == [
        ("2024-01-12", "-4.50", "940.00"),
        ("2024-01-11", "-30", "944.50"),
        ("2024-01-10", "-25.50", "974.50"),
        ("2024-01-01", "1000.00", "1000.00"),
    ]
    assert [r.counterpart for r in rows] == ["Expenses:Food", None, "Expenses:Food", "Equity:Opening-Balances"]
    assert [r.splits for r in rows] == [2, 3, 2, 2]
    assert rows[0].flag == "!"


def test_ledger_pages_are_stable_keyset_pages(book):
    account = bank(book).name
    for day in range(1, 11):
        spend(book, account, "-1", date=f"2024-02-{day:02d}")

    first = book.account_ledger("book", account, limit=4)
    spend(book, account, "-1", date="2024-03-01")  # newer: doesn't shift the next page
    second = book.account_ledger("book", account, cursor=first.next_cursor, limit=4)
    rest = book.account_ledger("book", account, cursor=second.next_cursor, limit=4)

    assert [str(r.date) for r in first.rows] == ["2024-02-10", "2024-02-09", "2024-02-08", "2024-02-07"]
    assert [str(r.date) for r in second.rows] == ["2024-02-06", "2024-02-05", "2024-02-04", "2024-02-03"]
    assert [str(r.date) for r in rest.rows] == ["2024-02-02", "2024-02-01", "2024-01-01"]
    assert rest.next_cursor is None


def test_batches_are_all_or_nothing(book):
    account = bank(book).name
    good = models.TransactionIn(date="2024-01-10", postings=[models.Posting(account=account, units=models.Amount(number="-1", currency="USD")), models.Posting(account="Expenses:Food")])
    bad = models.TransactionIn(date="2024-01-10", postings=[models.Posting(account="Assets:Bank", units=models.Amount(number="-1", currency="USD")), models.Posting(account="Expenses:Food")])

    with pytest.raises(engine.ParseFailure):
        book.create_transactions("book", [good, bad])  # Assets:Bank is a node
    created = book.create_transactions("book", [good, good])

    assert len(created) == 2
    assert len(book.account_ledger("book", account).rows) == 3


def test_opening_balances_summaries_and_ledgers_over_http(book):
    client = http(book)

    created = client.post(
        "/api/ledger/v1/books/book/accounts",
        json={"name": "Assets:Bank:PNC-Checking", "opening_balance": {"amount": "500.00", "date": "2024-01-01"}},
    )
    listed = client.get(
        "/api/ledger/v1/books/book/accounts/summary", params=[("account", "Assets:Bank:PNC-Checking")]
    ).json()
    page = client.get("/api/ledger/v1/books/book/accounts/Assets:Bank:PNC-Checking/ledger", params={"limit": 10}).json()

    assert created.status_code == 201
    assert [(a["name"], a["as_of"]) for a in listed] == [("Assets:Bank:PNC-Checking", "2024-01-01")]
    assert listed[0]["balance"] == [{"number": "500.00", "currency": "USD"}]
    assert page["rows"][0]["narration"] == "Opening balance"
    assert page["next_cursor"] is None

def test_segments_from_human_names():
    assert engine.segment("PNC checking") == "PNC-checking"
    assert engine.segment("joint  account #2") == "Joint-account-2"
    assert engine.segment("Café") == "Café"
    with pytest.raises(engine.ParseFailure):
        engine.segment("!!!")
    assert Decimal("1") == Decimal(engine.decimal_text(Decimal("1")))


def test_compact_transactions_are_the_window_oldest_first_with_amounts(book):
    account = bank(book).name
    spend(book, account, "-25.50", date="2024-02-01", narration="Groceries")
    spend(book, account, "-4.50", date="2024-03-01", flag="!", narration="Coffee")

    found = book.compact("book", datetime.date(2024, 2, 1))

    assert [(t.narration, t.flag) for t in found] == [("Groceries", "*"), ("Coffee", "!")]
    assert [(p.account, p.amount.number if p.amount else None) for p in found[1].postings] == [
        (account, "-4.50"),
        ("Expenses:Food", "4.50"),  # the elided side, filled in
    ]
    assert http(book).get("/api/ledger/v1/books/book/transactions/compact", params={"from": "2024-03-01"}).json()[0]["narration"] == "Coffee"

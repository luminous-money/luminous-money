"""The chart of accounts: leaves hold transactions, nodes hold sub-accounts."""

import datetime

import pytest
from conftest import FEATURES, STAGED
from fastapi.testclient import TestClient

from ledger import engine, models
from ledger.api import create_app

ROOTS = {"Assets": "asset", "Liabilities": "liability", "Equity": "equity", "Income": "income", "Expenses": "expense"}


@pytest.fixture
def book(ledger):
    ledger.apply_file("book", FEATURES)
    return ledger


def tree(ledger, book_id="book"):
    return {a.name: a for a in ledger.accounts(book_id)}


def create(ledger, name, kind="leaf", book_id="book", **extra):
    return ledger.create_account(book_id, models.AccountIn(name=name, kind=kind, **extra))


def test_a_new_book_has_the_five_top_level_nodes(ledger):
    ledger.create_book("empty")

    accounts = ledger.accounts("empty")

    assert {a.name: a.type for a in accounts} == ROOTS
    assert all(a.kind == "node" and a.implicit for a in accounts)


def test_opened_accounts_are_leaves_with_their_open_close_and_constraints(book):
    accounts = tree(book)

    assert accounts["Assets:Bank:Checking"].model_dump() == {
        "name": "Assets:Bank:Checking",
        "type": "asset",
        "kind": "leaf",
        "implicit": False,
        "open": datetime.date(2020, 1, 1),
        "close": None,
        "currencies": ["USD"],
    }
    assert accounts["Assets:Brokerage"].currencies == ["VTI", "USD"]
    assert accounts["Assets:Cash"].close == datetime.date(2020, 12, 31)


def test_unopened_parents_are_implicit_nodes(book):
    bank = tree(book)["Assets:Bank"]

    assert (bank.kind, bank.implicit, bank.type, bank.open) == ("node", True, "asset", None)


def test_creating_a_leaf_under_an_implicit_parent(book):
    account = create(book, "Assets:Bank:Savings")

    assert (account.kind, account.type, account.implicit) == ("leaf", "asset", False)
    assert account.open == datetime.date(2020, 1, 1)  # the earliest account under Assets:Bank
    assert book.problems("book") == []


def test_creating_a_node_and_then_accounts_under_it(book):
    node = create(book, "Expenses:Utilities", kind="node")
    leaf = create(book, "Expenses:Utilities:Power")

    assert node.kind == "node"
    assert leaf.open == node.open
    assert 'kind: "node"' in book.export("book")


def test_a_new_books_first_accounts_open_today(ledger):
    ledger.create_book("empty")

    account = create(ledger, "Assets:Cash", book_id="empty")

    assert account.open == datetime.date.today()


def test_an_explicit_open_date_wins(book):
    assert create(book, "Assets:Bank:Savings", open=datetime.date(2019, 6, 1)).open == datetime.date(2019, 6, 1)


@pytest.mark.parametrize(
    "name, kind, message",
    [
        ("Expenses:Food:Snacks", "leaf", "Expenses:Food is a leaf account and can't have sub-accounts"),
        ("Expenses:Nowhere:Thing", "leaf", "there's no Expenses:Nowhere account"),
        ("Assets", "node", "top-level accounts are built in"),
        ("Assets:Bank", "leaf", "already has sub-accounts, so it can only be a node"),
        ("Assets:Cash:Coins", "leaf", "Assets:Cash is a leaf account"),
        ("Expenses:lowercase", "leaf", "Invalid token"),
    ],
)
def test_account_rules(book, name, kind, message):
    with pytest.raises(engine.ParseFailure) as failure:
        create(book, name, kind=kind)

    assert message in str(failure.value)


def test_an_existing_account_cant_be_created_again(book):
    with pytest.raises(ValueError):
        create(book, "Expenses:Travel")


def test_an_implicit_parent_can_be_opened_as_a_node(book):
    assert create(book, "Assets:Bank", kind="node").implicit is False


def test_writes_that_post_to_a_node_are_refused(book):
    create(book, "Expenses:Utilities", kind="node")
    to_node = STAGED.replace("Expenses:Food", "Expenses:Utilities")
    implicit = STAGED.replace("Expenses:Food", "Assets:Bank")

    for text in (to_node, implicit):
        with pytest.raises(engine.ParseFailure) as failure:
            book.create("book", text)
        assert "is a node account and can't hold transactions" in str(failure.value)

    with pytest.raises(engine.ParseFailure):
        book.create_transaction(
            "book",
            models.TransactionIn(
                date=datetime.date(2024, 3, 1),
                postings=[{"account": "Expenses:Utilities", "units": {"number": "1", "currency": "USD"}}, {"account": "Assets:Bank:Checking"}],
            ),
        )


def test_imported_postings_to_a_node_are_flagged_as_problems(book):
    create(book, "Expenses:Utilities", kind="node")

    book.apply_text("book", STAGED.replace("Expenses:Food", "Expenses:Utilities"))

    assert [p.message.split(": ", 1)[-1] for p in book.problems("book")] == [
        engine.node_posting_message("Expenses:Utilities")
    ]


def test_accounts_over_http(book):
    client = TestClient(create_app(book))

    created = client.post("/api/ledger/v1/books/book/accounts", json={"name": "Expenses:Travel:Hotels"})
    assert created.status_code == 422  # Expenses:Travel is a leaf

    created = client.post("/api/ledger/v1/books/book/accounts", json={"name": "Assets:Bank:Savings"})
    assert created.status_code == 201
    assert created.json()["kind"] == "leaf"
    assert client.post("/api/ledger/v1/books/book/accounts", json={"name": "Assets:Bank:Savings"}).status_code == 409
    assert "Assets:Bank:Savings" in [a["name"] for a in client.get("/api/ledger/v1/books/book/accounts").json()]

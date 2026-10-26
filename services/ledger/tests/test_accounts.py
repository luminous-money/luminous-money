"""The chart of accounts: leaves hold transactions, nodes hold sub-accounts."""

import datetime

import pytest
from conftest import FEATURES, STAGED, USER, http

from ledger import engine, models

ROOTS = {"Assets": "asset", "Liabilities": "liability", "Equity": "equity", "Income": "income", "Expenses": "expense"}


@pytest.fixture
def book(ledger):
    ledger.apply_file("book", FEATURES, owner_id=USER)
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

    assert accounts["Assets:Bank:Checking"].model_dump(exclude={"updated_at"}) == {
        "name": "Assets:Bank:Checking",
        "type": "asset",
        "kind": "leaf",
        "implicit": False,
        "open": datetime.date(2020, 1, 1),
        "close": None,
        "currencies": ["USD"],
        "display_name": None,
        "description": None,
        "booking": None,
        "revalue_every": None,
        "divided": False,
        "main_part": None,
        "cards": [],
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
        ("Expenses:Food:Snacks:Chips", "leaf", "Expenses:Food is a leaf account"),  # at any depth
        ("Assets", "node", "top-level accounts are built in"),
        ("Stuff:Things", "leaf", "account names start with one of Assets"),
        ("Assets:Bank", "leaf", "already has sub-accounts, so it can only be a node"),
        ("Assets:Cash:Coins", "leaf", "Assets:Cash is a leaf account"),
        ("Expenses:lowercase", "leaf", "Invalid token"),
    ],
)
def test_account_rules(book, name, kind, message):
    with pytest.raises(engine.ParseFailure) as failure:
        create(book, name, kind=kind)

    assert message in str(failure.value)


def test_missing_levels_in_between_are_opened_as_nodes(book):
    account = create(book, "Expenses:Home:Garden:Tools")

    accounts = tree(book)
    assert account.kind == "leaf"
    for name in ("Expenses:Home", "Expenses:Home:Garden"):
        assert (accounts[name].kind, accounts[name].implicit, accounts[name].open) == ("node", False, account.open)
    assert book.problems("book") == []


def test_implicit_parents_on_the_way_stay_implicit(book):
    create(book, "Assets:Bank:Savings:Emergency")

    accounts = tree(book)
    assert accounts["Assets:Bank"].implicit  # existed (implicitly) already
    assert (accounts["Assets:Bank:Savings"].kind, accounts["Assets:Bank:Savings"].implicit) == ("node", False)


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
    client = http(book)

    created = client.post("/api/ledger/v1/books/book/accounts", json={"name": "Expenses:Travel:Hotels"})
    assert created.status_code == 422  # Expenses:Travel is a leaf

    created = client.post("/api/ledger/v1/books/book/accounts", json={"name": "Assets:Bank:Savings"})
    assert created.status_code == 201
    assert created.json()["kind"] == "leaf"
    assert client.post("/api/ledger/v1/books/book/accounts", json={"name": "Assets:Bank:Savings"}).status_code == 409
    assert "Assets:Bank:Savings" in [a["name"] for a in client.get("/api/ledger/v1/books/book/accounts").json()]


def test_a_chart_opens_in_one_write_in_order(book):
    opening = models.OpeningBalance(amount="-420.00", date=datetime.date(2024, 1, 31))
    batch = [
        models.AccountIn(name="Expenses:Dining", kind="node", description="Eating out"),
        models.AccountIn(name="Expenses:Dining:Coffee-Shops", display_name="Coffee"),
        models.AccountIn(name="Liabilities:Cards:Visa", opening_balance=opening),
    ]

    created = book.create_accounts("book", batch)

    assert [a.name for a in created] == [a.name for a in batch]
    accounts = tree(book)
    assert accounts["Expenses:Dining"].kind == "node" and accounts["Expenses:Dining"].description == "Eating out"
    assert accounts["Expenses:Dining:Coffee-Shops"].display_name == "Coffee"
    assert accounts["Liabilities:Cards"].kind == "node"  # opened on the way, as one at a time would
    [visa] = book.summary("book", ["Liabilities:Cards:Visa"])
    assert visa.balance == [models.Amount(number="-420.00", currency="USD")]
    assert visa.as_of == datetime.date(2024, 1, 31)


def test_a_chart_is_all_or_nothing_and_names_the_account_refused(book):
    batch = [
        models.AccountIn(name="Expenses:Pets:Food"),
        models.AccountIn(name="Expenses:Pets:Food:Treats"),  # under a leaf the batch just opened
    ]

    with pytest.raises(engine.ParseFailure, match="^Expenses:Pets:Food:Treats: Expenses:Pets:Food is a leaf"):
        book.create_accounts("book", batch)

    assert "Expenses:Pets:Food" not in tree(book) and "Expenses:Pets" not in tree(book)


def test_a_chart_can_name_the_opening_balances_account_before_balances_use_it(ledger):
    ledger.create_book("empty", owner_id=USER)
    opening = models.OpeningBalance(amount="100.00", date=datetime.date(2024, 1, 31))
    ledger.create_accounts(
        "empty",
        [models.AccountIn(name="Equity:Opening-Balances"), models.AccountIn(name="Assets:Cash", opening_balance=opening)],
    )

    assert {"Equity:Opening-Balances", "Assets:Cash"} <= set(tree(ledger, "empty"))


def test_descriptions_are_one_line_and_patched_like_display_names(book):
    created = create(book, "Assets:Bank:Savings", description="  Rainy day\n fund  ")
    assert created.description == "Rainy day fund"

    patched = book.set_account(
        "book", "Assets:Bank:Savings", models.AccountPatch(updated_at=created.updated_at, description="Emergencies")
    )
    assert patched.description == "Emergencies"
    renamed = book.set_account("book", "Assets:Bank:Savings", models.AccountPatch(updated_at=patched.updated_at, display_name="Savings"))
    assert renamed.description == "Emergencies"  # untouched when not sent
    cleared = book.set_account("book", "Assets:Bank:Savings", models.AccountPatch(updated_at=renamed.updated_at, description=""))
    assert cleared.description is None


def test_charts_over_http(book):
    client = http(book)
    url = "/api/ledger/v1/books/book/accounts/batch"

    created = client.post(url, json=[{"name": "Expenses:Kids", "kind": "node"}, {"name": "Expenses:Kids:Toys", "description": "Fun"}])
    assert created.status_code == 201
    assert [(a["name"], a["kind"], a["description"]) for a in created.json()] == [
        ("Expenses:Kids", "node", None),
        ("Expenses:Kids:Toys", "leaf", "Fun"),
    ]
    again = client.post(url, json=[{"name": "Expenses:Books"}, {"name": "Expenses:Kids:Toys"}])
    assert again.status_code == 409 and "Expenses:Kids:Toys already exists" in again.json()["detail"]
    assert "Expenses:Books" not in tree(book)

import datetime

import pytest
from conftest import FEATURES, STAGED

from ledger import engine
from ledger.service import NotFound


@pytest.fixture
def book(ledger):
    ledger.apply_file("book", FEATURES)
    return ledger


def test_staged_transaction_lands_in_the_review_queue_and_confirms(book):
    created = book.create("book", STAGED)

    queue = book.store.find("book", flag="!")
    assert created.id in [r.id for r in queue]

    confirmed = book.set_flag("book", created.id, "*")

    assert confirmed.id == created.id
    assert confirmed.text.startswith('2024-03-01 * "Corner Cafe"')
    assert created.id not in [r.id for r in book.store.find("book", flag="!")]
    assert book.problems("book") == []


def test_validation_problems_point_at_the_offending_directive(book):
    unbalanced = book.create("book", '2024-03-02 * "Typo"\n  Expenses:Food  5 USD\n  Assets:Bank:Checking  -4 USD\n')

    problems = book.problems("book")

    assert [p.directive_id for p in problems] == [unbalanced.id]


def test_problems_are_recomputed_after_a_change(book):
    unbalanced = book.create("book", '2024-03-02 * "Typo"\n  Expenses:Food  5 USD\n  Assets:Bank:Checking  -4 USD\n')
    assert book.problems("book")

    book.delete("book", unbalanced.id)

    assert book.problems("book") == []


def test_update_keeps_identity_and_position(book):
    created = book.create("book", STAGED)
    before = book.store.get("book", created.id)

    updated = book.update("book", created.id, STAGED.replace("4.50", "5.25"))

    after = book.store.get("book", created.id)
    assert updated.id == created.id
    assert after.ordinal == before.ordinal
    assert "5.25 USD" in after.text


def test_update_rejects_a_conflicting_id(book):
    created = book.create("book", STAGED)
    conflicting = STAGED.replace('"Coffee"\n', '"Coffee"\n  id: "someone-else"\n')

    with pytest.raises(engine.ParseFailure):
        book.update("book", created.id, conflicting)


@pytest.mark.parametrize(
    "text",
    [
        STAGED + "\n" + STAGED,  # two directives
        'option "title" "x"\n' + STAGED,  # options belong to the book, not a directive
        "2024-03-01 * oops\n",  # syntax error
    ],
)
def test_writes_must_be_exactly_one_well_formed_directive(book, text):
    with pytest.raises(engine.ParseFailure):
        book.create("book", text)


def test_deleted_directives_disappear_everywhere(book):
    created = book.create("book", STAGED)

    book.delete("book", created.id)

    with pytest.raises(NotFound):
        book.get("book", created.id)
    assert created.id not in book.export("book")
    assert created.id not in [r.id for r in book.store.find("book")]


def test_find_filters_by_account_subtree_and_dates(book):
    rows = book.store.find(
        "book",
        account="Assets:Bank",
        date_from=datetime.date(2020, 6, 1),
        date_to=datetime.date(2020, 6, 2),
    )

    assert [r.date for r in rows] == ["2020-06-01", "2020-06-02", "2020-06-02", "2020-06-02"]


def test_bql_runs_over_the_booked_book(book):
    columns, rows = book.query("book", "SELECT account, sum(position) WHERE account ~ 'Brokerage' GROUP BY account")

    assert columns == ["account", "sum(position)"]
    assert rows == [["Assets:Brokerage", ["5 VTI {200.00 USD, 2020-02-01}", '10 VTI {210.00 USD, 2020-03-01, "lot-2"}']]]


def test_text_imports_refuse_includes(ledger):
    with pytest.raises(engine.ParseFailure):
        ledger.apply_text("book", 'include "other.beancount"\n')

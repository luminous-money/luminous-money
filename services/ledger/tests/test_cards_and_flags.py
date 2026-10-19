"""Payment cards on accounts, and split flags (M16's second pass)."""

import datetime

import pytest

from ledger import chart, engine, models, reconcile
from test_reconcile import add, book, spend  # noqa: F401 (book is a fixture)

D = datetime.date
usd = lambda n: models.Amount(number=n, currency="USD")  # noqa: E731


def version(ledger, book, name):
    return next(a for a in ledger.accounts(book) if a.name == name).updated_at


def set_cards(ledger, book, name, cards):
    patch = models.AccountPatch(updated_at=version(ledger, book, name), cards=[models.Card(**c) for c in cards])
    return ledger.set_account(book, name, patch)


def test_an_account_lists_its_cards_and_a_card_is_one_accounts(ledger, book):
    card = set_cards(ledger, book, "Liabilities:Card", [{"brand": "visa", "last_four": "9499"}, {"last_four": "0417"}])

    assert [(c.brand, c.last_four) for c in card.cards] == [("visa", "9499"), (None, "0417")]
    assert 'cards: "visa 9499, 0417"' in ledger.export(book)
    with pytest.raises(engine.ParseFailure, match="Liabilities:Card's already"):
        set_cards(ledger, book, "Assets:Bank:Checking", [{"brand": "visa", "last_four": "0417"}])
    with pytest.raises(engine.ParseFailure, match="listed twice"):
        set_cards(ledger, book, "Assets:Bank:Checking", [{"last_four": "1111"}, {"brand": "amex", "last_four": "1111"}])
    # Another brand with the same digits is another card.
    set_cards(ledger, book, "Assets:Bank:Checking", [{"brand": "mastercard", "last_four": "9499"}])
    with pytest.raises(engine.ParseFailure, match="asset or liability"):
        set_cards(ledger, book, "Expenses:Food", [{"last_four": "2222"}])
    assert set_cards(ledger, book, "Liabilities:Card", []).cards == []


def test_a_divided_accounts_cards_are_the_wholes(ledger, book):
    # Dividing keeps them with the real account; its parts can't have their own.
    set_cards(ledger, book, "Assets:Bank:Checking", [{"brand": "visa", "last_four": "4242"}])
    chart.divide(
        ledger,
        book,
        "Assets:Bank:Checking",
        models.DivideIn(parts=[models.DividePart(name="Padding", amount="0")], date=D(2026, 2, 1), updated_at=version(ledger, book, "Assets:Bank:Checking")),
    )
    accounts = {a.name: a for a in ledger.accounts(book)}
    assert [c.last_four for c in accounts["Assets:Bank:Checking"].cards] == ["4242"]
    assert accounts["Assets:Bank:Checking:General"].cards == []
    with pytest.raises(engine.ParseFailure, match="its cards go on Assets:Bank:Checking"):
        set_cards(ledger, book, "Assets:Bank:Checking:General", [{"last_four": "5555"}])


def staged(memo=None):
    return models.TransactionIn(
        date=D(2026, 1, 24),
        flag="!",
        payee="Jewel Osco",
        postings=[
            models.Posting(account="Liabilities:Card", units=usd("-9.99")),
            models.Posting(account="Expenses:Food", units=usd("9.99"), flag="!", meta={"memo": memo} if memo else {}),
        ],
    )


def test_confirming_a_transaction_confirms_its_splits_by_any_route(ledger, book):
    first, second, third = add(ledger, book, staged("Eggs Hppy 18"), staged(), staged())
    assert ledger.transaction(book, first).postings[1].flag == "!"

    t = ledger.transaction(book, first)
    ledger.patch_transaction(book, first, models.TransactionPatch(updated_at=t.updated_at, flag="*"))
    ledger.set_flag(book, second, "*")
    reconcile.reconcile(
        ledger,
        book,
        "Liabilities:Card",
        models.ReconcileIn(statement_date=D(2026, 1, 31), balance="-9.99", transactions=[third]),
    )

    for id_ in (first, second, third):
        t = ledger.transaction(book, id_)
        assert t.flag == "*" and [p.flag for p in t.postings] == [None, None], id_
    # Created confirmed, a split's flag is dropped too.
    [made] = add(ledger, book, staged().model_copy(update={"flag": "*"}))
    assert ledger.transaction(book, made).postings[1].flag is None
    # The memo stays.
    assert ledger.transaction(book, first).postings[1].meta["memo"] == "Eggs Hppy 18"


def test_text_keeps_what_it_says_and_the_compact_history_carries_flags_and_memos(ledger, book):
    [kept] = add(ledger, book, staged("Milk Frd Org Gal"))
    text = ledger.get(book, kept).text
    imported = ledger.create(book, text.replace(f'id: "{kept}"', 'id: "imported"').replace(" ! ", " * ", 1))
    assert ledger.transaction(book, imported.id).postings[1].flag == "!"

    [compact] = [t for t in ledger.compact(book, D(2026, 1, 1)) if t.id == kept]
    assert [(p.flag, p.memo) for p in compact.postings] == [(None, None), ("!", "Milk Frd Org Gal")]

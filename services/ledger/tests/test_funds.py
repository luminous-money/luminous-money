"""Funds (Funds A): fund lines on transactions, moves between funds, and the funds' own ledger."""

import datetime
import sqlite3

import pytest

from conftest import USER, http
from ledger import fundlines, funds, migrations, models
from ledger.fundlines import FundRefused

D = datetime.date
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank:PNC USD
2026-01-01 open Assets:Brokerage:Cash USD
2026-01-01 open Assets:Brokerage:VTI
2026-01-01 open Liabilities:Card USD
2026-01-01 open Income:Salary
2026-01-01 open Expenses:Home
2026-01-01 open Expenses:Food
2026-01-01 open Equity:Opening-Balances
2026-01-01 * "Opening balance"
  Assets:Bank:PNC  10000.00 USD
  Equity:Opening-Balances
"""


def usd(number: str) -> models.Amount:
    return models.Amount(number=number, currency="USD")


def line(fund: str, number: str) -> models.FundLine:
    return models.FundLine(fund=fund, amount=usd(number))


def txn(day, postings, lines=(), narration="", payee=None):
    return models.TransactionIn(
        date=day,
        flag="*",
        payee=payee,
        narration=narration,
        funds=list(lines) or None,
        postings=[models.Posting(account=a, units=usd(n) if n else None) for a, n in postings],
    )


def transfer(amount, lines=(), frm="Assets:Bank:PNC", to="Assets:Brokerage:Cash", day=D(2026, 2, 1)):
    return txn(day, [(frm, f"-{amount}"), (to, amount)], lines, "Transfer")


def spend(amount, lines=(), account="Assets:Bank:PNC", other="Expenses:Home", day=D(2026, 2, 2)):
    return txn(day, [(account, f"-{amount}"), (other, None)], lines, "Repair")


def pay(amount, lines=(), day=D(2026, 2, 3)):
    return txn(day, [("Assets:Bank:PNC", amount), ("Income:Salary", None)], lines, "Paycheck", "Acme")


@pytest.fixture
def book(ledger):
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    for name in ("Emergency", "Special Home Maintenance", "Wedding"):
        funds.create(ledger, book, models.FundIn(name=name))
    return book


def add(ledger, book, *transactions):
    return [d.id for d in ledger.create_transactions(book, list(transactions))]


def balances(ledger, book):
    listing = funds.listing(ledger, book)
    return {f.name: f.value.number for f in listing.funds} | {"Unallocated": listing.unallocated.number}


def test_kaels_four_examples(ledger, book):
    # Transfer $2,000 from PNC to the brokerage, for Emergency.
    add(ledger, book, transfer("2000.00", [line("Emergency", "2000.00")]))
    assert balances(ledger, book) == {
        "Emergency": "2000.00",
        "Special Home Maintenance": "0.00",
        "Wedding": "0.00",
        "Unallocated": "8000.00",
    }

    # Spend $500 from PNC on home maintenance, from Emergency.
    add(ledger, book, spend("500.00", [line("Emergency", "-500.00")]))
    assert balances(ledger, book)["Emergency"] == "1500.00"
    assert balances(ledger, book)["Unallocated"] == "8000.00"  # the spending came out of Emergency

    # $1,000 of income: $500 for Emergency, $500 for Special Home Maintenance.
    add(ledger, book, pay("1000.00", [line("Emergency", "500.00"), line("Special Home Maintenance", "500.00")]))
    assert balances(ledger, book) == {
        "Emergency": "2000.00",
        "Special Home Maintenance": "500.00",
        "Wedding": "0.00",
        "Unallocated": "8000.00",
    }

    # A move between funds, from the Funds menu.
    funds.create_move(
        ledger, book, models.FundMoveIn(date=D(2026, 2, 4), from_fund="Emergency", to_fund="Wedding", amount=usd("250.00"))
    )
    assert balances(ledger, book)["Emergency"] == "1750.00"
    assert balances(ledger, book)["Wedding"] == "250.00"
    assert funds.listing(ledger, book).net_worth.number == "10500.00"


def test_untagged_money_is_unallocated(ledger, book):
    add(ledger, book, pay("1000.00"), spend("300.00"), transfer("2000.00"))
    assert balances(ledger, book)["Unallocated"] == "10700.00"
    assert {v for k, v in balances(ledger, book).items() if k != "Unallocated"} == {"0.00"}


def test_lines_live_in_the_books_and_survive_an_export(ledger, book):
    add(ledger, book, pay("1000.00", [line("Emergency", "500.00"), line("Special Home Maintenance", "500.00")]))
    funds.create_move(
        ledger, book, models.FundMoveIn(date=D(2026, 2, 4), from_fund="Unallocated", to_fund="Wedding", amount=usd("50.00"), note="Setting up")
    )
    text = ledger.export(book)
    assert 'funds: "Emergency +500.00 USD; Special Home Maintenance +500.00 USD"' in text
    assert 'custom "fund" "Special Home Maintenance"' in text
    assert 'custom "fund-move" "Unallocated" "Wedding" 50.00 USD' in text
    assert 'note: "Setting up"' in text

    copy = ledger.create_book(name="Copy", owner_id=USER, text=text).id
    assert balances(ledger, copy) == balances(ledger, book)
    [paycheck] = [t for t in ledger.transactions(copy) if t.narration == "Paycheck"]
    assert [(f.fund, f.amount.number) for f in paycheck.funds] == [("Emergency", "500.00"), ("Special Home Maintenance", "500.00")]
    assert "funds" not in paycheck.meta


def test_rows_carry_their_lines(ledger, book):
    [paycheck] = add(ledger, book, pay("1000.00", [line("Emergency", "400.00")]))
    assert [(f.fund, f.amount.number) for f in ledger.journal(book).rows[0].funds] == [("Emergency", "400.00")]
    rows = ledger.account_ledger(book, "Assets:Bank:PNC").rows
    assert [f.fund for f in rows[0].funds] == ["Emergency"] and rows[0].id == paycheck
    [compact] = [t for t in ledger.compact(book, None) if t.id == paycheck]
    assert [f.amount.number for f in compact.funds] == ["400.00"]


@pytest.mark.parametrize(
    "transaction, problem",
    [
        (pay("1000.00", [line("Emergency", "-100.00")]), "money coming in goes to funds, not from them (Emergency)"),
        (spend("100.00", [line("Emergency", "100.00")]), "money going out comes from funds, not to them (Emergency)"),
        (pay("1000.00", [line("Emergency", "600.00"), line("Wedding", "600.00")]), "its funds get 1,200.00 USD, more than the 1,000.00 USD that came in"),
        (spend("100.00", [line("Emergency", "-100.01")]), "its funds give 100.01 USD, more than the 100.00 USD that went out"),
        (transfer("50.00", [line("Emergency", "60.00")]), "its funds get 60.00 USD, more than the 50.00 USD it moves"),
        (transfer("50.00", [line("Emergency", "-60.00")]), "its funds give 60.00 USD, more than the 50.00 USD it moves"),
        (pay("10.00", [line("Nowhere", "5.00")]), "there's no fund called Nowhere"),
        (pay("10.00", [line("unallocated", "5.00")]), "Unallocated isn't a fund to choose: it's what isn't in one"),
        (pay("10.00", [line("Emergency", "5.00"), line("emergency", "1.00")]), "Emergency is in it twice"),
        (pay("10.00", [line("Emergency", "0.00")]), "Emergency's amount can't be 0"),
        (pay("10.00", [models.FundLine(fund="Emergency", amount=models.Amount(number="5", currency="EUR"))]), "funds hold USD for now"),
    ],
)
def test_lines_that_dont_fit_are_refused(ledger, book, transaction, problem):
    with pytest.raises(FundRefused) as refused:
        add(ledger, book, transaction)
    assert str(refused.value) == problem


def test_a_transfer_can_take_from_one_fund_for_another(ledger, book):
    add(ledger, book, pay("1000.00", [line("Emergency", "1000.00")]))
    add(ledger, book, transfer("300.00", [line("Emergency", "-300.00"), line("Wedding", "300.00")]))
    assert balances(ledger, book)["Emergency"] == "700.00"
    assert balances(ledger, book)["Wedding"] == "300.00"
    # Taking alone sends it back to Unallocated.
    add(ledger, book, transfer("200.00", [line("Emergency", "-200.00")]))
    assert balances(ledger, book)["Emergency"] == "500.00"


def test_lines_are_named_as_their_funds_are(ledger, book):
    [t] = add(ledger, book, pay("100.00", [line("  special   home maintenance ", "100.00")]))
    assert ledger.transaction(book, t).funds[0].fund == "Special Home Maintenance"


def test_a_fund_can_go_below_zero(ledger, book):
    add(ledger, book, spend("120.00", [line("Wedding", "-120.00")]))
    assert balances(ledger, book)["Wedding"] == "-120.00"


def test_kinds_come_from_the_change_in_net_worth(ledger, book):
    # A refund is money in: it can go back to the fund that paid.
    refund = txn(D(2026, 2, 5), [("Assets:Bank:PNC", "40.00"), ("Expenses:Home", "-40.00")], [line("Special Home Maintenance", "40.00")])
    # A trade is a transfer: for a fund.
    buy = models.TransactionIn(
        date=D(2026, 2, 6),
        flag="*",
        funds=[line("Wedding", "3000.00")],
        postings=[
            models.Posting(account="Assets:Brokerage:Cash", units=usd("-3000.00")),
            models.Posting(
                account="Assets:Brokerage:VTI",
                units=models.Amount(number="10", currency="VTI"),
                cost=models.Cost(number="300.00", currency="USD"),
            ),
        ],
    )
    # Paying a card is a transfer.
    card = txn(D(2026, 2, 7), [("Assets:Bank:PNC", "-80.00"), ("Liabilities:Card", "80.00")], [line("Emergency", "80.00")])
    add(ledger, book, refund, buy, card)
    with pytest.raises(FundRefused):
        add(ledger, book, txn(D(2026, 2, 7), [("Assets:Bank:PNC", "-80.00"), ("Liabilities:Card", "80.00")], [line("Emergency", "81.00")]))


def test_only_changed_lines_are_checked(ledger, book):
    [t] = add(ledger, book, transfer("100.00", [line("Emergency", "100.00")]))
    current = ledger.transaction(book, t)
    # Recategorized as spending, with its line kept: not checked, so not refused.
    ledger.patch_transaction(
        book,
        t,
        models.TransactionPatch(
            updated_at=current.updated_at,
            postings=[models.Posting(account="Assets:Bank:PNC", units=usd("-100.00")), models.Posting(account="Expenses:Food")],
        ),
    )
    assert ledger.transaction(book, t).funds[0].fund == "Emergency"
    # Changing the lines checks them.
    version = ledger.transaction(book, t).updated_at
    with pytest.raises(FundRefused):
        ledger.patch_transaction(book, t, models.TransactionPatch(updated_at=version, funds=[line("Emergency", "50.00")]))
    ledger.patch_transaction(book, t, models.TransactionPatch(updated_at=version, funds=[]))
    assert ledger.transaction(book, t).funds is None


def test_an_archived_fund_takes_no_new_lines_but_keeps_its_own(ledger, book):
    [t] = add(ledger, book, pay("100.00", [line("Wedding", "100.00")]))
    wedding = funds.get(ledger, book, "Wedding")
    funds.archive(ledger, book, "Wedding", models.FundArchive(updated_at=wedding.updated_at, date=D(2026, 3, 1)))
    with pytest.raises(FundRefused, match="Wedding is archived"):
        add(ledger, book, pay("50.00", [line("Wedding", "50.00")]))
    version = ledger.transaction(book, t).updated_at
    ledger.patch_transaction(book, t, models.TransactionPatch(updated_at=version, funds=[line("Wedding", "60.00")]))


def test_archiving_moves_whats_left(ledger, book):
    add(ledger, book, pay("1000.00", [line("Wedding", "700.00"), line("Emergency", "300.00")]))
    wedding = funds.get(ledger, book, "Wedding")
    with pytest.raises(FundRefused, match="has entries up to 2026-02-03"):
        funds.archive(ledger, book, "Wedding", models.FundArchive(updated_at=wedding.updated_at, date=D(2026, 2, 1)))
    archived = funds.archive(
        ledger, book, "Wedding", models.FundArchive(updated_at=wedding.updated_at, date=D(2026, 3, 1), to="emergency")
    )
    assert archived.archived == D(2026, 3, 1) and archived.value.number == "0.00"
    assert balances(ledger, book)["Emergency"] == "1000.00"
    assert [f.name for f in funds.listing(ledger, book).funds][-1] == "Wedding"  # archived ones last
    entry = funds.history(ledger, book, "Wedding").entries[0]
    assert (entry.kind, entry.other, entry.note, entry.amount.number) == ("move", "Emergency", "Archived", "-700.00")

    back = funds.unarchive(ledger, book, "Wedding", models.FundVersion(updated_at=archived.updated_at))
    assert back.archived is None


def test_renaming_rewrites_every_line_and_move(ledger, book):
    [t] = add(ledger, book, pay("100.00", [line("Wedding", "100.00")]))
    move = funds.create_move(
        ledger, book, models.FundMoveIn(date=D(2026, 3, 1), from_fund="Wedding", to_fund="Emergency", amount=usd("40.00"))
    )
    wedding = funds.get(ledger, book, "Wedding")
    with pytest.raises(FundRefused, match="there's a fund called Emergency already"):
        funds.rename(ledger, book, "Wedding", models.FundRename(to="EMERGENCY", updated_at=wedding.updated_at))
    funds.rename(ledger, book, "Wedding", models.FundRename(to="The Wedding", updated_at=wedding.updated_at))

    assert ledger.transaction(book, t).funds[0].fund == "The Wedding"
    assert funds.history(ledger, book, "Emergency").entries[0].other == "The Wedding"
    assert balances(ledger, book)["The Wedding"] == "60.00"
    assert "Wedding" not in balances(ledger, book)
    assert funds.history(ledger, book, "The Wedding").entries[0].id == move.id
    # A change of case alone is a rename too.
    renamed = funds.get(ledger, book, "the wedding")
    funds.rename(ledger, book, "The Wedding", models.FundRename(to="the wedding", updated_at=renamed.updated_at))
    assert ledger.transaction(book, t).funds[0].fund == "the wedding"


def test_only_a_fund_with_no_history_is_deleted(ledger, book):
    add(ledger, book, pay("100.00", [line("Wedding", "100.00")]))
    with pytest.raises(FundRefused, match="Wedding has history: archive it instead"):
        funds.delete(ledger, book, "Wedding", funds.get(ledger, book, "Wedding").updated_at)
    funds.delete(ledger, book, "Emergency", funds.get(ledger, book, "Emergency").updated_at)
    assert "Emergency" not in balances(ledger, book)


def test_a_funds_history_runs_newest_first(ledger, book):
    add(ledger, book, pay("1000.00", [line("Emergency", "1000.00")]))
    add(ledger, book, spend("150.00", [line("Emergency", "-150.00")]))
    funds.create_move(
        ledger, book, models.FundMoveIn(date=D(2026, 3, 1), from_fund="Emergency", to_fund="Unallocated", amount=usd("50.00"), note="Too much")
    )
    history = funds.history(ledger, book, "emergency")
    assert history.fund.name == "Emergency"
    # Dated: the repair (Feb 2) before the paycheck (Feb 3), so Emergency dipped below zero first.
    assert [(e.kind, e.amount.number, e.balance.number) for e in history.entries] == [
        ("move", "-50.00", "800.00"),
        ("transaction", "1000.00", "850.00"),
        ("transaction", "-150.00", "-150.00"),
    ]
    assert (history.entries[0].other, history.entries[0].note) == ("Unallocated", "Too much")
    assert (history.entries[1].payee, history.entries[1].narration) == ("Acme", "Paycheck")


def test_moves_are_checked_and_edited_by_version(ledger, book):
    def move(frm, to, number="10.00"):
        return models.FundMoveIn(date=D(2026, 3, 1), from_fund=frm, to_fund=to, amount=usd(number))

    with pytest.raises(FundRefused, match="a move goes from one fund to another"):
        funds.create_move(ledger, book, move("Emergency", "emergency"))
    with pytest.raises(FundRefused, match="a move's amount is more than 0"):
        funds.create_move(ledger, book, move("Emergency", "Wedding", "-5.00"))
    with pytest.raises(FundRefused, match="there's no fund called Nope"):
        funds.create_move(ledger, book, move("Nope", "Wedding"))

    made = funds.create_move(ledger, book, move("unallocated", "wedding"))
    assert (made.from_fund, made.to_fund) == ("Unallocated", "Wedding")
    changed = funds.patch_move(ledger, book, made.id, models.FundMovePatch(updated_at=made.updated_at, amount=usd("25.00")))
    assert balances(ledger, book)["Wedding"] == "25.00"
    funds.delete_move(ledger, book, made.id, changed.updated_at)
    assert balances(ledger, book)["Wedding"] == "0.00"


def test_names_are_checked(ledger, book):
    for bad, problem in [
        ("  ", "a fund needs a name"),
        ("Unallocated", "Unallocated is what isn't in a fund: it can't be a fund's name"),
        ("A; B", 'a fund\'s name can\'t hold ; " \\ or /'),
        ("emergency", "there's a fund called Emergency already"),
    ]:
        with pytest.raises(FundRefused) as refused:
            funds.create(ledger, book, models.FundIn(name=bad))
        assert str(refused.value) == problem
    with pytest.raises(FundRefused, match="at most 60 characters"):
        fundlines.valid_name("x" * 61)
    made = funds.create(
        ledger,
        book,
        models.FundIn(name="  Special  Home Improvement ", description="The kitchen", target=usd("20000.00")),
    )
    assert (made.name, made.description, made.target.number) == ("Special Home Improvement", "The kitchen", "20000.00")
    patched = funds.patch(ledger, book, made.name, models.FundPatch(updated_at=made.updated_at, target=None))
    assert patched.target is None and patched.description == "The kitchen"


def test_a_fund_only_used_is_listed(ledger):
    text = TEXT + '2026-02-01 * "Gift"\n  funds: "Rainy Day +100.00 USD"\n  Assets:Bank:PNC  100.00 USD\n  Income:Salary\n'
    book = ledger.create_book(name="Imported", owner_id=USER, text=text).id
    [rainy] = funds.listing(ledger, book).funds
    assert (rainy.name, rainy.value.number, rainy.created, rainy.updated_at) == ("Rainy Day", "100.00", None, None)


def test_funds_over_http_by_role(ledger):
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    owner = http(ledger, USER)
    for user, role in (("writer", "write"), ("manager", "manage")):
        owner.put(f"/api/ledger/v1/books/{book}/members/{user}", json={"role": role})
    base = f"/api/ledger/v1/books/{book}"
    writer, manager = http(ledger, "writer"), http(ledger, "manager")

    assert writer.post(f"{base}/funds", json={"name": "Emergency"}).status_code == 403
    made = manager.post(f"{base}/funds", json={"name": "Emergency", "target": {"number": "5000.00", "currency": "USD"}})
    assert made.status_code == 201
    paycheck = {
        "date": "2026-02-03",
        "flag": "*",
        "narration": "Paycheck",
        "funds": [{"fund": "Emergency", "amount": {"number": "600.00", "currency": "USD"}}],
        "postings": [
            {"account": "Assets:Bank:PNC", "units": {"number": "1000.00", "currency": "USD"}},
            {"account": "Income:Salary"},
        ],
    }
    assert writer.post(f"{base}/transactions", json=paycheck).status_code == 201
    too_much = {**paycheck, "funds": [{"fund": "Emergency", "amount": {"number": "1600.00", "currency": "USD"}}]}
    refused = writer.post(f"{base}/transactions", json=too_much)
    assert refused.status_code == 422 and "more than the 1,000.00 USD that came in" in refused.json()["detail"]
    moved = writer.post(
        f"{base}/fund-moves",
        json={"date": "2026-02-04", "from_fund": "Emergency", "to_fund": "Unallocated", "amount": {"number": "100.00", "currency": "USD"}},
    )
    assert moved.status_code == 201

    listing = writer.get(f"{base}/funds").json()
    assert [(f["name"], f["value"]["number"]) for f in listing["funds"]] == [("Emergency", "500.00")]
    assert (listing["net_worth"]["number"], listing["unallocated"]["number"]) == ("11000.00", "10500.00")
    history = writer.get(f"{base}/funds/Emergency/entries").json()
    assert [e["kind"] for e in history["entries"]] == ["move", "transaction"]
    version = made.json()["updated_at"]
    assert writer.post(f"{base}/funds/Emergency/rename", json={"to": "Rainy", "updated_at": version}).status_code == 403
    assert manager.post(f"{base}/funds/Emergency/rename", json={"to": "Rainy", "updated_at": version}).status_code == 200
    assert writer.get(f"{base}/funds/Nothing/entries").status_code == 404


def test_lines_and_moves_are_backfilled_for_books_from_before_migration_13(tmp_path):
    from ledger.store import Store

    path = tmp_path / "old.sqlite"
    conn = sqlite3.connect(path)
    for statement in [s for m in migrations.MIGRATIONS[:12] for s in m if isinstance(s, str)]:
        conn.execute(statement)
    conn.execute("PRAGMA user_version = 12")
    stamp = migrations.now()
    conn.execute("INSERT INTO book (id, header, seq, created_at, updated_at) VALUES ('b', '', 1, ?, ?)", (stamp, stamp))
    for i, (directive_id, kind, text) in enumerate(
        [
            ("t1", "transaction", '2024-01-01 * "Pay"\n  id: "t1"\n  funds: "A +5.00 USD; B +1.00 USD"\n  Assets:A  6 USD\n  Income:B\n'),
            ("m1", "custom", '2024-01-02 custom "fund-move" "A" "Unallocated" 2.00 USD\n  id: "m1"\n'),
        ]
    ):
        conn.execute(
            "INSERT INTO directive (id, book_id, date, kind, flag, ordinal, text, seq, created_at, updated_at)"
            " VALUES (?, 'b', '2024-01-01', ?, '*', ?, ?, 1, ?, ?)",
            (directive_id, kind, i + 1, text, stamp, stamp),
        )
    conn.commit()
    conn.close()

    store = Store(str(path))

    assert sorted((r["fund"], r["amount"]) for r in store.fund_lines("b")) == [("A", "-2.00"), ("A", "5.00"), ("B", "1.00")]

"""Funds B, step 1: shares in funds. Funds read a transaction per commodity, moves take shares,
accounts have dated default funds, and nothing done by hand leaves a fund short of a share."""

import datetime

import pytest

from conftest import USER, http
from ledger import fundlines, funds, models
from ledger.fundlines import FundRefused

D = datetime.date
ON = D(2026, 11, 2)
CASH = "Assets:Brokerage:Fidelity:Cash"
FXAIX = "Assets:Brokerage:Fidelity:FXAIX"
VTI = "Assets:Brokerage:Fidelity:VTI"
IRA = "Assets:Retirement:Roth-IRA"
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Assets:Brokerage:Fidelity:Cash USD
2026-01-01 open Assets:Brokerage:Fidelity:FXAIX
2026-01-01 open Assets:Brokerage:Fidelity:VTI
2026-01-01 open Assets:Retirement:Roth-IRA:Cash USD
2026-01-01 open Assets:Retirement:Roth-IRA:FXAIX
2026-01-01 open Income:Dividends
2026-01-01 open Income:Capital-Gains
2026-01-01 open Expenses:Food
2026-01-01 open Equity:Opening-Balances
2026-01-01 * "Opening balance"
  Assets:Brokerage:Fidelity:Cash  6000.00 USD
  Assets:Brokerage:Fidelity:FXAIX  200 FXAIX {150.00 USD}
  Assets:Brokerage:Fidelity:VTI  50 VTI {250.00 USD}
  Equity:Opening-Balances
2026-01-01 * "Opening balance"
  Assets:Retirement:Roth-IRA:Cash  500.00 USD
  Assets:Retirement:Roth-IRA:FXAIX  20 FXAIX {100.00 USD}
  Equity:Opening-Balances
2026-01-01 * "Opening balance"
  Assets:Bank:Checking  3000.00 USD
  Equity:Opening-Balances
2026-11-01 price FXAIX 200.00 USD
2026-11-01 price VTI 300.00 USD
"""
FUNDS = ("Emergency", "Wedding", "Special Home Maintenance and Repair", "Special Home Improvement", "Retirement")
SHMR = "Special Home Maintenance and Repair"


def amount(number: str, currency: str = "USD") -> models.Amount:
    return models.Amount(number=number, currency=currency)


def line(fund: str, number: str, currency: str = "USD") -> models.FundLine:
    return models.FundLine(fund=fund, amount=amount(number, currency))


def posting(account, number=None, currency="USD", cost=None):
    return models.Posting(
        account=account,
        units=amount(number, currency) if number else None,
        cost=models.Cost(number=cost, currency="USD") if cost else None,
    )


def txn(day, postings, lines=(), narration="", flag="*"):
    return models.TransactionIn(date=day, flag=flag, narration=narration, funds=list(lines) or None, postings=postings)


def buy(units, commodity, price, lines=(), day=D(2026, 11, 3), cash=CASH, holding=None):
    total = f"{int(units) * int(price)}.00"
    return txn(
        day,
        [posting(cash, f"-{total}"), posting(holding or f"Assets:Brokerage:Fidelity:{commodity}", units, commodity, price)],
        lines,
        f"Bought {units} {commodity}",
    )


def sell(units, proceeds, lines=(), flag="*", day=D(2026, 11, 4)):
    return txn(
        day,
        [posting(VTI, f"-{units}", "VTI", "250.00"), posting(CASH, proceeds), posting("Income:Capital-Gains")],
        lines,
        f"Sold {units} VTI",
        flag,
    )


def move(frm, to, number, currency="USD", day=D(2026, 11, 2)):
    return models.FundMoveIn(date=day, from_fund=frm, to_fund=to, amount=amount(number, currency))


@pytest.fixture
def book(ledger):
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    for name in FUNDS:
        funds.create(ledger, book, models.FundIn(name=name))
    return book


def held(ledger, book):
    """Each fund's holdings and value, and Unallocated's, at ON's prices."""
    listing = funds.listing(ledger, book, ON)
    out = {
        f.name: ({h.amount.currency: h.amount.number for h in f.holdings}, f.value.number)
        for f in listing.funds
        if f.holdings
    }
    out["Unallocated"] = ({h.amount.currency: h.amount.number for h in listing.unallocated_holdings}, listing.unallocated.number)
    return out


def set_up(ledger, book):
    """The plan's walkthrough, step 1: the brokerage divided among four funds."""
    funds.create_moves(
        ledger,
        book,
        models.FundMovesIn(
            moves=[
                move("Unallocated", "Emergency", "4000.00"),
                move("Unallocated", "Emergency", "100", "FXAIX"),
                move("Unallocated", "Wedding", "50", "FXAIX"),
                move("Unallocated", "Wedding", "30", "VTI"),
                move("Unallocated", SHMR, "20", "VTI"),
                move("Unallocated", "Special Home Improvement", "40", "FXAIX"),
            ]
        ),
    )


def test_the_walkthrough(ledger, book):
    set_up(ledger, book)
    now = held(ledger, book)
    assert now["Emergency"] == ({"USD": "4000.00", "FXAIX": "100"}, "24000.00")
    assert now["Wedding"] == ({"FXAIX": "50", "VTI": "30"}, "19000.00")
    assert now[SHMR] == ({"VTI": "20"}, "6000.00")
    # Unallocated: everything no fund holds, the IRA and checking included.
    assert now["Unallocated"] == ({"USD": "5500.00", "FXAIX": "30"}, "11500.00")

    # Moving shares between funds.
    funds.create_move(ledger, book, move(SHMR, "Wedding", "10", "VTI"))
    assert held(ledger, book)["Wedding"][0] == {"FXAIX": "50", "VTI": "40"}

    # Buying with a fund's cash: one fund gives the dollars and gets the shares.
    ledger.create_transaction(book, buy("10", "VTI", "300", [line("Emergency", "-3000.00"), line("Emergency", "10", "VTI")]))
    assert held(ledger, book)["Emergency"] == ({"USD": "1000.00", "FXAIX": "100", "VTI": "10"}, "24000.00")

    # Selling a fund's shares: every VTI is in a fund, so an unmarked sale is short.
    with pytest.raises(FundRefused, match="it takes 20 VTI from Unallocated, which has 0 VTI: say which fund's VTI it is"):
        ledger.create_transaction(book, sell("20", "6100.00"))
    ledger.create_transaction(book, sell("20", "6100.00", [line("Wedding", "-20", "VTI"), line("Wedding", "6100.00")]))
    assert held(ledger, book)["Wedding"][0] == {"USD": "6100.00", "FXAIX": "50", "VTI": "20"}


def test_shapes_are_per_commodity():
    found = fundlines.shapes_of([(CASH, fundlines.Decimal("-3000"), "USD"), (VTI, fundlines.Decimal("10"), "VTI")])
    assert {c: (s.kind, s.size) for c, s in found.items()} == {"USD": ("out", 3000), "VTI": ("in", 10)}
    moved = fundlines.shapes_of([(VTI, fundlines.Decimal("-5"), "VTI"), ("Assets:Other:VTI", fundlines.Decimal("5"), "VTI")])
    assert (moved["VTI"].kind, moved["VTI"].size) == ("transfer", 5)


def test_a_sale_reads_without_booking(ledger, book):
    # An empty cost leaves the lot to booking, but its units are known.
    text = '2026-11-04 * "Sold"\n  Assets:Brokerage:Fidelity:VTI  -5 VTI {}\n  Assets:Brokerage:Fidelity:Cash  1500.00 USD\n  Income:Capital-Gains\n'
    found = fundlines.shapes(text, ledger._header(book))
    assert {c: s.kind for c, s in found.items()} == {"VTI": "out", "USD": "in"}


@pytest.mark.parametrize(
    "lines, problem",
    [
        ([line("Emergency", "11", "VTI")], "its funds get 11 VTI, more than the 10 VTI that came in"),
        ([line("Emergency", "3000.00")], "money going out comes from funds, not to them (Emergency)"),
        ([line("Emergency", "5", "FXAIX")], "it moves no FXAIX (Emergency)"),
        ([line("Emergency", "4", "VTI"), line("emergency", "6", "VTI")], "Emergency is in it twice in VTI"),
    ],
)
def test_lines_are_checked_per_commodity(ledger, book, lines, problem):
    with pytest.raises(FundRefused) as refused:
        ledger.create_transaction(book, buy("10", "VTI", "300", lines))
    assert str(refused.value) == problem


def test_one_side_of_a_trade_alone(ledger, book):
    # Shares bought for Wedding with Unallocated's cash.
    ledger.create_transaction(book, buy("10", "VTI", "300", [line("Wedding", "10", "VTI")]))
    now = held(ledger, book)
    assert now["Wedding"] == ({"VTI": "10"}, "3000.00")
    assert now["Unallocated"][0]["USD"] == "6500.00"


def test_moves_take_shares_but_never_below_zero(ledger, book):
    set_up(ledger, book)
    with pytest.raises(FundRefused, match=f"{SHMR} has 20 VTI, not 25 VTI"):
        funds.create_move(ledger, book, move(SHMR, "Wedding", "25", "VTI"))
    with pytest.raises(FundRefused, match="Unallocated has 30 FXAIX, not 31 FXAIX"):
        funds.create_move(ledger, book, move("Unallocated", "Wedding", "31", "FXAIX"))
    with pytest.raises(FundRefused, match="the book holds no ABC"):
        funds.create_move(ledger, book, move("Unallocated", "Wedding", "1", "ABC"))
    # Dollars can still go below zero, as in Funds A.
    funds.create_move(ledger, book, move(SHMR, "Wedding", "100.00"))
    assert held(ledger, book)[SHMR][0]["USD"] == "-100.00"
    # A move whose undoing would leave a fund short can't be deleted or shrunk.
    made = funds.create_move(ledger, book, move("Unallocated", SHMR, "5", "FXAIX"))
    funds.create_move(ledger, book, move(SHMR, "Wedding", "5", "FXAIX"))
    with pytest.raises(FundRefused, match=f"{SHMR} has 0 FXAIX, not 5 FXAIX"):
        funds.delete_move(ledger, book, made.id, made.updated_at)


def test_a_sale_is_short_only_when_the_fund_it_draws_on_is(ledger, book):
    set_up(ledger, book)
    # Unallocated has 30 FXAIX: selling 5 unmarked goes through.
    ledger.create_transaction(
        book,
        txn(D(2026, 11, 4), [posting(FXAIX, "-5", "FXAIX", "150.00"), posting(CASH, "1000.00"), posting("Income:Capital-Gains")]),
    )
    assert funds.short(ledger, book) == []


def test_what_comes_in_by_itself_is_kept_and_listed_until_its_fixed(ledger, book):
    set_up(ledger, book)
    [staged] = ledger.create_transactions(book, [sell("20", "6100.00", flag="!")], staging=True)
    [found] = funds.short(ledger, book)
    assert found.id == staged.id
    assert [(t.fund, t.amount.number, t.holding.number) for t in found.takes] == [("Unallocated", "20", "-20")]
    current = ledger.transaction(book, staged.id)
    # Confirming it unfixed is a save by hand: refused.
    with pytest.raises(FundRefused, match="it takes 20 VTI from Unallocated"):
        ledger.patch_transaction(book, staged.id, models.TransactionPatch(updated_at=current.updated_at, flag="*"))
    # Recategorizing it isn't checked (its share side doesn't change).
    ledger.patch_transaction(
        book,
        staged.id,
        models.TransactionPatch(updated_at=current.updated_at, narration="Sold some VTI"),
    )
    current = ledger.transaction(book, staged.id)
    ledger.patch_transaction(
        book,
        staged.id,
        models.TransactionPatch(
            updated_at=current.updated_at, flag="*", funds=[line(SHMR, "-20", "VTI"), line(SHMR, "6100.00")]
        ),
    )
    assert funds.short(ledger, book) == []


def test_deleting_by_hand_cant_leave_a_fund_short(ledger, book):
    [bought] = ledger.create_transactions(book, [buy("10", "VTI", "300")])
    funds.create_move(ledger, book, move("Unallocated", "Wedding", "60", "VTI"))
    with pytest.raises(FundRefused, match="it would leave Unallocated at -10 VTI"):
        ledger.delete(book, bought.id)
    ledger.delete(book, bought.id, staging=True)
    assert funds.short(ledger, book) == []  # nothing takes VTI from Unallocated: only a move does


def default(ledger, book, account=IRA, fund="Retirement", day=D(2026, 1, 1)):
    return funds.create_default(ledger, book, models.FundDefaultIn(account=account, fund=fund, date=day))


def test_a_default_fund_holds_its_accounts(ledger, book):
    preview = funds.preview_default(ledger, book, models.FundDefaultPreview(account=IRA, fund="Retirement", date=D(2026, 1, 1)))
    assert [(c.fund, [(a.number, a.currency) for a in c.amounts], c.value.number) for c in preview.changes] == [
        ("Retirement", [("500.00", "USD"), ("20", "FXAIX")], "4500.00"),
        ("Unallocated", [("-500.00", "USD"), ("-20", "FXAIX")], "-4500.00"),
    ]
    assert preview.problem is None
    default(ledger, book)
    assert held(ledger, book)["Retirement"] == ({"USD": "500.00", "FXAIX": "20"}, "4500.00")
    assert funds.get(ledger, book, "Retirement").accounts == [IRA]

    # A dividend reinvested inside it: Retirement's, nothing marked.
    ledger.create_transaction(
        book, txn(D(2026, 11, 5), [posting(f"{IRA}:FXAIX", "0.3", "FXAIX", "200.00"), posting("Income:Dividends")])
    )
    # A contribution from checking: Unallocated pays, Retirement gets it.
    ledger.create_transaction(book, txn(D(2026, 11, 6), [posting("Assets:Bank:Checking", "-500.00"), posting(f"{IRA}:Cash", "500.00")]))
    now = held(ledger, book)
    assert now["Retirement"][0] == {"USD": "1000.00", "FXAIX": "20.3"}
    assert now["Unallocated"][0]["USD"] == "8500.00"
    # From Emergency instead: the line takes over checking's side.
    ledger.create_transaction(
        book,
        txn(D(2026, 11, 7), [posting("Assets:Bank:Checking", "-200.00"), posting(f"{IRA}:Cash", "200.00")], [line("Emergency", "-200.00")]),
    )
    now = held(ledger, book)
    assert (now["Retirement"][0]["USD"], now["Emergency"][0]["USD"], now["Unallocated"][0]["USD"]) == ("1200.00", "-200.00", "8500.00")
    # Its history lists what the IRA gave it, and adds up.
    history = funds.history(ledger, book, "Retirement")
    assert [(e.amount.number, e.amount.currency, e.balance.number) for e in history.entries][:3] == [
        ("200.00", "USD", "1200.00"),
        ("500.00", "USD", "1000.00"),
        ("0.3", "FXAIX", "20.3"),
    ]


def test_a_default_starts_on_its_date(ledger, book):
    default(ledger, book, day=D(2026, 11, 1))
    # The opening balance is from before: still Unallocated's.
    assert "Retirement" not in held(ledger, book)
    ledger.create_transaction(book, txn(D(2026, 11, 6), [posting("Assets:Bank:Checking", "-50.00"), posting(f"{IRA}:Cash", "50.00")]))
    assert held(ledger, book)["Retirement"][0] == {"USD": "50.00"}


def test_a_default_is_kept_in_step_with_its_fund(ledger, book):
    made = default(ledger, book)
    with pytest.raises(FundRefused, match="Retirement is the default fund of Assets:Retirement:Roth-IRA"):
        funds.archive(ledger, book, "Retirement", models.FundArchive(updated_at=funds.get(ledger, book, "Retirement").updated_at))
    funds.rename(ledger, book, "Retirement", models.FundRename(to="Later", updated_at=funds.get(ledger, book, "Retirement").updated_at))
    [d] = funds.listing(ledger, book, ON).defaults
    assert (d.id, d.fund) == (made.id, "Later")
    with pytest.raises(FundRefused, match="only an asset or liability account has a default fund"):
        default(ledger, book, account="Income:Dividends")
    with pytest.raises(FundRefused, match="there's no fund called Nope"):
        default(ledger, book, fund="Nope")


def test_a_default_cant_leave_a_fund_short(ledger, book):
    default(ledger, book)
    funds.create_move(ledger, book, move("Retirement", "Wedding", "20", "FXAIX"))
    # Starting it later would take the IRA's 20 FXAIX back out of Retirement, which has none.
    [d] = funds.listing(ledger, book, ON).defaults
    with pytest.raises(FundRefused, match="it would leave Retirement at -20 FXAIX"):
        funds.patch_default(ledger, book, d.id, models.FundDefaultPatch(updated_at=d.updated_at, date=D(2026, 6, 1)))


def test_a_trade_writes_its_lines(ledger, book):
    funds.create_move(ledger, book, move("Unallocated", "Wedding", "3000.00"))
    t = models.TradeIn(
        kind="buy",
        date=D(2026, 11, 3),
        commodity="VTI",
        units="10",
        price="300",
        cash_account=CASH,
        holding_account=VTI,
        funds=[line("Wedding", "-3000.00"), line("Wedding", "10", "VTI")],
    )
    directive = __import__("ledger").investments.trade(ledger, book, "Assets:Brokerage:Fidelity", t)
    assert [(f.fund, f.amount.number, f.amount.currency) for f in ledger.transaction(book, directive.id).funds] == [
        ("Wedding", "-3000.00", "USD"),
        ("Wedding", "10", "VTI"),
    ]


def test_over_http(ledger):
    book = ledger.create_book(name="Ours", owner_id=USER, text=TEXT).id
    owner = http(ledger, USER)
    owner.put(f"/api/ledger/v1/books/{book}/members/writer", json={"role": "write"})
    base = f"/api/ledger/v1/books/{book}"
    writer = http(ledger, "writer")
    assert owner.post(f"{base}/funds", json={"name": "Wedding"}).status_code == 201
    assert owner.post(f"{base}/funds", json={"name": "Retirement"}).status_code == 201
    moved = writer.post(
        f"{base}/fund-moves/batch",
        json={
            "moves": [
                {"date": "2026-11-02", "from_fund": "Unallocated", "to_fund": "Wedding", "amount": {"number": "50", "currency": "VTI"}},
                {"date": "2026-11-02", "from_fund": "Unallocated", "to_fund": "Wedding", "amount": {"number": "100.00", "currency": "USD"}},
            ]
        },
    )
    assert moved.status_code == 201 and len(moved.json()) == 2
    a_default = {"account": IRA, "fund": "Retirement", "date": "2026-01-01"}
    assert writer.post(f"{base}/fund-defaults", json=a_default).status_code == 403
    assert owner.post(f"{base}/fund-defaults", json=a_default).status_code == 201
    sale = {
        "date": "2026-11-04",
        "flag": "!",
        "narration": "Sold 10 VTI",
        "postings": [
            {"account": VTI, "units": {"number": "-10", "currency": "VTI"}, "cost": {"number": "250.00", "currency": "USD"}},
            {"account": CASH, "units": {"number": "3000.00", "currency": "USD"}},
            {"account": "Income:Capital-Gains"},
        ],
    }
    refused = writer.post(f"{base}/transactions", json=sale)
    assert refused.status_code == 422 and "say which fund's VTI it is" in refused.json()["detail"]
    assert writer.post(f"{base}/transactions?staging=true", json=sale).status_code == 201
    short = writer.get(f"{base}/funds/short").json()
    assert [(s["narration"], s["takes"][0]["fund"]) for s in short] == [("Sold 10 VTI", "Unallocated")]
    listing = writer.get(f"{base}/funds").json()
    assert listing["defaults"][0]["fund"] == "Retirement"
    assert {h["amount"]["currency"]: h["amount"]["number"] for h in listing["unallocated_holdings"]}["VTI"] == "-10"

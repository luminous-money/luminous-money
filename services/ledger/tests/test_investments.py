"""Investments (M5): prices in SQL, valuation, subtrees, holdings with cost basis, commodities,
revalued assets."""

import datetime
from decimal import Decimal

import pytest
from conftest import USER, http

from ledger import investments, migrations, models

ON = datetime.date(2024, 6, 30)

BROKERAGE = """option "operating_currency" "USD"
2020-01-01 open Assets:Broker
2020-01-01 open Assets:Broker:Cash USD
2020-01-01 open Assets:Broker:VTI VTI "FIFO"
2020-01-01 open Assets:Bank USD
2020-01-01 open Expenses:Fees USD
2020-01-01 commodity VTI
  name: "Vanguard Total Stock Market ETF"
  price: "USD:yahoo/VTI"
2024-01-02 * "Fund the account"
  Assets:Bank        -5000.00 USD
  Assets:Broker:Cash
2024-01-10 * "Buy VTI"
  Assets:Broker:VTI   10 VTI {200.00 USD}
  Assets:Broker:Cash
2024-03-10 * "Buy VTI"
  Assets:Broker:VTI   5 VTI {220.00 USD}
  Assets:Broker:Cash  -1105.00 USD
  Expenses:Fees          5.00 USD
2024-06-01 price VTI 230.00 USD
2024-06-28 price VTI 240.00 USD
2024-07-15 price VTI 999.00 USD
"""


@pytest.fixture
def book(ledger):
    ledger.apply_text("book", BROKERAGE, owner_id=USER)
    return ledger


def test_prices_are_read_with_sql_latest_on_a_date(book):
    latest = investments.prices(book, "book", ON)

    assert latest[("VTI", "USD")] == (datetime.date(2024, 6, 28), Decimal("240.00"))
    assert investments.price_list(book, "book", "VTI")[0].price.number == "999.00"


def test_a_price_for_the_same_date_replaces_the_last(book):
    first = investments.add_price(book, "book", models.PriceIn(date=ON, commodity="VTI", price=models.Amount(number="241", currency="USD")))
    second = investments.add_price(book, "book", models.PriceIn(date=ON, commodity="VTI", price=models.Amount(number="242", currency="USD")))

    assert first.id == second.id
    assert investments.prices(book, "book", ON)[("VTI", "USD")][1] == Decimal("242")


def test_deleting_a_price_directive_removes_it(book):
    p = investments.add_price(book, "book", models.PriceIn(date=ON, commodity="VTI", price=models.Amount(number="1", currency="USD")))
    book.delete("book", p.id)

    assert investments.prices(book, "book", ON)[("VTI", "USD")][1] == Decimal("240.00")


def test_conversion_goes_through_one_other_currency():
    known = {("GBP", "USD"): (datetime.date(2024, 1, 2), Decimal("1.25")), ("SHELL", "GBP"): (datetime.date(2024, 1, 1), Decimal("20"))}

    assert investments.rate("SHELL", "USD", known) == (Decimal("25.00"), datetime.date(2024, 1, 1))
    assert investments.rate("USD", "USD", known) == (Decimal(1), None)
    assert investments.rate("XYZ", "USD", known) is None


def test_holdings_of_a_subtree_with_cost_lots_and_gains(book):
    h = investments.holdings(book, "book", "Assets:Broker", ON)

    vti = next(x for x in h.holdings if x.commodity == "VTI")
    cash = next(x for x in h.holdings if x.commodity == "USD")
    assert (vti.units, vti.price.number, vti.value.number, vti.cost.number) == ("15", "240.00", "3600.00", "3100.00")
    assert vti.gain.number == "500.00"
    assert [(lot.units, lot.cost.number) for lot in vti.lots] == [("10", "200.00"), ("5", "220.00")]
    assert vti.name == "Vanguard Total Stock Market ETF"
    assert not vti.stale
    assert cash.value.number == "1895.00"
    assert (h.value.number, h.gain.number, h.as_of) == ("5495.00", "500.00", datetime.date(2024, 6, 28))


def test_a_price_older_than_the_commodity_allows_is_stale(book):
    assert investments.holdings(book, "book", "Assets:Broker", datetime.date(2024, 7, 10)).stale  # 12 days


def test_a_summary_of_a_node_has_its_value_and_gain(book):
    [summary] = book.summary("book", ["Assets:Broker"])

    assert {a.currency: a.number for a in summary.balance} == {"USD": "1895.00", "VTI": "15"}
    assert summary.value is not None and summary.gain is not None


def test_a_node_ledger_shows_every_currency_and_keeps_running_balances(book):
    rows = book.account_ledger("book", "Assets:Broker").rows

    buy = next(r for r in rows if r.date == datetime.date(2024, 3, 10))
    assert {a.currency: a.number for a in buy.amounts} == {"USD": "-1105.00", "VTI": "5"}
    assert buy.amount is None
    assert {b.currency: b.number for b in rows[0].balances} == {"USD": "1895.00", "VTI": "15"}


def test_commodities_list_declared_held_and_priced_and_can_be_edited(book):
    listed = {c.currency: c for c in investments.commodity_list(book, "book")}

    assert listed["VTI"].declared and listed["VTI"].price_source == "USD:yahoo/VTI"
    changed = investments.set_commodity(
        book, "book", "VTI", models.CommodityIn(name="Total market", price_source=None, stale_after=3, updated_at=listed["VTI"].updated_at)
    )
    assert (changed.name, changed.price_source, changed.stale_after) == ("Total market", None, 3)
    with pytest.raises(Exception):
        investments.set_commodity(book, "book", "VTI", models.CommodityIn(name="x", updated_at="stale"))


def test_a_revalued_asset_records_the_change_against_unrealized_gains(ledger):
    ledger.apply_text("book", 'option "operating_currency" "USD"\n', owner_id=USER)
    house = "Assets:Property:House"
    opening = models.OpeningBalance(amount="400000.00", date=datetime.date(2023, 1, 1))
    ledger.create_account("book", models.AccountIn(name=house, opening_balance=opening))
    ledger.store.put("book", [])  # no-op

    investments.revalue(ledger, "book", house, models.RevalueIn(date=datetime.date(2024, 1, 1), value=models.Amount(number="425000.00", currency="USD")))

    [summary] = ledger.summary("book", [house])
    assert summary.value.number == "425000.00"
    assert ledger.problems("book") == []


def test_prices_are_backfilled_for_books_from_before_migration_4(tmp_path):
    import sqlite3

    from ledger.store import Store

    path = tmp_path / "old.sqlite"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    for statement in [s for m in migrations.MIGRATIONS[:3] for s in m if isinstance(s, str)]:
        conn.execute(statement)
    conn.execute("PRAGMA user_version = 3")
    stamp = migrations.now()
    conn.execute("INSERT INTO book (id, header, seq, created_at, updated_at) VALUES ('b', '', 1, ?, ?)", (stamp, stamp))
    conn.execute(
        "INSERT INTO directive (id, book_id, date, kind, ordinal, text, seq, created_at, updated_at)"
        " VALUES ('p1', 'b', '2024-01-01', 'price', 1, ?, 1, ?, ?)",
        ('2024-01-01 price VTI 100 USD\n  id: "p1"\n', stamp, stamp),
    )
    conn.commit()
    conn.close()

    store = Store(str(path))

    assert [dict(r) for r in store.latest_prices("b", "2024-12-31")] == [
        {"commodity": "VTI", "currency": "USD", "date": "2024-01-01", "number": "100"}
    ]


def test_investments_over_http(book):
    client = http(book)

    holdings = client.get("/api/ledger/v1/books/book/accounts/Assets:Broker/holdings", params={"on": "2024-06-30"}).json()
    added = client.post("/api/ledger/v1/books/book/prices", json={"date": "2024-06-30", "commodity": "VTI", "price": {"number": "250", "currency": "USD"}})
    commodities = client.get("/api/ledger/v1/books/book/commodities").json()

    assert holdings["value"] == {"number": "5495.00", "currency": "USD"}
    assert added.status_code == 201
    assert [c["currency"] for c in commodities] == ["VTI"]

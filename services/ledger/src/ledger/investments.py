"""Investments (M5): commodities, prices, valuation, holdings with cost basis, and revaluation.

- **Prices** are the books' own `price` directives, read through the derived `price` table.
  Value is in the book's operating currency: a commodity priced in it directly, or in another
  currency that is.
- **Units** come from SQL (the derived posting amounts), like balances.
- **Cost basis and lots** need Beancount's booking. Booking is per account, so rather than
  loading the whole book, an account's (or subtree's) slice is booked on its own: every `open`,
  `close` and `commodity` directive, and the transactions that touch the subtree. It's cached
  until the book changes.
- **Revalued assets** (a house, a car) are plain currency balances whose `open` carries
  `revalue-every` (days); "Update value" writes the difference against `Income:Unrealized-Gains`.
"""

from __future__ import annotations

import datetime
import threading
from dataclasses import dataclass
from decimal import Decimal

from beancount.core import data, realization
from beancount.parser import parser

from . import engine, models
from .store import StaleVersion

UNREALIZED_GAINS = "Income:Unrealized-Gains"
REVALUATION_KEY = "revaluation"
STALE_AFTER_KEY = "stale-after"
PRICE_SOURCE_KEY = "price"
NAME_KEY = "name"
DEFAULT_STALE_AFTER = 7


def operating_currency(header: list[str]) -> str:
    """The book's first `operating_currency` option, or USD."""
    for line in header:
        if line.startswith('option "operating_currency"'):
            return line.split('"')[3]
    return "USD"


@dataclass(frozen=True)
class Commodity:
    currency: str
    name: str | None
    price_source: str | None
    stale_after: int
    directive_id: str | None
    updated_at: str | None


def commodities(ledger, book_id: str) -> dict[str, Commodity]:
    """The book's declared commodities (`commodity` directives), with their metadata."""
    out: dict[str, Commodity] = {}
    for r in ledger.store.find(book_id, kind="commodity", limit=None):
        entries, _, _ = parser.parse_string(r.text)
        entry = entries[0]
        stale = entry.meta.get(STALE_AFTER_KEY)
        out[entry.currency] = Commodity(
            currency=entry.currency,
            name=entry.meta.get(NAME_KEY),
            price_source=entry.meta.get(PRICE_SOURCE_KEY),
            stale_after=int(stale) if stale is not None else DEFAULT_STALE_AFTER,
            directive_id=r.id,
            updated_at=r.updated_at,
        )
    return out


Prices = dict[tuple[str, str], tuple[datetime.date, Decimal]]


def prices(ledger, book_id: str, on: datetime.date) -> Prices:
    """Each commodity's latest price in each quote currency, dated `on` or earlier."""
    return {
        (r["commodity"], r["currency"]): (datetime.date.fromisoformat(r["date"]), Decimal(r["number"]))
        for r in ledger.store.latest_prices(book_id, on.isoformat())
    }


def rate(commodity: str, target: str, known: Prices) -> tuple[Decimal, datetime.date | None] | None:
    """What one unit of `commodity` is worth in `target`, and the date of the oldest price
    behind it (None for the currency itself): directly, or through one other currency."""
    if commodity == target:
        return Decimal(1), None
    if (commodity, target) in known:
        date, number = known[(commodity, target)]
        return number, date
    for (base, quote), (date, number) in known.items():
        if base == commodity and (quote, target) in known:
            hop_date, hop = known[(quote, target)]
            return number * hop, min(date, hop_date)
    return None


def value_of(units: dict[str, Decimal], target: str, known: Prices):
    """The value of `units` (currency to number) in `target`, and the oldest price date behind
    it; (None, None) if any of them can't be valued."""
    total, oldest = Decimal(0), None
    for currency, number in units.items():
        found = rate(currency, target, known)
        if found is None:
            return None, None
        r, date = found
        total += number * r
        if date and (oldest is None or date < oldest):
            oldest = date
    return total, oldest


class ScopedBooking:
    """Account-scoped booking, cached per book and account until the book changes."""

    def __init__(self) -> None:
        self._cache: dict[tuple[int, str, str], tuple[int, list[data.Directive], list[engine.Problem]]] = {}
        self._lock = threading.Lock()

    def entries(self, ledger, book_id: str, account: str, extra: list[str] | None = None):
        """The booked entries for `account`'s subtree (plus `extra` directive texts, uncached:
        a trade being checked), and Beancount's problems with them."""
        header = ledger._header(book_id)
        key = (id(ledger.store), book_id, account)
        with self._lock:
            seq = ledger.store.book_seq(book_id)
            cached = self._cache.get(key)
            if cached is not None and cached[0] == seq and not extra:
                return cached[1], cached[2]
        texts = [
            r.text
            for kind in ("open", "close", "commodity")
            for r in ledger.store.find(book_id, kind=kind, limit=None)
        ]
        texts += [r.text for r in ledger.store.find(book_id, kind="transaction", account=account, limit=None)]
        loaded = engine.load(header, texts + (extra or []))
        problems = loaded.problems
        if not extra:
            with self._lock:
                self._cache[key] = (seq, loaded.entries, problems)
        return loaded.entries, problems


SCOPED = ScopedBooking()


def inventory(ledger, book_id: str, account: str, extra: list[str] | None = None):
    """The subtree's positions (units, with cost for lots), after booking."""
    entries, problems = SCOPED.entries(ledger, book_id, account, extra)
    root = realization.realize(entries)
    node = realization.get(root, account)
    positions = list(realization.compute_balance(node)) if node is not None else []
    return positions, problems


CENT = Decimal("0.01")


def money(n: Decimal, currency: str) -> models.Amount:
    """An amount of money, to the cent (lots at a total cost can leave long fractions)."""
    return models.Amount(number=engine.decimal_text(n.quantize(CENT)), currency=currency)


def holdings(ledger, book_id: str, account: str, on: datetime.date | None = None) -> models.Holdings:
    """What `account` (and everything under it) holds: per commodity, units, the latest price,
    value in the operating currency, cost basis, unrealized gain and lots; and the totals."""
    on = on or datetime.date.today()
    header = ledger._header(book_id)
    target = operating_currency(header)
    known = prices(ledger, book_id, on)
    declared = commodities(ledger, book_id)
    positions, _ = inventory(ledger, book_id, account)

    by_commodity: dict[str, list] = {}
    for p in positions:
        by_commodity.setdefault(p.units.currency, []).append(p)

    out: list[models.Holding] = []
    for currency, held in sorted(by_commodity.items()):
        units = sum((p.units.number for p in held), Decimal(0))
        if units == 0 and all(p.cost is None for p in held):
            continue
        lots = [p for p in held if p.cost is not None]
        cost_currencies = {p.cost.currency for p in lots}
        cost = (
            sum((p.units.number * p.cost.number for p in lots), Decimal(0))
            if lots and len(lots) == len(held) and len(cost_currencies) == 1
            else None
        )
        found = rate(currency, target, known)
        value = units * found[0] if found else None
        price_date = found[1] if found else None
        meta = declared.get(currency)
        stale = (
            price_date is not None
            and currency != target
            and (on - price_date).days > (meta.stale_after if meta else DEFAULT_STALE_AFTER)
        ) or (found is None and currency != target)
        cost_amount = money(cost, cost_currencies.pop()) if cost is not None else None
        gain = (
            money(value - cost, target)
            if value is not None and cost is not None and cost_amount.currency == target
            else None
        )
        out.append(
            models.Holding(
                commodity=currency,
                name=meta.name if meta else None,
                units=engine.decimal_text(units),
                price=(
                    models.Amount(number=engine.decimal_text(found[0]), currency=target)
                    if found and currency != target
                    else None
                ),
                price_date=price_date,
                stale=stale,
                value=money(value, target) if value is not None else None,
                cost=cost_amount,
                gain=gain,
                lots=_lots_shown(lots, units, cost, cost_amount),
            )
        )

    valued = [h for h in out if h.value is not None]
    total = sum((Decimal(h.value.number) for h in valued), Decimal(0)) if len(valued) == len(out) else None
    gains = [Decimal(h.gain.number) for h in out if h.gain is not None]
    dates = [h.price_date for h in out if h.price_date]
    return models.Holdings(
        account=account,
        currency=target,
        holdings=out,
        value=money(total, target) if total is not None else None,
        gain=money(sum(gains, Decimal(0)), target) if gains else None,
        as_of=min(dates) if dates else None,
        stale=any(h.stale for h in out),
    )


def _lots_shown(lots, units: Decimal, cost: Decimal | None, cost_amount) -> list[models.Lot]:
    """The lots, oldest first. Average-cost accounts (booked by fava-beans: sales are negative
    lots at the average) show as one lot at the average cost."""
    if any(p.units.number < 0 for p in lots) and cost is not None and units:
        return [
            models.Lot(
                units=engine.decimal_text(units),
                cost=models.Amount(number=engine.decimal_text((cost / units).quantize(Decimal("0.000001"))), currency=cost_amount.currency),
                date=None,
                label="average",
            )
        ]
    return [
        models.Lot(
            units=engine.decimal_text(p.units.number),
            cost=models.Amount(number=engine.decimal_text(p.cost.number), currency=p.cost.currency),
            date=p.cost.date,
            label=p.cost.label,
        )
        for p in sorted(lots, key=lambda p: (p.cost.date or datetime.date.min))
    ]


def valued(ledger, book_id: str, summary: models.AccountSummary, on: datetime.date | None = None) -> models.AccountSummary:
    """A summary with its value, unrealized gain and staleness filled in."""
    on = on or datetime.date.today()
    target = operating_currency(ledger._header(book_id))
    units = {a.currency: Decimal(a.number) for a in summary.balance}
    if any(currency != target for currency in units):
        h = holdings(ledger, book_id, summary.name, on)
        summary.value, summary.gain, summary.value_as_of, summary.stale = h.value, h.gain, h.as_of, h.stale
    else:
        summary.value = models.Amount(number=engine.decimal_text(units.get(target, Decimal(0))), currency=target)
    if summary.revalue_every:
        last = ledger.store.dates_with(book_id, UNREALIZED_GAINS, latest=True).get(summary.name)
        opening = summary.as_of.isoformat() if summary.as_of else None
        revalued = max(d for d in (last, opening) if d) if (last or opening) else None
        summary.revalued_on = datetime.date.fromisoformat(revalued) if revalued else None
        summary.stale = summary.revalued_on is None or (on - summary.revalued_on).days > summary.revalue_every
    return summary


def balance_on(ledger, book_id: str, account: str, date: datetime.date, currency: str) -> Decimal:
    """The account's balance in `currency` at the end of `date` (SQL)."""
    total = Decimal(0)
    for row in ledger.store.account_entries(book_id, account):
        if row["date"] > date.isoformat():
            break
        for piece in row["amounts"].split(";"):
            if piece != "?":
                number, c = piece.split(" ")
                if c == currency:
                    total += Decimal(number)
    return total


def revalue(ledger, book_id: str, account: str, r: models.RevalueIn) -> engine.Directive:
    """Record an asset's value on a date: a transaction moving its balance to `r.value`, against
    `Income:Unrealized-Gains` (a zero one if it hasn't changed, so "revalued on" still moves)."""
    current = balance_on(ledger, book_id, account, r.date, r.value.currency)
    change = Decimal(r.value.number) - current
    directives = []
    if UNREALIZED_GAINS not in {a.name for a in ledger.accounts(book_id) if not a.implicit}:
        directives += ledger._account_directives(book_id, UNREALIZED_GAINS, "leaf", None)
    t = models.TransactionIn(
        date=r.date,
        flag="*",
        narration=f"Revalued at {r.value.number} {r.value.currency}",
        meta={REVALUATION_KEY: True},
        postings=[
            models.Posting(account=account, units=models.Amount(number=engine.decimal_text(change), currency=r.value.currency)),
            models.Posting(account=UNREALIZED_GAINS),
        ],
    )
    directive = engine.transaction_directive(t)
    with ledger.store.transaction():
        ledger._write(book_id, [*directives, directive])
    return directive


def price_list(ledger, book_id: str, commodity: str) -> list[models.PriceOut]:
    """A commodity's prices, newest first."""
    ledger._header(book_id)
    return [
        models.PriceOut(
            id=r["directive_id"],
            date=datetime.date.fromisoformat(r["date"]),
            commodity=commodity,
            price=models.Amount(number=r["number"], currency=r["currency"]),
        )
        for r in ledger.store.price_history(book_id, commodity)
    ]


def add_price(ledger, book_id: str, p: models.PriceIn) -> models.PriceOut:
    """Record a price. One per commodity, quote currency and date: a second replaces the first."""
    ledger._header(book_id)
    text = f"{p.date.isoformat()} price {p.commodity} {p.price.number} {p.price.currency}\n"
    same = [
        r
        for r in ledger.store.price_history(book_id, p.commodity)
        if r["date"] == p.date.isoformat() and r["currency"] == p.price.currency
    ]
    directive = engine.parse_one(text, same[0]["directive_id"] if same else None)
    with ledger.store.transaction():
        ledger.store.put(book_id, [directive])
    return models.PriceOut(id=directive.id, date=p.date, commodity=p.commodity, price=p.price)


def commodity_list(ledger, book_id: str) -> list[models.CommodityOut]:
    """Every commodity: declared ones, and any held or priced, with the latest price."""
    target = operating_currency(ledger._header(book_id))
    declared = commodities(ledger, book_id)
    known = prices(ledger, book_id, datetime.date.today())
    seen = {c for c, _ in known} | set(declared)
    seen |= {
        r["amount_currency"]
        for r in ledger.store._conn.execute(
            "SELECT DISTINCT p.amount_currency FROM posting p JOIN directive d ON d.id = p.directive_id"
            " WHERE d.book_id = ? AND d.deleted = 0 AND p.amount_currency IS NOT NULL",
            (book_id,),
        )
    }
    out = []
    for currency in sorted(seen - {target}):
        meta = declared.get(currency)
        found = rate(currency, target, known)
        out.append(
            models.CommodityOut(
                currency=currency,
                declared=meta is not None,
                name=meta.name if meta else None,
                price_source=meta.price_source if meta else None,
                stale_after=meta.stale_after if meta else DEFAULT_STALE_AFTER,
                price=models.Amount(number=engine.decimal_text(found[0]), currency=target) if found else None,
                price_date=found[1] if found else None,
                updated_at=meta.updated_at if meta else None,
            )
        )
    return out


def set_commodity(ledger, book_id: str, currency: str, c: models.CommodityIn) -> models.CommodityOut:
    """Declare a commodity, or change its name, price source or staleness (versioned)."""
    existing = commodities(ledger, book_id).get(currency)
    if existing and c.updated_at != existing.updated_at:
        raise StaleVersion(existing.directive_id, existing.updated_at)
    meta = {k: v for k, v in ((NAME_KEY, c.name), (PRICE_SOURCE_KEY, c.price_source)) if v}
    if c.stale_after is not None and c.stale_after != DEFAULT_STALE_AFTER:
        meta[STALE_AFTER_KEY] = Decimal(c.stale_after)
    date = datetime.date(1970, 1, 1)
    if existing:
        entries, _, _ = parser.parse_string(ledger.store.get(book_id, existing.directive_id).text)
        date = entries[0].date
    entry = data.Commodity(data.new_metadata("<new>", 0, meta), date, currency)
    directive = engine.to_directive(entry, existing.directive_id if existing else None)
    with ledger.store.transaction():
        ledger.store.put(book_id, [directive])
    return next(x for x in commodity_list(ledger, book_id) if x.currency == currency)



def opening_lots(ledger, book_id: str, account: str, held: list[models.OpeningHolding], opening: models.OpeningBalance) -> list[models.Posting]:
    """The postings for holdings an account opens with: each a lot at its cost (its total, or
    the price on the opening date if unknown, labeled "estimated")."""
    known = prices(ledger, book_id, opening.date) if any(h.cost is None for h in held) else {}
    postings = []
    for h in held:
        units = Decimal(h.units)
        if h.cost is not None:
            total, label = Decimal(h.cost), None
        else:
            found = rate(h.commodity, opening.currency, known)
            if found is None:
                raise engine.ParseFailure([f"{h.commodity} has no price on {opening.date}: give its cost"])
            total, label = units * found[0], "estimated"
        postings.append(
            models.Posting(
                account=account,
                units=models.Amount(number=h.units, currency=h.commodity),
                cost=models.Cost(
                    number="0",  # with a total: `{0 # total}`, the parsed form of `{{total}}`
                    total=engine.decimal_text(total),
                    currency=opening.currency,
                    date=opening.date,
                    label=label,
                ),
            )
        )
    return postings


# Trades

FEES = "Expenses:Financial:Fees"
GAINS = {"short": "Income:Capital-Gains:Short-Term", "long": "Income:Capital-Gains:Long-Term"}


def dividends_account(commodity: str) -> str:
    return f"Income:Dividends:{engine.segment(commodity)}"


def long_term(acquired: datetime.date | None, sold: datetime.date) -> bool:
    """Held more than a year: long-term (US). A lot of unknown date counts as short-term."""
    if acquired is None:
        return False
    try:
        anniversary = acquired.replace(year=acquired.year + 1)
    except ValueError:  # Feb 29
        anniversary = acquired.replace(year=acquired.year + 1, day=28)
    return sold > anniversary


def booking_method(ledger, book_id: str, account: models.Account) -> str:
    """How sales from `account` pick lots: its own method, else the book's, else STRICT."""
    if account.booking:
        return account.booking
    for line in ledger._header(book_id):
        if line.startswith('option "booking_method"'):
            return line.split('"')[3]
    return "STRICT"


def _resolve(ledger, book_id: str, account: str, t: models.TradeIn) -> tuple[str, str]:
    """The holding and cash accounts: as given; or for an account with nothing under it, itself;
    or for a brokerage (accounts under it), its `<account>:<COMMODITY>` and `<account>:Cash`."""
    tree = {a.name: a for a in ledger.accounts(book_id)}
    if account not in tree:
        raise ledger_not_found(account)
    # Imported books often open parents plainly, so "has accounts under it" decides, not `kind`.
    if not any(name.startswith(f"{account}:") for name in tree):
        return t.holding_account or account, t.cash_account or account
    holding = t.holding_account or f"{account}:{engine.segment(t.commodity)}"
    cash = t.cash_account or f"{account}:Cash"
    return holding, cash


def ledger_not_found(name: str):
    from .service import NotFound

    return NotFound(name)


def _lots(ledger, book_id: str, holding: str, commodity: str):
    positions, _ = inventory(ledger, book_id, holding)
    return [p for p in positions if p.units.currency == commodity and p.cost is not None and p.units.number > 0]


def plan_trade(ledger, book_id: str, account: str, t: models.TradeIn) -> models.TradePreview:
    """What a trade will write, without writing it: the transaction, the lots a sale draws on
    (with each one's gain and term), and the accounts it will open."""
    target = operating_currency(ledger._header(book_id))
    holding, cash = _resolve(ledger, book_id, account, t)
    tree = {a.name: a for a in ledger.accounts(book_id)}
    fees = Decimal(t.fees or "0")
    money = lambda n: models.Amount(number=engine.decimal_text(n), currency=target)  # noqa: E731
    postings: list[models.Posting] = []
    drawn: list[models.DrawnLot] = []
    narration = t.narration

    if t.kind == "buy":
        units, price = Decimal(t.units), Decimal(t.price)
        postings = [
            models.Posting(
                account=holding,
                units=models.Amount(number=t.units, currency=t.commodity),
                cost=models.Cost(number=t.price, currency=target),
            ),
            models.Posting(account=cash, units=money(-(units * price + fees))),
        ]
        narration = narration or f"Buy {t.units} {t.commodity}"
    elif t.kind == "sell":
        units, price = Decimal(t.units), Decimal(t.price)
        method = booking_method(ledger, book_id, tree.get(holding) or tree[account])
        lots = _lots(ledger, book_id, holding, t.commodity)
        held = sum((p.units.number for p in lots), Decimal(0))
        if units > held:
            raise engine.ParseFailure([f"only {engine.decimal_text(held)} {t.commodity} held in {holding}"])
        if method == "NONE":  # average cost, booked here
            average = sum((p.units.number * p.cost.number for p in lots), Decimal(0)) / held
            average = average.quantize(Decimal("0.000001"))
            order = sorted(lots, key=lambda p: p.cost.date or datetime.date.min)  # FIFO for terms
            remaining = units
            for p in order:
                n = min(remaining, p.units.number)
                if n <= 0:
                    break
                drawn.append(_drawn(n, average, target, p.cost.date, price, t.date))
                remaining -= n
            postings.append(
                models.Posting(
                    account=holding,
                    units=models.Amount(number=engine.decimal_text(-units), currency=t.commodity),
                    cost=models.Cost(number=engine.decimal_text(average), currency=target),
                    price=models.Amount(number=t.price, currency=target),
                )
            )
        else:
            if method == "STRICT":
                if not t.lots:
                    raise engine.ParseFailure(["this account sells specific lots: choose which"])
                chosen = []
                for ref in t.lots:
                    match = next(
                        (p for p in lots if p.cost.date == ref.date and p.cost.number == Decimal(ref.cost)), None
                    )
                    if match is None or Decimal(ref.units) > match.units.number:
                        raise engine.ParseFailure([f"no lot of {ref.units} {t.commodity} at {ref.cost} on {ref.date}"])
                    chosen.append((match, Decimal(ref.units)))
                if sum((n for _, n in chosen), Decimal(0)) != units:
                    raise engine.ParseFailure(["the chosen lots don't add up to the units sold"])
            else:
                key = {
                    "FIFO": lambda p: (p.cost.date or datetime.date.min, p.cost.number),
                    "LIFO": lambda p: (-(p.cost.date or datetime.date.min).toordinal(), p.cost.number),
                    "HIFO": lambda p: (-p.cost.number, p.cost.date or datetime.date.min),
                }[method]
                chosen, remaining = [], units
                for p in sorted(lots, key=key):
                    if remaining <= 0:
                        break
                    n = min(remaining, p.units.number)
                    chosen.append((p, n))
                    remaining -= n
            for p, n in chosen:
                drawn.append(_drawn(n, p.cost.number, p.cost.currency, p.cost.date, price, t.date, p.cost.label))
                postings.append(
                    models.Posting(
                        account=holding,
                        units=models.Amount(number=engine.decimal_text(-n), currency=t.commodity),
                        cost=models.Cost(
                            number=engine.decimal_text(p.cost.number),
                            currency=p.cost.currency,
                            date=p.cost.date,
                            label=p.cost.label,
                        ),
                        price=models.Amount(number=t.price, currency=target),
                    )
                )
        postings.append(models.Posting(account=cash, units=money(units * price - fees)))
        for term in ("short", "long"):
            gain = sum((Decimal(d.gain.number) for d in drawn if d.term == term), Decimal(0))
            if gain:
                postings.append(models.Posting(account=GAINS[term], units=money(-gain)))
        narration = narration or f"Sell {t.units} {t.commodity}"
    else:  # dividend
        amount = Decimal(t.amount)
        postings = [
            models.Posting(account=cash, units=money(amount)),
            models.Posting(account=dividends_account(t.commodity), units=money(-amount)),
        ]
        narration = narration or f"Dividend from {t.commodity}"
        if t.units:  # reinvested
            units, price = Decimal(t.units), Decimal(t.price)
            postings += [
                models.Posting(
                    account=holding,
                    units=models.Amount(number=t.units, currency=t.commodity),
                    cost=models.Cost(number=t.price, currency=target),
                ),
                models.Posting(account=cash, units=money(-(units * price))),
            ]
            narration = t.narration or f"Dividend from {t.commodity}, reinvested"
    if fees:
        postings.append(models.Posting(account=FEES, units=money(fees)))

    transaction = models.TransactionIn(date=t.date, flag="*", narration=narration, postings=postings)
    opens = sorted({p.account for p in postings} - {a.name for a in tree.values() if not a.implicit})
    return models.TradePreview(transaction=transaction, lots=drawn, opens=opens)


def _drawn(n, cost, currency, acquired, price, sold, label=None) -> models.DrawnLot:
    term = "long" if long_term(acquired, sold) else "short"
    return models.DrawnLot(
        units=engine.decimal_text(n),
        cost=models.Amount(number=engine.decimal_text(cost), currency=currency),
        date=acquired,
        label=label,
        term=term,
        gain=models.Amount(number=engine.decimal_text(n * (price - cost)), currency=currency),
    )


def trade(ledger, book_id: str, account: str, t: models.TradeIn) -> engine.Directive:
    """Write a trade, after checking it books: opening any accounts it needs (a holding's leaf,
    fees, gains, dividends) in the same write."""
    plan = plan_trade(ledger, book_id, account, t)
    holding, _ = _resolve(ledger, book_id, account, t)
    opened: dict[str, engine.Directive] = {}
    for name in plan.opens:
        commodity = [t.commodity] if name == holding else None
        for d in ledger._account_directives(book_id, name, "leaf", None, currencies=commodity):
            opened.setdefault(engine.opened(d.text), d)  # two gains accounts share a parent
    directives = list(opened.values())
    directive = engine.transaction_directive(plan.transaction)
    _, problems = SCOPED.entries(ledger, book_id, holding, [d.text for d in directives] + [directive.text])
    mine = [p.message for p in problems if p.directive_id == directive.id]
    if mine:
        raise engine.ParseFailure(mine)
    with ledger.store.transaction():
        ledger._write(book_id, [*directives, directive])
    return directive

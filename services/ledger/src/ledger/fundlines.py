"""A transaction's fund lines: what they may say, and what a transaction does to each fund.

- **Funds read a transaction one commodity at a time** (Funds B): each commodity's change is the
  sum of its asset and liability postings' units. More of it is money *in* (lines go *to* funds,
  `+`); less is money *out* (lines come *from* them, `-`); none changed overall but some moved is a
  *transfer* (lines put it *toward* funds, `+`, and may take from them too, `-`). A buy is dollars
  out and shares in; a sale, shares out and dollars in. Its **size** is what came in or went out,
  or for a transfer what moved. With one commodity on the balance sheet, this is Funds A.
- **Lines add up to no more than its size,** each way, per commodity. A fund appears once per
  commodity, so a trade can be one fund's: `Emergency -3000.00 USD; Emergency +10 VTI`.
- **Each balance-sheet split counts for its account's default fund** (a dated `fund-default`), or
  Unallocated where there's none; a line takes over from the side it's on (a `+` line from the
  splits that went up, a `-` line from those that went down), and the rest stays with their
  defaults. With no defaults, that's Funds A: what lines don't say is Unallocated's.
- **Lines are checked only when they change,** so recategorizing, reconciling or pairing a
  transaction can't fail because of its funds; a page shows lines that no longer fit.
- **No fund goes below zero in a share by hand** (`guard`): what came in by itself (`app`'s
  imports, bank feeds, receipts and schedules, written as staging) may, and is listed as short.
"""

from __future__ import annotations

import datetime
import re
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

from . import engine, investments, models

if TYPE_CHECKING:
    from .store import Store

UNALLOCATED = engine.UNALLOCATED
_NOT_IN_NAMES = re.compile(r'[;"\\/]')

Split = tuple[str, Decimal, str]
"""A balance-sheet posting as funds see it: account, units, commodity."""
Line = tuple[str, Decimal, str]
"""A fund line: fund, signed number, commodity."""


class FundRefused(ValueError):
    """A fund change that isn't allowed: the input's problem (422)."""


def valid_name(name: str) -> str:
    """A fund's name as it's kept: trimmed, inner spaces made one. Refused if it's empty, too long,
    holds `;`, `"`, `\\` or `/`, or is Unallocated."""
    clean = " ".join(name.split())
    if not clean:
        raise FundRefused("a fund needs a name")
    if len(clean) > 60:
        raise FundRefused("a fund's name is at most 60 characters")
    if _NOT_IN_NAMES.search(clean):
        raise FundRefused('a fund\'s name can\'t hold ; " \\ or /')
    if clean.casefold() == UNALLOCATED.casefold():
        raise FundRefused("Unallocated is what isn't in a fund: it can't be a fund's name")
    return clean


@dataclass(frozen=True)
class Shape:
    """One commodity of a transaction as funds see it: its kind and its size."""

    kind: Literal["in", "out", "transfer"] | None
    size: Decimal
    currency: str


def balance_sheet_roots(header: list[str]) -> set[str]:
    return {root for root, type_ in engine.root_types(header).items() if type_ in ("asset", "liability")}


def splits(text: str, header: list[str]) -> list[Split] | None:
    """A transaction's balance-sheet postings (None when only full booking could say)."""
    return engine.balance_sheet_units(text, balance_sheet_roots(header))


def shapes_of(found: list[Split] | None) -> dict[str, Shape] | None:
    """Each commodity's kind and size; None when the splits can't be read."""
    if found is None:
        return None
    out: dict[str, Shape] = {}
    for currency in dict.fromkeys(c for _, _, c in found):
        mine = [n for _, n, c in found if c == currency]
        delta = sum(mine, Decimal(0))
        if delta > 0:
            out[currency] = Shape("in", delta, currency)
        elif delta < 0:
            out[currency] = Shape("out", -delta, currency)
        else:
            out[currency] = Shape("transfer", sum((n for n in mine if n > 0), Decimal(0)), currency)
    return out


def shapes(text: str, header: list[str]) -> dict[str, Shape] | None:
    return shapes_of(splits(text, header))


def amount_text(number: Decimal, currency: str, operating: str) -> str:
    """Money with its cents ("1,200.00 USD"); anything else as it's written ("12 VTI")."""
    if currency == operating:
        return f"{number:,.2f} {currency}"
    return f"{engine.decimal_text(number)} {currency}"


def lines_problem(found: dict[str, Shape] | None, lines: Iterable[Line], operating: str) -> str | None:
    """What's wrong with these lines on a transaction of these shapes, if anything. Lines on a
    transaction that can't be read aren't checked."""
    if found is None:
        return None
    lines = list(lines)
    for fund, _, currency in lines:
        if currency not in found:
            return f"it moves no {currency} ({fund})"

    def text(n: Decimal, c: str) -> str:
        return amount_text(n, c, operating)

    for currency, s in found.items():
        mine = [(f, n) for f, n, c in lines if c == currency]
        into = sum((n for _, n in mine if n > 0), Decimal(0))
        out_of = -sum((n for _, n in mine if n < 0), Decimal(0))
        taken = next((f for f, n in mine if n < 0), None)
        given = next((f for f, n in mine if n > 0), None)
        if s.kind == "in":
            if taken:
                return f"money coming in goes to funds, not from them ({taken})"
            if into > s.size:
                return f"its funds get {text(into, currency)}, more than the {text(s.size, currency)} that came in"
        elif s.kind == "out":
            if given:
                return f"money going out comes from funds, not to them ({given})"
            if out_of > s.size:
                return f"its funds give {text(out_of, currency)}, more than the {text(s.size, currency)} that went out"
        else:
            if into > s.size:
                return f"its funds get {text(into, currency)}, more than the {text(s.size, currency)} it moves"
            if out_of > s.size:
                return f"its funds give {text(out_of, currency)}, more than the {text(s.size, currency)} it moves"
    return None


# Default funds (Funds B)


def _parents(account: str) -> list[str]:
    parts = account.split(":")
    return [":".join(parts[:i]) for i in range(len(parts), 0, -1)]


class Defaults:
    """The book's default funds: for each account, its dated `fund-default` directives."""

    def __init__(self, entries: Iterable[tuple[str, engine.FundDefault]] = ()):
        self.entries = sorted(entries, key=lambda e: (e[1].account, e[1].date))
        self._by_account: dict[str, list[engine.FundDefault]] = defaultdict(list)
        for _, d in self.entries:
            self._by_account[d.account].append(d)

    @classmethod
    def load(cls, store: Store, book_id: str) -> Defaults:
        found = []
        for row in store.find(book_id, kind="custom", limit=None):
            d = row.text and f'"{engine.FUND_DEFAULT_TYPE}"' in row.text and engine.default_of(row.text)
            if d:
                found.append((row.id, d))
        return cls(found)

    def fund_for(self, account: str, on: datetime.date) -> str:
        """The fund `account`'s unmarked changes on `on` belong to: the nearest account (itself,
        then up) whose latest default by then names one; else Unallocated. A default of none
        leaves it to the accounts above."""
        for a in _parents(account):
            latest = None
            for d in self._by_account.get(a, ()):
                if d.date <= on:
                    latest = d
            if latest and latest.fund:
                return latest.fund
        return UNALLOCATED

    def accounts(self) -> set[str]:
        """Accounts with a default naming a fund at some point (and so, everything under them)."""
        return {d.account for _, d in self.entries if d.fund and d.fund != UNALLOCATED}

    def replaced(self, directive_id: str | None, d: engine.FundDefault | None) -> Defaults:
        """These defaults with one changed (`directive_id`), added (no ID) or removed (no `d`)."""
        kept = [(i, e) for i, e in self.entries if i != directive_id]
        return Defaults(kept + ([(directive_id or "new", d)] if d else []))


def effects(found: list[Split], lines: Iterable[Line], fund_for: Callable[[str], str]) -> dict[tuple[str, str], Decimal]:
    """What a transaction does to each fund (Unallocated included), per commodity: its lines, and
    the rest of each side by its accounts' defaults, in proportion to their splits."""
    lines = list(lines)
    out: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
    for fund, number, currency in lines:
        out[(fund, currency)] += number
    for currency in dict.fromkeys(c for _, _, c in found):
        for sign in (1, -1):
            side = [(a, n) for a, n, c in found if c == currency and n * sign > 0]
            total = sum((n for _, n in side), Decimal(0))
            taken = sum((n for _, n, c in lines if c == currency and n * sign > 0), Decimal(0))
            rest = total - taken
            if not side or rest * sign <= 0:
                continue
            by_fund: dict[str, Decimal] = defaultdict(Decimal)
            for account, n in side:
                by_fund[fund_for(account)] += n
            if len(by_fund) == 1:
                out[(next(iter(by_fund)), currency)] += rest
                continue
            places = max(-n.as_tuple().exponent for _, n in side)
            quantum = Decimal(1).scaleb(-places)
            given = Decimal(0)
            largest = max(by_fund, key=lambda f: abs(by_fund[f]))
            for fund, n in by_fund.items():
                if fund != largest:
                    share = (rest * n / total).quantize(quantum)
                    out[(fund, currency)] += share
                    given += share
            out[(largest, currency)] += rest - given
    return {k: v for k, v in out.items() if v != 0}


def _transaction_effects(
    found: list[Split] | None, lines: Iterable[Line], date: datetime.date, defaults: Defaults
) -> dict[tuple[str, str], Decimal]:
    lines = list(lines)
    if found is None:
        # Unreadable: its lines are all funds can say about it.
        out: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
        for fund, number, currency in lines:
            out[(fund, currency)] += number
        return dict(out)
    return effects(found, lines, lambda a: defaults.fund_for(a, date))


def _rows_splits(postings: list[tuple[str, Decimal | None, str]], roots: set[str]) -> list[Split] | None:
    found = []
    for account, number, currency in postings:
        if account.split(":", 1)[0] not in roots:
            continue
        if number is None:
            return None
        found.append((account, number, currency))
    return found


def default_parts(
    store: Store, book_id: str, header: list[str], defaults: Defaults
) -> list[tuple[dict, dict[tuple[str, str], Decimal]]]:
    """Each transaction touching an account with a default fund, with what its defaults give
    funds (beyond its lines): its effects less its lines, Unallocated left out."""
    if not defaults.accounts():
        return []
    roots = balance_sheet_roots(header)
    out = []
    for t in store.transactions_touching(book_id, accounts=defaults.accounts()):
        date = datetime.date.fromisoformat(t["date"])
        found = _rows_splits(t["postings"], roots)
        if found is None:
            continue
        parts = effects(found, t["lines"], lambda a: defaults.fund_for(a, date))
        for fund, number, currency in t["lines"]:
            parts[(fund, currency)] = parts.get((fund, currency), Decimal(0)) - number
        parts = {k: v for k, v in parts.items() if v != 0 and k[0] != UNALLOCATED}
        if parts:
            out.append((t, parts))
    return out


def fund_totals(
    store: Store, book_id: str, header: list[str], defaults: Defaults | None = None
) -> dict[tuple[str, str], Decimal]:
    """What every fund holds, per commodity: its lines, its moves, and what defaults give it.
    Keyed by the fund's name as written (any case) and commodity."""
    defaults = defaults if defaults is not None else Defaults.load(store, book_id)
    totals: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
    for r in store.fund_lines(book_id):
        totals[(r["fund"], r["currency"])] += Decimal(r["amount"])
    for _, parts in default_parts(store, book_id, header, defaults):
        for key, number in parts.items():
            totals[key] += number
    return dict(totals)


def share_holdings(
    store: Store,
    book_id: str,
    header: list[str],
    defaults: Defaults | None = None,
    currencies: set[str] | None = None,
) -> dict[tuple[str, str], Decimal]:
    """What each fund holds of commodities but the operating currency (`currencies`, or those
    funds hold), by casefolded name, with Unallocated's: what the accounts hold that no fund
    does. Only those commodities' postings are read, so a book with no shares in funds reads
    none."""
    operating = investments.operating_currency(header)
    held: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
    for (fund, currency), number in fund_totals(store, book_id, header, defaults).items():
        if currency != operating and (currencies is None or currency in currencies):
            held[(fund.casefold(), currency)] += number
    wanted = {c for _, c in held} if currencies is None else currencies - {operating}
    accounts = store.balance_sheet_totals(book_id, balance_sheet_roots(header), wanted)
    for currency in wanted:
        in_funds = sum((n for (_, c), n in held.items() if c == currency), Decimal(0))
        held[(UNALLOCATED.casefold(), currency)] = accounts.get(currency, Decimal(0)) - in_funds
    return dict(held)


def _named(store: Store, book_id: str) -> dict[str, str]:
    names = {UNALLOCATED.casefold(): UNALLOCATED}
    for key, (_, decl) in declared(store, book_id).items():
        names[key] = decl.name
    return names


def _lines_of(t: models.TransactionIn) -> list[Line]:
    return [(f.fund, Decimal(f.amount.number), f.amount.currency) for f in t.funds or []]


def text_effects(text: str, header: list[str], defaults: Defaults) -> dict[tuple[str, str], Decimal]:
    """What a transaction's text does to each fund (by casefolded name), per commodity."""
    directive = engine.parse_one(text)
    lines = list(directive.funds)
    out: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
    for (fund, currency), n in _transaction_effects(splits(text, header), lines, directive.date, defaults).items():
        out[(fund.casefold(), currency)] += n
    return dict(out)


def _has_shares(text: str, header: list[str], operating: str) -> bool:
    """Whether a transaction moves (or has lines in) anything but the operating currency."""
    found = splits(text, header) or []
    return any(c != operating for _, _, c in found) or any(c != operating for _, _, c in engine.parse_one(text).funds)


def guard(
    store: Store,
    book_id: str,
    header: list[str],
    changes: list[tuple[str | None, str | None]],
    confirming: Iterable[str] = (),
) -> None:
    """Refuse a write by hand that would leave a fund short of a share: a transaction written,
    changed or confirmed that takes more of one from a fund than the fund holds, or a deletion
    that leaves a fund below zero in one. `changes` are each transaction's text before and after
    (None: not there); `confirming`, the after-texts being confirmed."""
    operating = investments.operating_currency(header)
    if not any(_has_shares(text, header, operating) for pair in changes for text in pair if text):
        return
    defaults = Defaults.load(store, book_id)
    confirming = set(confirming)
    delta: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
    checked: list[dict[tuple[str, str], Decimal]] = []
    for before, after in changes:
        old = {k: v for k, v in text_effects(before, header, defaults).items() if k[1] != operating} if before else {}
        new = {k: v for k, v in text_effects(after, header, defaults).items() if k[1] != operating} if after else {}
        for k, v in old.items():
            delta[k] -= v
        for k, v in new.items():
            delta[k] += v
        if after is not None and (new != old or after in confirming):
            checked.append(new)
    if not any(delta.values()) and not any(any(v < 0 for v in e.values()) for e in checked):
        return
    holdings = share_holdings(
        store, book_id, header, defaults, {c for _, c in delta} | {c for e in checked for _, c in e}
    )
    names = _named(store, book_id)

    def held_after(key: tuple[str, str]) -> Decimal:
        return holdings.get(key, Decimal(0)) + delta.get(key, Decimal(0))

    for new in checked:
        for key, n in new.items():
            if n < 0 and held_after(key) < 0:
                fund, currency = key
                had = held_after(key) - n
                raise FundRefused(
                    f"it takes {amount_text(-n, currency, operating)} from {names.get(fund, fund)}, which has "
                    f"{amount_text(had, currency, operating)}: say which fund's {currency} it is"
                )
    for key, d in delta.items():
        if d < 0 and held_after(key) < 0:
            fund, currency = key
            raise FundRefused(
                f"it would leave {names.get(fund, fund)} at {amount_text(held_after(key), currency, operating)}"
            )


def short(store: Store, book_id: str, header: list[str]) -> list[tuple[dict, list[tuple[str, str, Decimal, Decimal]]]]:
    """The transactions that take a share from a fund that's below zero in it: each one, with
    (fund, commodity, what it takes, what the fund holds) for each."""
    defaults = Defaults.load(store, book_id)
    holdings = share_holdings(store, book_id, header, defaults)
    below = {k: v for k, v in holdings.items() if v < 0}
    if not below:
        return []
    names = _named(store, book_id)
    roots = balance_sheet_roots(header)
    out = []
    for t in store.transactions_touching(book_id, currencies={c for _, c in below}):
        date = datetime.date.fromisoformat(t["date"])
        found = _rows_splits(t["postings"], roots)
        raw = _transaction_effects(found, t["lines"], date, defaults)
        mine = defaultdict(Decimal)
        for (fund, currency), n in raw.items():
            mine[(fund.casefold(), currency)] += n
        taken = [
            (names.get(fund, fund), currency, -n, below[(fund, currency)])
            for (fund, currency), n in mine.items()
            if n < 0 and (fund, currency) in below
        ]
        if taken:
            out.append((t, taken))
    return out


def declared(store: Store, book_id: str) -> dict[str, tuple[str, engine.FundDeclaration]]:
    """The book's funds by casefolded name: each one's directive ID and declaration."""
    found = {}
    for row in store.find(book_id, kind="custom", limit=None):
        decl = row.text and f'custom "{engine.FUND_TYPE}"' in row.text and engine.fund_of(row.text)
        if decl:
            found[decl.name.casefold()] = (row.id, decl)
    return found


def _key(lines: list[models.FundLine] | None) -> list[tuple[str, Decimal, str]]:
    return [(" ".join(f.fund.split()).casefold(), Decimal(f.amount.number), f.amount.currency) for f in lines or []]


def checked(
    store: Store,
    book_id: str,
    header: list[str],
    t: models.TransactionIn,
    current: models.TransactionIn | None = None,
) -> models.TransactionIn:
    """`t` with its fund lines named as their funds are, if they're allowed; refused
    (FundRefused) if not. Lines that haven't changed from `current`'s aren't checked."""
    if _key(t.funds) == _key(current.funds if current else None):
        return t
    funds = declared(store, book_id)
    operating = investments.operating_currency(header)
    before = {f.fund.casefold() for f in (current.funds or [])} if current else set()
    lines: list[models.FundLine] = []
    for line in t.funds or []:
        name = " ".join(line.fund.split())
        if name.casefold() == UNALLOCATED.casefold():
            raise FundRefused("Unallocated isn't a fund to choose: it's what isn't in one")
        found = funds.get(name.casefold())
        if found is None:
            raise FundRefused(f"there's no fund called {name}")
        decl = found[1]
        if decl.archived and decl.name.casefold() not in before:
            raise FundRefused(f"{decl.name} is archived")
        if any(f.fund == decl.name and f.amount.currency == line.amount.currency for f in lines):
            raise FundRefused(
                f"{decl.name} is in it twice"
                + (f" in {line.amount.currency}" if line.amount.currency != operating else "")
            )
        if Decimal(line.amount.number) == 0:
            raise FundRefused(f"{decl.name}'s amount can't be 0")
        lines.append(models.FundLine(fund=decl.name, amount=line.amount))
    t = t.model_copy(update={"funds": lines})
    problem = lines_problem(shapes(engine.transaction_directive(t).text, header), _lines_of(t), operating)
    if problem:
        raise FundRefused(problem)
    return t

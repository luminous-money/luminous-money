"""A transaction's fund lines (Funds A): what they may say, checked when they change.

- **What kind of transaction it is** comes from its change in net worth: the sum of its asset and
  liability postings, weighed as booking would, in the operating currency. Money in (income, a
  refund) goes *to* funds (`+` lines); money out comes *from* them (`-`); a transfer (between your
  own accounts, paying a card, a trade) puts money *toward* them (`+`), and may take from them too
  (`-`, the advanced form). Its **size** is what came in or went out, or for a transfer what moved.
- **Lines add up to no more than its size,** each way. Unallocated is never a line: it's what
  isn't in a fund.
- **Checked only when they change,** so recategorizing, reconciling or pairing a transaction can't
  fail because of its funds; a page shows lines that no longer fit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

from . import engine, investments, models

if TYPE_CHECKING:
    from .store import Store

UNALLOCATED = engine.UNALLOCATED
_NOT_IN_NAMES = re.compile(r'[;"\\/]')


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
    """A transaction as funds see it: its kind (None: only full booking could say, or it's in
    another currency) and its size, in the operating currency."""

    kind: Literal["in", "out", "transfer"] | None
    size: Decimal
    currency: str


def balance_sheet_roots(header: list[str]) -> set[str]:
    return {root for root, type_ in engine.root_types(header).items() if type_ in ("asset", "liability")}


def shape(text: str, header: list[str]) -> Shape:
    currency = investments.operating_currency(header)
    weights = engine.balance_sheet_weights(text, balance_sheet_roots(header))
    if weights is None or any(c != currency for _, c in weights):
        return Shape(None, Decimal(0), currency)
    delta = sum((n for n, _ in weights), Decimal(0))
    if delta > 0:
        return Shape("in", delta, currency)
    if delta < 0:
        return Shape("out", -delta, currency)
    return Shape("transfer", sum((n for n, _ in weights if n > 0), Decimal(0)), currency)


def _money(number: Decimal, currency: str) -> str:
    return f"{number:,.2f} {currency}"


def lines_problem(s: Shape, lines: list[tuple[str, Decimal]]) -> str | None:
    """What's wrong with these lines (fund, signed number) on a transaction of this shape, if
    anything. Lines on a transaction of unknown shape aren't checked."""
    if s.kind is None:
        return None
    into = sum((n for _, n in lines if n > 0), Decimal(0))
    out_of = -sum((n for _, n in lines if n < 0), Decimal(0))
    taken = next((f for f, n in lines if n < 0), None)
    given = next((f for f, n in lines if n > 0), None)
    if s.kind == "in":
        if taken:
            return f"money coming in goes to funds, not from them ({taken})"
        if into > s.size:
            return f"its funds get {_money(into, s.currency)}, more than the {_money(s.size, s.currency)} that came in"
    elif s.kind == "out":
        if given:
            return f"money going out comes from funds, not to them ({given})"
        if out_of > s.size:
            return f"its funds give {_money(out_of, s.currency)}, more than the {_money(s.size, s.currency)} that went out"
    else:
        if into > s.size:
            return f"its funds get {_money(into, s.currency)}, more than the {_money(s.size, s.currency)} it moves"
        if out_of > s.size:
            return f"its funds give {_money(out_of, s.currency)}, more than the {_money(s.size, s.currency)} it moves"
    return None


def declared(store: Store, book_id: str) -> dict[str, tuple[str, engine.FundDeclaration]]:
    """The book's funds by casefolded name: each one's directive ID and declaration."""
    found = {}
    for row in store.find(book_id, kind="custom", limit=None):
        decl = row.text and engine.fund_of(row.text)
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
    currency = investments.operating_currency(header)
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
        if any(f.fund == decl.name for f in lines):
            raise FundRefused(f"{decl.name} is in it twice")
        if Decimal(line.amount.number) == 0:
            raise FundRefused(f"{decl.name}'s amount can't be 0")
        if line.amount.currency != currency:
            raise FundRefused(f"funds hold {currency} for now")
        lines.append(models.FundLine(fund=decl.name, amount=line.amount))
    t = t.model_copy(update={"funds": lines})
    problem = lines_problem(
        shape(engine.transaction_directive(t).text, header), [(f.fund, Decimal(f.amount.number)) for f in lines]
    )
    if problem:
        raise FundRefused(problem)
    return t

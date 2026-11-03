"""Funds (Funds A): what money is for, as a ledger of its own beside the accounts (where it is).

- **A fund is a `custom "fund"` directive:** its name, and as metadata its `description`, a
  `target` (shown as progress; nothing fills it) and the date it was `archived`.
- **What a fund holds** is the sum of its lines (on transactions, `funds:`; see `fundlines`) and
  of moves between funds (`custom "fund-move"`), read from the derived `fund_line` table, per
  commodity (only the operating currency, for now), and valued in the operating currency.
- **Unallocated** is net worth less every fund: what isn't in one. Never written, only worked
  out. Net worth is the chart's own figure: every asset and liability, valued.
- **Renaming** rewrites the fund's directive, every transaction with a line for it and every move
  naming it, in one write. **Archiving** moves what's left (on the day, to Unallocated or another
  fund) and takes it out of the pickers; its history stays. **Deleting** is only for a fund with
  no history.
- Setting funds up is a manager's; tagging transactions and moving money, anyone who can write.
"""

from __future__ import annotations

import dataclasses
import datetime
from collections import defaultdict
from decimal import Decimal

from . import chart, engine, fundlines, investments, models
from .fundlines import UNALLOCATED, FundRefused
from .service import Ledger, NotFound


def _amount(number: Decimal, currency: str) -> models.Amount:
    return models.Amount(number=engine.decimal_text(number), currency=currency)


def _find(ledger: Ledger, book_id: str, name: str) -> tuple[str, engine.FundDeclaration]:
    """A declared fund's directive ID and declaration, by name (any case)."""
    found = fundlines.declared(ledger.store, book_id).get(" ".join(name.split()).casefold())
    if found is None:
        raise NotFound(name)
    return found


def _check_target(ledger: Ledger, book_id: str, target: models.Amount | None) -> tuple[Decimal, str] | None:
    if target is None:
        return None
    currency = investments.operating_currency(ledger._header(book_id))
    if target.currency != currency:
        raise FundRefused(f"a target is in {currency}")
    number = Decimal(target.number)
    if number <= 0:
        raise FundRefused("a target is more than 0")
    return number, currency


def listing(ledger: Ledger, book_id: str, on: datetime.date | None = None) -> models.Funds:
    """Every fund (declared ones, and any only used, as in an imported book), with what it holds
    and its value; net worth, and Unallocated. Values at `on`'s prices (today's by default)."""
    on = on or datetime.date.today()
    header = ledger._header(book_id)
    currency = investments.operating_currency(header)
    known = investments.prices(ledger, book_id, on)
    held: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    entries: dict[str, int] = defaultdict(int)
    names: dict[str, str] = {}
    for r in ledger.store.fund_lines(book_id):
        key = r["fund"].casefold()
        names.setdefault(key, r["fund"])
        held[key][r["currency"]] += Decimal(r["amount"])
        entries[key] += 1
    versions = {r.id: r.updated_at for r in ledger.store.find(book_id, kind="custom", limit=None)}
    declared = fundlines.declared(ledger.store, book_id)

    def value_of(holdings: dict[str, Decimal]) -> Decimal:
        total = Decimal(0)
        for c, n in holdings.items():
            found = investments.rate(c, currency, known)
            if found is not None:
                total += n * found[0]
        return total.quantize(Decimal("0.01"))

    funds = []
    for key in sorted({*declared, *names}):
        directive_id, decl = declared.get(key, (None, None))
        holdings = {c: n for c, n in held.get(key, {}).items() if n != 0}
        funds.append(
            models.Fund(
                name=decl.name if decl else names[key],
                description=decl.description if decl else None,
                target=_amount(*decl.target) if decl and decl.target else None,
                created=decl.date if decl else None,
                archived=decl.archived if decl else None,
                holdings=[_amount(n, c) for c, n in sorted(holdings.items())],
                value=_amount(value_of(holdings), currency),
                entries=entries.get(key, 0),
                updated_at=versions.get(directive_id) if directive_id else None,
            )
        )
    funds.sort(key=lambda f: (f.archived is not None, f.name.casefold()))
    tops = [a for a in chart.tree(ledger, book_id, on) if ":" not in a.name and a.type in ("asset", "liability")]
    net_worth = sum((Decimal(a.value.number) for a in tops), Decimal(0))
    in_funds = sum((Decimal(f.value.number) for f in funds), Decimal(0))
    return models.Funds(
        on=on,
        currency=currency,
        net_worth=_amount(net_worth, currency),
        unallocated=_amount(net_worth - in_funds, currency),
        unpriced=sorted({u for a in tops for u in a.unpriced}),
        funds=funds,
    )


def get(ledger: Ledger, book_id: str, name: str) -> models.Fund:
    key = " ".join(name.split()).casefold()
    found = next((f for f in listing(ledger, book_id).funds if f.name.casefold() == key), None)
    if found is None:
        raise NotFound(name)
    return found


def create(ledger: Ledger, book_id: str, f: models.FundIn) -> models.Fund:
    name = fundlines.valid_name(f.name)
    taken = fundlines.declared(ledger.store, book_id).get(name.casefold())
    if taken:
        raise FundRefused(f"there's a fund called {taken[1].name} already")
    decl = engine.FundDeclaration(
        name=name,
        date=datetime.date.today(),
        description=(f.description or "").strip() or None,
        target=_check_target(ledger, book_id, f.target),
    )
    ledger._insert(book_id, engine.fund_directive(decl))
    return get(ledger, book_id, name)


def patch(ledger: Ledger, book_id: str, name: str, p: models.FundPatch) -> models.Fund:
    """Change a fund's description or target (only those given; null clears one)."""
    directive_id, decl = _find(ledger, book_id, name)
    changes = p.model_dump(exclude_unset=True, exclude={"updated_at"})
    if "description" in changes:
        decl = dataclasses.replace(decl, description=(p.description or "").strip() or None)
    if "target" in changes:
        decl = dataclasses.replace(decl, target=_check_target(ledger, book_id, p.target))
    ledger._put(book_id, engine.fund_directive(decl, directive_id), p.updated_at)
    return get(ledger, book_id, decl.name)


def rename(ledger: Ledger, book_id: str, name: str, r: models.FundRename) -> models.Fund:
    """Rename a fund everywhere it's named, history included, in one write."""
    directive_id, decl = _find(ledger, book_id, name)
    to = fundlines.valid_name(r.to)
    taken = fundlines.declared(ledger.store, book_id).get(to.casefold())
    if taken and to.casefold() != decl.name.casefold():
        raise FundRefused(f"there's a fund called {taken[1].name} already")
    old = decl.name
    with ledger.store.transaction():
        ledger.store.check_version(book_id, directive_id, r.updated_at)
        directives = [engine.fund_directive(dataclasses.replace(decl, name=to), directive_id)]
        for row in ledger.store.fund_users(book_id, old):
            if row.kind == "transaction":
                lines = [(to if f == old else f, n, c) for f, n, c in engine.parse_one(row.text, row.id).funds]
                directives.append(engine.with_funds(row.text, lines))
            else:
                m = engine.move_of(row.text)
                if m is None:
                    continue
                moved = dataclasses.replace(
                    m,
                    from_fund=to if m.from_fund == old else m.from_fund,
                    to_fund=to if m.to_fund == old else m.to_fund,
                )
                directives.append(engine.move_directive(moved, row.id))
        ledger.store.put(book_id, directives)
    return get(ledger, book_id, to)


def _other_side(ledger: Ledger, book_id: str, name: str, keep: str | None = None) -> str:
    """A move's other side, as it's kept: Unallocated, or an active fund (an archived one only if
    it's `keep`, the side the move already had)."""
    clean = " ".join(name.split())
    if clean.casefold() == UNALLOCATED.casefold():
        return UNALLOCATED
    found = fundlines.declared(ledger.store, book_id).get(clean.casefold())
    if found is None:
        raise FundRefused(f"there's no fund called {clean}")
    decl = found[1]
    if decl.archived and decl.name != keep:
        raise FundRefused(f"{decl.name} is archived")
    return decl.name


def archive(ledger: Ledger, book_id: str, name: str, a: models.FundArchive) -> models.Fund:
    """Archive a fund on a day (today by default), no earlier than its last entry: what's left in
    it moves to `a.to` (Unallocated, or an active fund) that day, and it leaves the pickers."""
    directive_id, decl = _find(ledger, book_id, name)
    if decl.archived:
        raise FundRefused(f"{decl.name} is archived already")
    day = a.date or datetime.date.today()
    to = _other_side(ledger, book_id, a.to)
    if to == decl.name:
        raise FundRefused("what's left has to go to another fund, or Unallocated")
    rows = ledger.store.fund_entries(book_id, decl.name)
    last = max((datetime.date.fromisoformat(r["date"]) for r in rows), default=None)
    if last and last > day:
        raise FundRefused(f"{decl.name} has entries up to {last.isoformat()}: archive it then or later")
    left: dict[str, Decimal] = defaultdict(Decimal)
    for r in rows:
        left[r["currency"]] += Decimal(r["amount"])
    directives = []
    for currency, number in sorted(left.items()):
        if number > 0:
            directives.append(engine.move_directive(engine.FundMove(day, decl.name, to, number, currency, "Archived")))
        elif number < 0:
            directives.append(engine.move_directive(engine.FundMove(day, to, decl.name, -number, currency, "Archived")))
    directives.append(engine.fund_directive(dataclasses.replace(decl, archived=day), directive_id))
    with ledger.store.transaction():
        ledger.store.check_version(book_id, directive_id, a.updated_at)
        ledger.store.put(book_id, directives)
    return get(ledger, book_id, decl.name)


def unarchive(ledger: Ledger, book_id: str, name: str, v: models.FundVersion) -> models.Fund:
    directive_id, decl = _find(ledger, book_id, name)
    ledger._put(book_id, engine.fund_directive(dataclasses.replace(decl, archived=None), directive_id), v.updated_at)
    return get(ledger, book_id, decl.name)


def delete(ledger: Ledger, book_id: str, name: str, updated_at: str) -> None:
    """Delete a fund with no history (archive one that has)."""
    directive_id, decl = _find(ledger, book_id, name)
    if ledger.store.fund_entries(book_id, decl.name):
        raise FundRefused(f"{decl.name} has history: archive it instead")
    ledger.delete(book_id, directive_id, expected=updated_at)


def history(ledger: Ledger, book_id: str, name: str) -> models.FundHistory:
    """A fund and its history, newest first, with a running balance per commodity."""
    fund = get(ledger, book_id, name)
    running: dict[str, Decimal] = defaultdict(Decimal)
    entries = []
    for r in ledger.store.fund_entries(book_id, fund.name):
        number = Decimal(r["amount"])
        running[r["currency"]] += number
        move = engine.move_of(r["text"]) if r["kind"] == "custom" else None
        entries.append(
            models.FundEntry(
                id=r["id"],
                kind="move" if move else "transaction",
                date=datetime.date.fromisoformat(r["date"]),
                flag=r["flag"],
                payee=r["payee"],
                narration=r["narration"],
                amount=_amount(number, r["currency"]),
                balance=_amount(running[r["currency"]], r["currency"]),
                other=(move.to_fund if number < 0 else move.from_fund) if move else None,
                note=move.note if move else None,
                updated_at=r["updated_at"],
            )
        )
    entries.reverse()
    return models.FundHistory(fund=fund, entries=entries)


# Moves


def _move(ledger: Ledger, book_id: str, move_id: str) -> tuple[engine.FundMove, str]:
    row = ledger.get(book_id, move_id)
    move = engine.move_of(row.text) if row.kind == "custom" else None
    if move is None:
        raise NotFound(move_id)
    return move, row.updated_at


def _move_model(move_id: str, m: engine.FundMove, updated_at: str) -> models.FundMove:
    return models.FundMove(
        id=move_id,
        date=m.date,
        from_fund=m.from_fund,
        to_fund=m.to_fund,
        amount=_amount(m.number, m.currency),
        note=m.note,
        updated_at=updated_at,
    )


def _checked(ledger: Ledger, book_id: str, m: engine.FundMove, before: engine.FundMove | None = None) -> engine.FundMove:
    from_fund = _other_side(ledger, book_id, m.from_fund, before.from_fund if before else None)
    to_fund = _other_side(ledger, book_id, m.to_fund, before.to_fund if before else None)
    if from_fund == to_fund:
        raise FundRefused("a move goes from one fund to another")
    if m.number <= 0:
        raise FundRefused("a move's amount is more than 0")
    currency = investments.operating_currency(ledger._header(book_id))
    if m.currency != currency:
        raise FundRefused(f"funds hold {currency} for now")
    return dataclasses.replace(m, from_fund=from_fund, to_fund=to_fund, note=(m.note or "").strip() or None)


def create_move(ledger: Ledger, book_id: str, m: models.FundMoveIn) -> models.FundMove:
    move = _checked(
        ledger,
        book_id,
        engine.FundMove(m.date, m.from_fund, m.to_fund, Decimal(m.amount.number), m.amount.currency, m.note),
    )
    directive = ledger._insert(book_id, engine.move_directive(move))
    return _move_model(directive.id, move, ledger.get(book_id, directive.id).updated_at)


def patch_move(ledger: Ledger, book_id: str, move_id: str, p: models.FundMovePatch) -> models.FundMove:
    before, _ = _move(ledger, book_id, move_id)
    changes = p.model_dump(exclude_unset=True, exclude={"updated_at"})
    move = dataclasses.replace(
        before,
        date=p.date if "date" in changes and p.date else before.date,
        from_fund=p.from_fund if "from_fund" in changes and p.from_fund else before.from_fund,
        to_fund=p.to_fund if "to_fund" in changes and p.to_fund else before.to_fund,
        number=Decimal(p.amount.number) if "amount" in changes and p.amount else before.number,
        currency=p.amount.currency if "amount" in changes and p.amount else before.currency,
        note=p.note if "note" in changes else before.note,
    )
    move = _checked(ledger, book_id, move, before)
    ledger._put(book_id, engine.move_directive(move, move_id), p.updated_at)
    return _move_model(move_id, move, ledger.get(book_id, move_id).updated_at)


def delete_move(ledger: Ledger, book_id: str, move_id: str, updated_at: str) -> None:
    _move(ledger, book_id, move_id)
    ledger.delete(book_id, move_id, expected=updated_at)

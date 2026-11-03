"""Funds (Funds A, B): what money is for, as a ledger of its own beside the accounts (where it is).

- **A fund is a `custom "fund"` directive:** its name, and as metadata its `description`, a
  `target` (shown as progress; nothing fills it) and the date it was `archived`.
- **What a fund holds** is the sum of its lines (on transactions, `funds:`; see `fundlines`), of
  moves between funds (`custom "fund-move"`), read from the derived `fund_line` table, and of what
  the accounts it's the default fund of give it (`custom "fund-default"`, Funds B), per
  commodity, valued in the operating currency at the day's prices.
- **Unallocated** is net worth less every fund: what isn't in one. Never written, only worked
  out. Net worth is the chart's own figure: every asset and liability, valued. Per commodity, it's
  what the accounts hold less what funds hold.
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


def _holding(number: Decimal, currency: str, target: str, known) -> models.FundHolding:
    found = investments.rate(currency, target, known)
    return models.FundHolding(
        amount=_amount(number, currency),
        value=_amount((number * found[0]).quantize(Decimal("0.01")), target) if found else None,
        price=_amount(found[0], target) if found and currency != target else None,
        price_date=found[1] if found else None,
    )


def _holdings(held: dict[str, Decimal], target: str, known) -> list[models.FundHolding]:
    """Holdings, the operating currency first, then A–Z."""
    order = sorted((c for c, n in held.items() if n != 0), key=lambda c: (c != target, c))
    return [_holding(held[c], c, target, known) for c in order]


def _value(holdings: list[models.FundHolding]) -> Decimal:
    return sum((Decimal(h.value.number) for h in holdings if h.value), Decimal(0)).quantize(Decimal("0.01"))


def default_models(defaults: fundlines.Defaults, versions: dict[str, str]) -> list[models.FundDefault]:
    return [
        models.FundDefault(id=i, account=d.account, fund=d.fund, date=d.date, updated_at=versions.get(i, ""))
        for i, d in defaults.entries
    ]


def listing(ledger: Ledger, book_id: str, on: datetime.date | None = None) -> models.Funds:
    """Every fund (declared ones, and any only used, as in an imported book), with what it holds
    and its value; net worth, and Unallocated. Values at `on`'s prices (today's by default)."""
    on = on or datetime.date.today()
    header = ledger._header(book_id)
    currency = investments.operating_currency(header)
    known = investments.prices(ledger, book_id, on)
    defaults = fundlines.Defaults.load(ledger.store, book_id)
    held: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    entries: dict[str, int] = defaultdict(int)
    names: dict[str, str] = {}
    for r in ledger.store.fund_lines(book_id):
        key = r["fund"].casefold()
        names.setdefault(key, r["fund"])
        held[key][r["currency"]] += Decimal(r["amount"])
        entries[key] += 1
    for _, parts in fundlines.default_parts(ledger.store, book_id, header, defaults):
        for (fund, c), number in parts.items():
            key = fund.casefold()
            names.setdefault(key, fund)
            held[key][c] += number
            entries[key] += 1
    versions = {r.id: r.updated_at for r in ledger.store.find(book_id, kind="custom", limit=None)}
    declared = fundlines.declared(ledger.store, book_id)
    today_defaults: dict[str, list[str]] = defaultdict(list)
    for account in sorted({d.account for _, d in defaults.entries}):
        fund = defaults.fund_for(account, on)
        own = [d for _, d in defaults.entries if d.account == account and d.date <= on]
        if own and own[-1].fund and fund != UNALLOCATED:
            today_defaults[fund.casefold()].append(account)

    funds = []
    for key in sorted({*declared, *names}):
        directive_id, decl = declared.get(key, (None, None))
        holdings = _holdings(held.get(key, {}), currency, known)
        funds.append(
            models.Fund(
                name=decl.name if decl else names[key],
                description=decl.description if decl else None,
                target=_amount(*decl.target) if decl and decl.target else None,
                created=decl.date if decl else None,
                archived=decl.archived if decl else None,
                holdings=holdings,
                value=_amount(_value(holdings), currency),
                unpriced=[h.amount.currency for h in holdings if h.value is None],
                accounts=today_defaults.get(key, []),
                entries=entries.get(key, 0),
                updated_at=versions.get(directive_id) if directive_id else None,
            )
        )
    funds.sort(key=lambda f: (f.archived is not None, f.name.casefold()))
    tops = [a for a in chart.tree(ledger, book_id, on) if ":" not in a.name and a.type in ("asset", "liability")]
    net_worth = sum((Decimal(a.value.number) for a in tops), Decimal(0))
    in_funds = sum((Decimal(f.value.number) for f in funds), Decimal(0))
    accounts_hold: dict[str, Decimal] = defaultdict(Decimal)
    for a in tops:
        for amount in a.total:
            accounts_hold[amount.currency] += Decimal(amount.number)
    for f in held.values():
        for c, n in f.items():
            accounts_hold[c] -= n
    unallocated_holdings = _holdings(accounts_hold, currency, known)
    return models.Funds(
        on=on,
        currency=currency,
        net_worth=_amount(net_worth, currency),
        unallocated=_amount(net_worth - in_funds, currency),
        unpriced=sorted({u for a in tops for u in a.unpriced}),
        unallocated_holdings=unallocated_holdings,
        funds=funds,
        defaults=default_models(defaults, versions),
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
        for directive_id, d in fundlines.Defaults.load(ledger.store, book_id).entries:
            if d.fund and d.fund.casefold() == old.casefold():
                directives.append(engine.default_directive(dataclasses.replace(d, fund=to), directive_id))
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
    defaults = fundlines.Defaults.load(ledger.store, book_id)
    used = sorted(
        account
        for account in {d.account for _, d in defaults.entries}
        if defaults.fund_for(account, datetime.date.today()).casefold() == decl.name.casefold()
    )
    if used:
        raise FundRefused(f"{decl.name} is the default fund of {', '.join(used)}: give it another default, or none, first")
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
    """A fund and its history, newest first, with a running balance per commodity: its lines,
    its moves, and what the accounts it's the default fund of gave it."""
    fund = get(ledger, book_id, name)
    header = ledger._header(book_id)
    defaults = fundlines.Defaults.load(ledger.store, book_id)
    key = fund.name.casefold()
    rows: list[tuple] = []
    for r in ledger.store.fund_entries(book_id, fund.name):
        move = engine.move_of(r["text"]) if r["kind"] == "custom" else None
        rows.append((r["date"], r["id"], Decimal(r["amount"]), r["currency"], dict(r), move))
    from_defaults: dict[tuple[str, str], Decimal] = {}
    for t, parts in fundlines.default_parts(ledger.store, book_id, header, defaults):
        for (f, c), number in parts.items():
            if f.casefold() == key:
                from_defaults[(t["id"], c)] = number
                if not any(row[1] == t["id"] and row[3] == c for row in rows):
                    rows.append((t["date"], t["id"], Decimal(0), c, {**t, "kind": "transaction"}, None))
    rows.sort(key=lambda row: (row[0], row[4].get("ordinal", 0)))
    running: dict[str, Decimal] = defaultdict(Decimal)
    entries = []
    for date, directive_id, number, currency, r, move in rows:
        number += from_defaults.get((directive_id, currency), Decimal(0))
        if number == 0:
            continue
        running[currency] += number
        entries.append(
            models.FundEntry(
                id=directive_id,
                kind="move" if move else "transaction",
                date=datetime.date.fromisoformat(date),
                flag=r.get("flag"),
                payee=r.get("payee"),
                narration=r.get("narration"),
                amount=_amount(number, currency),
                balance=_amount(running[currency], currency),
                other=(move.to_fund if number < 0 else move.from_fund) if move else None,
                note=move.note if move else None,
                updated_at=r["updated_at"],
            )
        )
    entries.reverse()
    return models.FundHistory(fund=fund, entries=entries)


def short(ledger: Ledger, book_id: str) -> list[models.ShortTransaction]:
    """Transactions that take a share a fund doesn't have, in the order they were added."""
    header = ledger._header(book_id)
    found = [
        models.ShortTransaction(
            id=t["id"],
            date=datetime.date.fromisoformat(t["date"]),
            flag=t["flag"],
            payee=t["payee"],
            narration=t["narration"],
            added=t["created_at"],
            updated_at=t["updated_at"],
            takes=[
                models.ShortTake(fund=f, amount=_amount(n, c), holding=_amount(h, c))
                for f, c, n, h in taken
            ],
        )
        for t, taken in fundlines.short(ledger.store, book_id, header)
    ]
    return sorted(found, key=lambda s: s.added)


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
    if m.currency not in _commodities(ledger, book_id):
        raise FundRefused(f"the book holds no {m.currency}")
    return dataclasses.replace(m, from_fund=from_fund, to_fund=to_fund, note=(m.note or "").strip() or None)


def _commodities(ledger: Ledger, book_id: str) -> set[str]:
    """What a line or move can be in: the operating currency, and any commodity the book declares
    or its accounts have held."""
    header = ledger._header(book_id)
    held = ledger.store.balance_sheet_totals(book_id, fundlines.balance_sheet_roots(header))
    return {investments.operating_currency(header), *held, *investments.commodities(ledger, book_id)}


def _check_shares(ledger: Ledger, book_id: str, add: list[engine.FundMove], remove: list[engine.FundMove] = ()) -> None:
    """Refuse moves (and changes to them) that would leave a fund below zero in a share."""
    header = ledger._header(book_id)
    operating = investments.operating_currency(header)
    delta: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
    for sign, moves in ((1, add), (-1, remove)):
        for m in moves:
            if m.currency == operating:
                continue
            delta[(m.from_fund.casefold(), m.currency)] -= sign * m.number
            delta[(m.to_fund.casefold(), m.currency)] += sign * m.number
    if not any(v < 0 for v in delta.values()):
        return
    held = fundlines.share_holdings(ledger.store, book_id, header)
    for (fund, currency), d in delta.items():
        have = held.get((fund, currency), Decimal(0))
        if d < 0 and have + d < 0:
            name = next((m.from_fund for m in add if m.from_fund.casefold() == fund), None) or next(
                (m.to_fund for m in remove if m.to_fund.casefold() == fund), fund
            )
            raise FundRefused(
                f"{name} has {fundlines.amount_text(have, currency, operating)}, not "
                f"{fundlines.amount_text(-d, currency, operating)}"
            )


def create_move(ledger: Ledger, book_id: str, m: models.FundMoveIn) -> models.FundMove:
    return create_moves(ledger, book_id, models.FundMovesIn(moves=[m]))[0]


def create_moves(ledger: Ledger, book_id: str, batch: models.FundMovesIn) -> list[models.FundMove]:
    """Several moves in one write: all of them, or none."""
    moves = [
        _checked(
            ledger,
            book_id,
            engine.FundMove(m.date, m.from_fund, m.to_fund, Decimal(m.amount.number), m.amount.currency, m.note),
        )
        for m in batch.moves
    ]
    _check_shares(ledger, book_id, moves)
    directives = [engine.move_directive(move) for move in moves]
    with ledger.store.transaction():
        ledger.store.put(book_id, directives)
    return [_move_model(d.id, move, ledger.get(book_id, d.id).updated_at) for d, move in zip(directives, moves)]


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
    _check_shares(ledger, book_id, [move], [before])
    ledger._put(book_id, engine.move_directive(move, move_id), p.updated_at)
    return _move_model(move_id, move, ledger.get(book_id, move_id).updated_at)


def delete_move(ledger: Ledger, book_id: str, move_id: str, updated_at: str) -> None:
    move, _ = _move(ledger, book_id, move_id)
    _check_shares(ledger, book_id, [], [move])
    ledger.delete(book_id, move_id, expected=updated_at)


# Default funds (Funds B)


def _default(ledger: Ledger, book_id: str, default_id: str) -> tuple[engine.FundDefault, str]:
    row = ledger.get(book_id, default_id)
    d = engine.default_of(row.text) if row.kind == "custom" else None
    if d is None:
        raise NotFound(default_id)
    return d, row.updated_at


def _default_checked(ledger: Ledger, book_id: str, d: engine.FundDefault) -> engine.FundDefault:
    """A default fund as it's kept: an asset or liability account, and a fund named as it is (an
    active one, Unallocated, or none)."""
    header = ledger._header(book_id)
    if d.account.split(":", 1)[0] not in fundlines.balance_sheet_roots(header):
        raise FundRefused("only an asset or liability account has a default fund")
    if not any(a.name == d.account for a in ledger.accounts(book_id)):
        raise FundRefused(f"there's no account called {d.account}")
    fund = d.fund and " ".join(d.fund.split())
    if not fund:
        return dataclasses.replace(d, fund=None)
    if fund.casefold() == UNALLOCATED.casefold():
        return dataclasses.replace(d, fund=UNALLOCATED)
    found = fundlines.declared(ledger.store, book_id).get(fund.casefold())
    if found is None:
        raise FundRefused(f"there's no fund called {fund}")
    if found[1].archived:
        raise FundRefused(f"{found[1].name} is archived")
    return dataclasses.replace(d, fund=found[1].name)


def _default_effect(
    ledger: Ledger, book_id: str, default_id: str | None, d: engine.FundDefault | None
) -> tuple[models.FundDefaultEffect, fundlines.Defaults]:
    """What changing the book's defaults this way does to each fund, and why it can't be saved,
    if it can't (it would leave a fund below zero in a share)."""
    header = ledger._header(book_id)
    operating = investments.operating_currency(header)
    current = fundlines.Defaults.load(ledger.store, book_id)
    changed = current.replaced(default_id, d)
    before = fundlines.fund_totals(ledger.store, book_id, header, current)
    after = fundlines.fund_totals(ledger.store, book_id, header, changed)
    delta: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for key in {*before, *after}:
        diff = after.get(key, Decimal(0)) - before.get(key, Decimal(0))
        if diff:
            delta[key[0]][key[1]] += diff
    unallocated: dict[str, Decimal] = defaultdict(Decimal)
    for amounts in delta.values():
        for c, n in amounts.items():
            unallocated[c] -= n
    known = investments.prices(ledger, book_id, datetime.date.today())
    changes = []
    for fund, amounts in [*sorted(delta.items(), key=lambda kv: kv[0].casefold()), (UNALLOCATED, unallocated)]:
        holdings = _holdings(amounts, operating, known)
        if holdings:
            changes.append(
                models.FundChange(
                    fund=fund, amounts=[h.amount for h in holdings], value=_amount(_value(holdings), operating)
                )
            )
    problem = None
    held = fundlines.share_holdings(ledger.store, book_id, header, current)
    for fund, amounts in [*delta.items(), (UNALLOCATED, unallocated)]:
        for c, n in amounts.items():
            have = held.get((fund.casefold(), c), Decimal(0))
            if c != operating and n < 0 and have + n < 0:
                problem = f"it would leave {fund} at {fundlines.amount_text(have + n, c, operating)}"
    return models.FundDefaultEffect(changes=changes, problem=problem), changed


def _default_model(default_id: str, d: engine.FundDefault, updated_at: str) -> models.FundDefault:
    return models.FundDefault(id=default_id, account=d.account, fund=d.fund, date=d.date, updated_at=updated_at)


def preview_default(ledger: Ledger, book_id: str, p: models.FundDefaultPreview) -> models.FundDefaultEffect:
    d = None if p.delete else _default_checked(ledger, book_id, engine.FundDefault(p.date, p.account, p.fund))
    return _default_effect(ledger, book_id, p.id, d)[0]


def create_default(ledger: Ledger, book_id: str, d: models.FundDefaultIn) -> models.FundDefault:
    made = _default_checked(ledger, book_id, engine.FundDefault(d.date, d.account, d.fund))
    effect, _ = _default_effect(ledger, book_id, None, made)
    if effect.problem:
        raise FundRefused(effect.problem)
    directive = ledger._insert(book_id, engine.default_directive(made))
    return _default_model(directive.id, made, ledger.get(book_id, directive.id).updated_at)


def patch_default(ledger: Ledger, book_id: str, default_id: str, p: models.FundDefaultPatch) -> models.FundDefault:
    before, _ = _default(ledger, book_id, default_id)
    changes = p.model_dump(exclude_unset=True, exclude={"updated_at"})
    d = _default_checked(
        ledger,
        book_id,
        dataclasses.replace(
            before,
            fund=p.fund if "fund" in changes else before.fund,
            date=p.date if "date" in changes and p.date else before.date,
        ),
    )
    effect, _ = _default_effect(ledger, book_id, default_id, d)
    if effect.problem:
        raise FundRefused(effect.problem)
    ledger._put(book_id, engine.default_directive(d, default_id), p.updated_at)
    return _default_model(default_id, d, ledger.get(book_id, default_id).updated_at)


def delete_default(ledger: Ledger, book_id: str, default_id: str, updated_at: str) -> None:
    _default(ledger, book_id, default_id)
    effect, _ = _default_effect(ledger, book_id, default_id, None)
    if effect.problem:
        raise FundRefused(effect.problem)
    ledger.delete(book_id, default_id, expected=updated_at)

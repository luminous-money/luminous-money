"""The chart of accounts (M10): the whole tree with balances rolled up, and renaming, archiving
and deleting accounts.

- **The tree** is one read: every live posting's change, summed per account in Python (as
  Decimals) and rolled up through every ancestor, then valued in the operating currency at the
  latest prices (one hop, as M5 does). No Beancount load.
- **Renaming** (or moving: the full name changes) rewrites every directive that names the account
  or one under it, in one atomic write: postings, opens and closes, balances, pads, notes,
  documents, custom values.
- **Deleting** moves every posting of the account and its subtree to a substitute, then drops the
  accounts' opens, closes, balances, pads, notes, documents and budgets, in one write. Merging is
  the same.
- **Archiving** closes the account (and every opened account under it) on a date no earlier than
  its last transaction, optionally after a closing transfer of what's left in it.
- **Protected:** the top-level accounts, the system accounts the code relies on, and a
  brokerage's parts (its `:Cash` and holdings, which follow the brokerage).
- **Dividing** (M15) turns a leaf into a divided account of the same name: everything that was
  its own moves to its main part, its statements stay with the whole, and the other parts get
  their amounts by one transfer. A divided account's main part can't be deleted or archived
  on its own (choose another first): what comes in has to land somewhere.
"""

from __future__ import annotations

import datetime
import re
from collections import defaultdict
from decimal import Decimal

from . import engine, investments, models
from .service import Ledger, NotFound

ROOTS = {"Assets", "Liabilities", "Equity", "Income", "Expenses"}
UNCATEGORIZED = ("Expenses:Uncategorized", "Income:Uncategorized")
# Where a receipt's money came from until someone says (M16): `app` opens it when it's needed.
UNKNOWN = "Assets:Unknown"
PROTECTED = {
    *UNCATEGORIZED,
    UNKNOWN,
    Ledger.OPENING_BALANCES,
    investments.UNREALIZED_GAINS,
    *investments.GAINS.values(),
    investments.FEES,
}
_COMMODITY = re.compile(r"^[A-Z][A-Z0-9'._-]{0,22}[A-Z0-9]$")


class AccountRefused(ValueError):
    """An account change that isn't allowed: the input's problem (422)."""


def _parents(name: str) -> list[str]:
    parts = name.split(":")
    return [":".join(parts[:i]) for i in range(1, len(parts))]


def _under(name: str, root: str) -> bool:
    return name == root or name.startswith(root + ":")


def _brokerage_parts(names: set[str]) -> set[str]:
    """A brokerage's `:Cash` and holdings: children of a node that has a `:Cash` child."""
    brokerages = {n.rsplit(":", 1)[0] for n in names if n.endswith(":Cash") and n.count(":") >= 2}
    return {
        n
        for n in names
        if ":" in n and n.rsplit(":", 1)[0] in brokerages and (n.endswith(":Cash") or _COMMODITY.match(n.rsplit(":", 1)[1]))
    }


def tree(ledger: Ledger, book_id: str, on: datetime.date | None = None) -> list[models.TreeAccount]:
    """Every account, opened, implicit or closed, with its own balance and its subtree's, the
    subtree's value in the operating currency, and how many splits the subtree has."""
    on = on or datetime.date.today()
    accounts = ledger.accounts(book_id)
    own: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    total: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    splits: dict[str, int] = defaultdict(int)
    for row in ledger.store.account_amounts(book_id):
        name = row["account"]
        for at in [name, *_parents(name)]:
            splits[at] += 1
        if row["amount"] is None:
            continue
        number = Decimal(row["amount"])
        own[name][row["currency"]] += number
        for at in [name, *_parents(name)]:
            total[at][row["currency"]] += number
    target = investments.operating_currency(ledger._header(book_id))
    known = investments.prices(ledger, book_id, on)
    names = {a.name for a in accounts}
    parts = _brokerage_parts(names)

    def amounts(balances: dict[str, Decimal]) -> list[models.Amount]:
        return [
            models.Amount(number=engine.decimal_text(n), currency=c)
            for c, n in sorted(balances.items())
            if n != 0
        ]

    result = []
    for a in accounts:
        subtree = {c: n for c, n in total.get(a.name, {}).items() if n != 0}
        # One figure: what can be valued; what can't (no price) is named beside it.
        value, unpriced = Decimal(0), []
        for currency, number in sorted(subtree.items()):
            found = investments.rate(currency, target, known)
            if found is None:
                unpriced.append(currency)
            else:
                value += number * found[0]
        result.append(
            models.TreeAccount(
                **a.model_dump(),
                balance=amounts(own.get(a.name, {})),
                total=amounts(subtree),
                value=models.Amount(number=engine.decimal_text(value.quantize(Decimal("0.01"))), currency=target),
                unpriced=unpriced,
                splits=splits.get(a.name, 0),
                protected=a.name in PROTECTED or a.name in ROOTS or a.name in parts,
            )
        )
    return result


def _account(ledger: Ledger, book_id: str, name: str) -> models.Account:
    found = next((a for a in ledger.accounts(book_id) if a.name == name), None)
    if found is None:
        raise NotFound(name)
    return found


def _main_part_of(accounts: list[models.Account], name: str) -> str | None:
    """The divided account above `name` whose main part it is, if any."""
    return next((a.name for a in accounts if a.main_part == name and a.name != name), None)


def _check_changeable(ledger: Ledger, book_id: str, name: str, what: str) -> list[str]:
    """Refuse changing a fixed account; returns the names in its subtree."""
    accounts = ledger.accounts(book_id)
    names = {a.name for a in accounts}
    if name in ROOTS:
        raise AccountRefused(f"top-level accounts can't be {what}")
    whole = _main_part_of(accounts, name)
    if whole and what != "renamed":
        raise AccountRefused(f"it's where new money lands in {whole}: choose another part for that first")
    subtree = sorted(n for n in names if _under(n, name))
    fixed = [n for n in subtree if n in PROTECTED]
    if fixed:
        raise AccountRefused(f"{fixed[0]} is a system account: it can't be {what}")
    if name in _brokerage_parts(names):
        raise AccountRefused(f"{name} is part of its brokerage: change the brokerage instead")
    return subtree


def _versioned(ledger: Ledger, book_id: str, name: str, expected: str | None) -> None:
    """Check the account's open directive is still the version read (implicit nodes have none)."""
    if expected is None:
        return
    for row in ledger.store.find(book_id, kind="open", limit=None):
        if engine.opened(row.text) == name:
            ledger.store.check_version(book_id, row.id, expected)


def rename(ledger: Ledger, book_id: str, old: str, new: str, *, expected: str | None = None) -> models.Account:
    """Rename (or move) an account and everything under it."""
    _account(ledger, book_id, old)
    _check_changeable(ledger, book_id, old, "renamed")
    engine.parse_one(f"2000-01-01 open {new}\n")  # a valid name, or ParseFailure
    if old.split(":")[0] != new.split(":")[0]:
        raise AccountRefused("an account can't change type (its top-level account)")
    if new == old or _under(new, old):
        raise AccountRefused("an account can't move under itself")
    accounts = {a.name: a for a in ledger.accounts(book_id)}
    if any(_under(n, new) for n in accounts):
        raise AccountRefused(f"{new} already exists: merge into it instead")
    if any(accounts[p].kind == "leaf" and not accounts[p].implicit for p in _parents(new) if p in accounts):
        raise AccountRefused("an account can't go under a leaf account")

    def renamed(name: str) -> str:
        return new + name[len(old) :] if _under(name, old) else name

    with ledger.store.transaction():
        _versioned(ledger, book_id, old, expected)
        rewritten = []
        for row in ledger.store.mentioning(book_id, old):
            directive = engine.with_accounts(row.text, row.id, renamed)
            if directive is not None and directive.text != row.text:
                rewritten.append(directive)
        ledger.store.put(book_id, rewritten)
    return _account(ledger, book_id, new)


def delete(
    ledger: Ledger, book_id: str, name: str, *, substitute: str | None, expected: str | None = None
) -> list[str]:
    """Delete an account and its subtree, moving every posting to `substitute` (needed when there
    are any). Returns the deleted accounts' names."""
    _account(ledger, book_id, name)
    subtree = _check_changeable(ledger, book_id, name, "deleted")
    has_postings = any(
        _under(row["account"], name) for row in ledger.store.account_amounts(book_id)
    )
    if has_postings and not substitute:
        raise AccountRefused("it has transactions: choose an account to move them to")
    if substitute:
        target = _account(ledger, book_id, substitute)
        if _under(substitute, name):
            raise AccountRefused("the substitute can't be one of the accounts being deleted")
        if target.kind != "leaf" or target.implicit or target.close:
            raise AccountRefused(f"{substitute} isn't an open account that holds transactions")

    def moved(account: str) -> str:
        return substitute if substitute and _under(account, name) else account

    with ledger.store.transaction():
        _versioned(ledger, book_id, name, expected)
        rewritten, dropped = [], []
        for row in ledger.store.mentioning(book_id, name):
            directive = engine.with_accounts(row.text, row.id, moved, drop=lambda a: _under(a, name))
            if directive is None:
                dropped.append(row.id)
            elif directive.text != row.text:
                rewritten.append(directive)
        ledger._write(book_id, rewritten)
        ledger.store.delete(book_id, dropped)
    return subtree


def archive(
    ledger: Ledger,
    book_id: str,
    name: str,
    *,
    date: datetime.date | None = None,
    transfer_to: str | None = None,
    expected: str | None = None,
) -> list[str]:
    """Close an account and every opened account under it, on `date` (today by default), no
    earlier than its last transaction. With `transfer_to`, a closing transfer first moves what's
    left in it there (a leaf holding plain currencies). Returns the accounts closed."""
    account = _account(ledger, book_id, name)
    if name in ROOTS:
        raise AccountRefused("top-level accounts can't be archived")
    whole = _main_part_of(ledger.accounts(book_id), name)
    if whole:
        raise AccountRefused(f"it's where new money lands in {whole}: choose another part for that first")
    date = date or datetime.date.today()
    last = ledger.store.last_posting(book_id, name)
    if last and date.isoformat() < last:
        raise AccountRefused(f"it has transactions until {last}: archive it on that date or later")
    opened = [
        a for a in ledger.accounts(book_id) if _under(a.name, name) and not a.implicit and a.close is None
    ]
    directives: list[engine.Directive] = []
    if transfer_to:
        if account.kind != "leaf":
            raise AccountRefused("a closing transfer needs a single account (not a node)")
        target = _account(ledger, book_id, transfer_to)
        if target.kind != "leaf" or target.implicit or target.close or _under(transfer_to, name):
            raise AccountRefused(f"{transfer_to} isn't an open account that holds transactions")
        left = [a for a in ledger.balance(book_id, name) if Decimal(a.number) != 0]
        operating = investments.operating_currency(ledger._header(book_id))
        if any(a.currency != operating for a in left):
            raise AccountRefused("a closing transfer can only move money, not holdings")
        if left:
            directives.append(
                engine.transaction_directive(
                    models.TransactionIn(
                        date=date,
                        flag="*",
                        narration=f"Closing transfer from {name}",
                        postings=[
                            *[
                                models.Posting(account=name, units=models.Amount(number=engine.decimal_text(-Decimal(a.number)), currency=a.currency))
                                for a in left
                            ],
                            models.Posting(account=transfer_to),
                        ],
                    )
                )
            )
    directives += [engine.closed(a.name, date) for a in opened]
    with ledger.store.transaction():
        _versioned(ledger, book_id, name, expected)
        ledger._write(book_id, directives)
    return [a.name for a in opened]


def unarchive(ledger: Ledger, book_id: str, name: str) -> list[str]:
    """Reopen an archived account (and everything under it): its closes go."""
    _account(ledger, book_id, name)
    closes = [r for r in ledger.store.find(book_id, kind="close", limit=None)]
    gone = [r for r in closes if _under(_closed_name(r.text), name)]
    with ledger.store.transaction():
        ledger.store.delete(book_id, [r.id for r in gone])
    return [_closed_name(r.text) for r in gone]


def _closed_name(text: str) -> str:
    return text.split()[2]


def divide(ledger: Ledger, book_id: str, name: str, d: models.DivideIn) -> models.Account:
    """Divide an asset or liability leaf (M15), in one write: it becomes a divided account of the
    same name, its transactions (their marks too), opening balance and settings going to its
    main part; its statements and budgets stay with the whole, the real account; each other part
    opens and gets its amount by one transfer from the main part, on `d.date`."""
    accounts = {a.name: a for a in ledger.accounts(book_id)}
    account = _account(ledger, book_id, name)
    _check_changeable(ledger, book_id, name, "divided")
    if account.kind != "leaf" or account.implicit or account.close:
        raise AccountRefused(f"{name} isn't an open account that holds transactions")
    if account.type not in Ledger.RECONCILED_TYPES:
        raise AccountRefused("only an asset or liability account is divided")
    if account.revalue_every:
        raise AccountRefused("a revalued asset (a house, a car) isn't divided")
    parts = [name, *_parents(name)]
    if any(accounts.get(p) and accounts[p].divided for p in parts[1:]):
        raise AccountRefused(f"{name} is part of a divided account already")
    if name in _brokerage_parts(set(accounts)):
        raise AccountRefused(f"{name} is part of its brokerage")
    segments = [d.main, *(p.name for p in d.parts)]
    if len(set(segments)) != len(segments):
        raise AccountRefused("each part needs a name of its own")
    for segment in segments:
        engine.parse_one(f"2000-01-01 open {name}:{segment}\n")  # a valid name, or ParseFailure
    main = f"{name}:{d.main}"
    currency = account.currencies[0] if account.currencies else investments.operating_currency(ledger._header(book_id))

    with ledger.store.transaction():
        _versioned(ledger, book_id, name, d.updated_at)
        writes: list[engine.Directive] = []
        for row in ledger.store.mentioning(book_id, name):
            if row.kind == "transaction":
                moved = engine.moved_postings(row.text, row.id, name, main)
                if moved.text != row.text:
                    writes.append(moved)
            elif row.kind == "open" and engine.opened(row.text) == name:
                writes.extend(engine.divided_opens(row.text, main))
            elif row.kind == "pad" and f" {name} " in f" {row.text.split(chr(10), 1)[0]} ":
                raise AccountRefused("it has pad directives: an account that pads isn't divided")
        for part in d.parts:
            writes.append(
                engine.open_directive(f"{name}:{part.name}", account.open, "leaf", currencies=account.currencies or None)
            )
        moving = [p for p in d.parts if Decimal(p.amount) != 0]
        if moving:
            label = account.display_name or name.rsplit(":", 1)[-1].replace("-", " ")
            writes.append(
                engine.transaction_directive(
                    models.TransactionIn(
                        date=d.date,
                        flag="*",
                        narration=f"Divided {label}",
                        postings=[
                            models.Posting(
                                account=main,
                                units=models.Amount(
                                    number=engine.decimal_text(-sum((Decimal(p.amount) for p in moving), Decimal(0))),
                                    currency=currency,
                                ),
                            ),
                            *(
                                models.Posting(account=f"{name}:{p.name}", units=models.Amount(number=p.amount, currency=currency))
                                for p in moving
                            ),
                        ],
                    )
                )
            )
        ledger._write(book_id, writes)
    return _account(ledger, book_id, name)

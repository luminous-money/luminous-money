"""Reconciliation (M14): agreeing an account with a statement.

- **Kept as Beancount,** so exports carry it:
  - the statement, `custom "statement" <account> <balance>`, dated the statement's date
  - `reconciled: <statement date>` on each posting it covers (the posting, not the transaction:
    a transfer's two sides reconcile with two different statements)
- **By marks, not dates** (as GnuCash and QuickBooks do it): a statement holds when the
  postings reconciled with it and before it add up to its balance. A transaction's date doesn't
  have to agree with the statement, so nothing moves: one not on it stays outstanding, and a
  transfer whose two banks date it apart reconciles on each side with its own bank's statement.
  (A `balance` assertion would check everything dated up to it, which can't hold both ways.)
- **Scope:** a leaf reconciles itself; a divided account (`divided: TRUE` on a node: one real
  account its sub-accounts divide) reconciles as one, and its sub-accounts can't themselves.
  Transfers between its sub-accounts aren't money moving: they reconcile themselves.
- **The starting balance** is what's reconciled so far: the sum of the scope's reconciled
  postings. A reconciliation ticks unreconciled transactions until the starting balance plus
  theirs is the statement's; it's refused otherwise.
- **Undo** takes the latest reconciliation's marks and statement off, in one write.
- **Balance assertions** from imported books are still checked by date, beside the statements.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from decimal import Decimal

from . import engine, investments, models
from .service import Ledger, NotFound

# How long after a statement a transaction may be dated and still be ticked onto it.
LATER_DAYS = 14
_DAY = datetime.timedelta(days=1)


class ReconcileRefused(ValueError):
    """A reconciliation that isn't allowed: the input's problem (422)."""


@dataclass
class _Posting:
    idx: int
    account: str
    amount: Decimal | None
    currency: str | None
    reconciled: datetime.date | None


@dataclass
class _Transaction:
    id: str
    date: datetime.date
    flag: str
    payee: str | None
    narration: str | None
    updated_at: str
    postings: list[_Posting] = field(default_factory=list)


@dataclass
class _Scope:
    """An account as reconciling sees it: the account its reconciliations are kept on, what
    they're in, and every transaction touching it."""

    account: str
    currency: str
    transactions: list[_Transaction]

    def mine(self, p: _Posting) -> bool:
        return p.account == self.account or p.account.startswith(self.account + ":")

    def net(self, t: _Transaction, *, unreconciled: bool = False) -> Decimal:
        """Its change to the scope in the scope's currency (just what's still unreconciled)."""
        return sum(
            (
                p.amount
                for p in t.postings
                if self.mine(p) and p.currency == self.currency and p.amount is not None
                and not (unreconciled and p.reconciled)
            ),
            Decimal(0),
        )

    def open(self, t: _Transaction) -> list[_Posting]:
        """Its postings in the scope still unreconciled."""
        return [p for p in t.postings if self.mine(p) and p.reconciled is None]

    def internal(self, t: _Transaction) -> bool:
        """A transfer within the scope: none of it leaves."""
        return all(self.mine(p) for p in t.postings)

    def reconciled_balance(self) -> Decimal:
        return sum(
            (
                p.amount
                for t in self.transactions
                for p in t.postings
                if self.mine(p) and p.reconciled and p.currency == self.currency and p.amount is not None
            ),
            Decimal(0),
        )

    def balance_through(self, day: datetime.date) -> Decimal:
        """What the books say at the end of `day`, by date."""
        return sum((self.net(t) for t in self.transactions if t.date <= day), Decimal(0))

    def reconciled_through(self, day: datetime.date) -> Decimal:
        """What's reconciled with the statements up to `day`'s."""
        return sum(
            (
                p.amount
                for t in self.transactions
                for p in t.postings
                if self.mine(p) and p.reconciled and p.reconciled <= day
                and p.currency == self.currency and p.amount is not None
            ),
            Decimal(0),
        )


def scope_of(accounts: dict[str, models.Account], name: str) -> str | None:
    """The account `name` is reconciled with: the divided account it's part of, else itself if
    it's a leaf or divided; None for any other node (its accounts reconcile themselves)."""
    parts = name.split(":")
    for above in (":".join(parts[:i]) for i in range(1, len(parts))):
        if above in accounts and accounts[above].divided:
            return above
    account = accounts.get(name)
    if account is None:
        return None
    return name if account.kind == "leaf" or account.divided else None


def _scope(ledger: Ledger, book_id: str, name: str) -> _Scope:
    """The account, if it can be reconciled itself, with everything reconciling reads."""
    accounts = {a.name: a for a in ledger.accounts(book_id)}
    account = accounts.get(name)
    if account is None or account.implicit and not account.divided:
        raise NotFound(name)
    if account.type not in Ledger.RECONCILED_TYPES:
        raise ReconcileRefused("only asset and liability accounts are reconciled")
    scope = scope_of(accounts, name)
    if scope is None:
        raise ReconcileRefused(f"each account under {name} is reconciled itself (it isn't a divided account)")
    if scope != name:
        raise ReconcileRefused(f"{name} is part of {scope}, a divided account: it's reconciled with it")
    currency = account.currencies[0] if account.currencies else investments.operating_currency(ledger._header(book_id))
    transactions: list[_Transaction] = []
    for r in ledger.store.scope_postings(book_id, name):
        if not transactions or transactions[-1].id != r["id"]:
            transactions.append(
                _Transaction(
                    r["id"], datetime.date.fromisoformat(r["date"]), r["flag"], r["payee"], r["narration"], r["updated_at"]
                )
            )
        transactions[-1].postings.append(
            _Posting(
                r["idx"],
                r["account"],
                None if r["amount"] is None else Decimal(r["amount"]),
                r["amount_currency"],
                datetime.date.fromisoformat(r["reconciled"]) if r["reconciled"] else None,
            )
        )
    return _Scope(name, currency, transactions)


@dataclass(frozen=True)
class _Check:
    """A statement of the account's, or a balance assertion on it (from an imported book)."""

    id: str
    updated_at: str
    day: datetime.date  # what it holds at the end of
    number: Decimal
    currency: str
    statement: bool
    source: str | None = None


def _checks(ledger: Ledger, book_id: str, account: str) -> list[_Check]:
    """The account's statements and balance assertions, oldest first."""
    found = []
    for row in ledger.store.find(book_id, kind="custom", limit=None):
        s = row.text and engine.statement_of(row.text)
        if s and s.account == account:
            found.append(_Check(row.id, row.updated_at, s.date, s.number, s.currency, True, s.source))
    for row in ledger.store.find(book_id, kind="balance", limit=None):
        b = row.text and engine.balance_check(row.text)
        if b and b.account == account:  # it holds at the start of its date
            found.append(_Check(row.id, row.updated_at, b.date - _DAY, b.number, b.currency, False))
    return sorted(found, key=lambda c: (c.day, c.statement))


def _money(number: Decimal, currency: str) -> models.Amount:
    return models.Amount(number=engine.decimal_text(number), currency=currency)


def _history(ledger: Ledger, book_id: str, scope: _Scope) -> list[models.Reconciliation]:
    """Every balance check on the account, newest first, each against the books."""
    out = []
    for check in _checks(ledger, book_id, scope.account):
        # A statement, against what's reconciled with it (and before); an assertion, by date.
        books = None
        if check.currency == scope.currency:
            books = scope.reconciled_through(check.day) if check.statement else scope.balance_through(check.day)
        count = sum(
            1 for t in scope.transactions if check.statement and any(scope.mine(p) and p.reconciled == check.day for p in t.postings)
        )
        out.append(
            models.Reconciliation(
                id=check.id,
                account=scope.account,
                statement_date=check.day,
                balance=_money(check.number, check.currency),
                statement=check.statement,
                automatic=check.source == "bank",
                transactions=count,
                off_by=_money(check.number - books, check.currency) if books is not None and books != check.number else None,
                updated_at=check.updated_at,
            )
        )
    return list(reversed(out))


def _last(history: list[models.Reconciliation]) -> models.Reconciliation | None:
    return next((r for r in history if r.statement), None)


def state(ledger: Ledger, book_id: str, account: str, through: datetime.date | None) -> models.ReconcileState:
    """What reconciling the account needs: what's reconciled so far, the last statement, and
    the unreconciled transactions (to `LATER_DAYS` after `through`), oldest first."""
    scope = _scope(ledger, book_id, account)
    last = _last(_history(ledger, book_id, scope))
    until = through + datetime.timedelta(days=LATER_DAYS) if through else None
    items, internal = [], 0
    for t in scope.transactions:
        if not scope.open(t) or (until and t.date > until):
            continue
        if scope.internal(t):
            internal += through is None or t.date <= through
            continue
        others = sorted({p.account for p in t.postings if not scope.mine(p)})
        items.append(
            models.ReconcileItem(
                id=t.id,
                date=t.date,
                flag=t.flag,
                payee=t.payee,
                narration=t.narration,
                amount=_money(scope.net(t, unreconciled=True), scope.currency),
                counterpart=others[0] if len(others) == 1 else None,
                opening=Ledger.OPENING_BALANCES in others,
                updated_at=t.updated_at,
            )
        )
    return models.ReconcileState(
        account=account,
        currency=scope.currency,
        reconciled_balance=_money(scope.reconciled_balance(), scope.currency),
        last=last.statement_date if last else None,
        transactions=items,
        internal=internal,
    )


def history(ledger: Ledger, book_id: str, account: str) -> models.Reconciliations:
    scope = _scope(ledger, book_id, account)
    return models.Reconciliations(account=account, reconciliations=_history(ledger, book_id, scope))


def reconcile(ledger: Ledger, book_id: str, account: str, r: models.ReconcileIn) -> models.Reconciled:
    """Reconcile the account with a statement, in one atomic write: the ticked transactions
    (and transfers within it) are marked, unconfirmed ones confirmed, and the statement written.
    Refused unless it comes to the statement's balance. Nothing's dates change."""
    day = r.statement_date
    balance = Decimal(r.balance)
    with ledger.store.transaction():
        scope = _scope(ledger, book_id, account)
        past = _history(ledger, book_id, scope)
        last = _last(past)
        replacing = None
        if (
            r.automatic and last and last.automatic and day > last.statement_date
            and (day.year, day.month) == (last.statement_date.year, last.statement_date.month)
        ):
            # This month's automatic reconciliation moves on: its transactions are this one's.
            replacing = last
            carried = set()
            for t in scope.transactions:
                for p in t.postings:
                    if scope.mine(p) and p.reconciled == last.statement_date:
                        p.reconciled = None
                        carried.add(t.id)
            last = next((x for x in past if x.statement and x.statement_date < replacing.statement_date), None)
        if last and day <= last.statement_date:
            raise ReconcileRefused(f"it was last reconciled with {last.statement_date}'s statement: this one must be later")
        by_id = {t.id: t for t in scope.transactions}
        ticked = set(r.transactions)
        if replacing:
            ticked |= carried
        for tid in ticked:
            t = by_id.get(tid)
            if t is None or not scope.open(t):
                raise ReconcileRefused(f"{tid} isn't an unreconciled transaction of {account}")
            if t.date > day + datetime.timedelta(days=LATER_DAYS):
                raise ReconcileRefused(f"{tid} is dated more than {LATER_DAYS} days after the statement")
        covered = [
            t for t in scope.transactions
            if scope.open(t) and (t.id in ticked or (scope.internal(t) and t.date <= day))
        ]
        reached = scope.reconciled_balance() + sum((scope.net(t, unreconciled=True) for t in covered), Decimal(0))
        if reached != balance:
            raise ReconcileRefused(
                f"it doesn't balance: the transactions ticked come to {engine.decimal_text(reached)}, "
                f"{engine.decimal_text(balance - reached)} short of the statement's {engine.decimal_text(balance)}"
            )

        writes, confirmed = [], []
        for t in covered:
            flag = "*" if t.flag == "!" else None
            if flag:
                confirmed.append(t.id)
            marks = {p.idx: day for p in scope.open(t)}
            writes.append(engine.parse_one(engine.rewritten(ledger.get(book_id, t.id).text, flag=flag, marks=marks).text, t.id))
        statement = engine.Statement(account, day, balance, scope.currency, "bank" if r.automatic else None)
        writes.append(engine.statement_directive(statement))
        ledger._write(book_id, writes)
        if replacing:
            ledger.store.delete(book_id, [replacing.id])

    done = _history(ledger, book_id, _scope(ledger, book_id, account))
    return models.Reconciled(
        reconciliation=next(x for x in done if x.statement and x.statement_date == day),
        confirmed=sorted(confirmed),
    )


def undo(ledger: Ledger, book_id: str, account: str, statement_date: datetime.date) -> None:
    """Undo the account's latest reconciliation: its marks and its statement go, in one write.
    (What it confirmed stays confirmed.)"""
    with ledger.store.transaction():
        scope = _scope(ledger, book_id, account)
        last = _last(_history(ledger, book_id, scope))
        if last is None or last.statement_date != statement_date:
            if any(x.statement and x.statement_date == statement_date for x in _history(ledger, book_id, scope)):
                raise ReconcileRefused("only the latest reconciliation can be undone")
            raise NotFound(f"{account}'s {statement_date} reconciliation")
        writes = []
        for t in scope.transactions:
            marks = {p.idx: None for p in t.postings if scope.mine(p) and p.reconciled == statement_date}
            if marks:
                writes.append(engine.parse_one(engine.rewritten(ledger.get(book_id, t.id).text, marks=marks).text, t.id))
        ledger.store.put(book_id, writes)
        ledger.store.delete(book_id, [last.id])


def day_balances(
    ledger: Ledger, book_id: str, account: str, date_from: datetime.date, date_to: datetime.date
) -> models.DayBalances:
    """The account's (and its subtree's) balance at the end of each day it changed in
    [from, to], in its currency, and at the end of the day before `from`."""
    accounts = {a.name: a for a in ledger.accounts(book_id)}
    found = accounts.get(account)
    if found is None:
        raise NotFound(account)
    currency = found.currencies[0] if found.currencies else investments.operating_currency(ledger._header(book_id))
    before, days, running, last_day = Decimal(0), [], Decimal(0), None
    for row in ledger.store.account_entries(book_id, account):
        day = datetime.date.fromisoformat(row["date"])
        if day > date_to:
            break
        change = Decimal(0)
        for piece in row["amounts"].split(";"):
            if piece != "?":
                number, piece_currency = piece.split(" ")
                if piece_currency == currency:
                    change += Decimal(number)
        running += change
        if day < date_from:
            before = running
        elif last_day == day:
            days[-1] = models.DayBalance(date=day, balance=engine.decimal_text(running))
        else:
            days.append(models.DayBalance(date=day, balance=engine.decimal_text(running)))
            last_day = day
    return models.DayBalances(account=account, currency=currency, before=engine.decimal_text(before), days=days)

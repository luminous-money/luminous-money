"""Budgets (M11): how much an account may take (or should bring in) per period.

- **Kept as `custom "budget"` directives,** Fava's format, each a version effective from its
  date until the account's next one:

      2026-10-01 custom "budget" Expenses:Food "monthly" 600.00 USD
      2026-10-01 custom "budget" Expenses:Fun "weekly" 50.00 USD
        every: 2

  The date is also where its periods count from. A top-level account is a string (`"Expenses"`):
  Beancount's account token needs two parts. An amount of 0 ends the budget.
- **Periods** are every N days, weeks, months or years from the start, as schedules' are (M3):
  months on the start's day, clamped to short months.
- **The rule:** no budget is higher, per year, than one on an account above it. Every write is
  checked against every version in force from its start on.
- **Status** measures each budget in force on a day: its account's flow over the current period,
  its subtree included, unconfirmed included, as the account reads (spent, earned, put in, paid
  down). A budgeted node with budgets under it gets an **Other**: its budget less theirs, and
  its flow less theirs. Expense budgets are limits; the rest are goals.
"""

from __future__ import annotations

import calendar
import datetime
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from beancount.core import data
from beancount.parser import parser

from . import engine, investments, models
from .service import Ledger, NotFound

TYPE = "budget"
CENT = Decimal("0.01")
# Fava's period words, as (unit, how many of it).
WORDS = {
    "daily": ("day", 1),
    "weekly": ("week", 1),
    "monthly": ("month", 1),
    "quarterly": ("month", 3),
    "yearly": ("year", 1),
}
UNIT_WORDS = {"day": "daily", "week": "weekly", "month": "monthly", "year": "yearly"}
PER_YEAR = {"day": Decimal("365.25"), "week": Decimal("365.25") / 7, "month": Decimal(12), "year": Decimal(1)}
# How an account's flow reads: income and equity are credits, shown inverted as everywhere.
_SIGN = {"income": -1, "equity": -1}


class BudgetRefused(ValueError):
    """A budget that isn't allowed: the input's problem (422)."""


@dataclass(frozen=True)
class Version:
    id: str
    account: str
    start: datetime.date
    amount: Decimal
    currency: str
    every: int
    unit: str
    updated_at: str

    @property
    def per_year(self) -> Decimal:
        return self.amount * PER_YEAR[self.unit] / self.every

    def model(self) -> models.Budget:
        return models.Budget(
            id=self.id,
            account=self.account,
            start=self.start,
            amount=models.Amount(number=engine.decimal_text(self.amount), currency=self.currency),
            every=self.every,
            unit=self.unit,
            updated_at=self.updated_at,
        )


def _parsed(text: str) -> tuple[str, str, int, Decimal, str] | None:
    """A budget directive's account, unit, count, amount and currency; None for anything else."""
    entries, errors, _ = parser.parse_string(text)
    if errors or len(entries) != 1 or not isinstance(entries[0], data.Custom) or entries[0].type != TYPE:
        return None
    entry = entries[0]
    values = entry.values
    if len(values) < 3 or values[1].value not in WORDS or not hasattr(values[2].value, "number"):
        return None
    account = values[0].value
    if not isinstance(account, str):
        return None
    unit, count = WORDS[values[1].value]
    every = entry.meta.get("every", 1)
    return account, unit, count * int(every), values[2].value.number, values[2].value.currency


def versions(ledger: Ledger, book_id: str) -> list[Version]:
    """Every budget version in the book, by account, then start."""
    found = []
    for row in ledger.store.find(book_id, kind="custom", limit=None):
        parsed = row.text and _parsed(row.text)
        if parsed:
            account, unit, every, amount, currency = parsed
            found.append(
                Version(row.id, account, datetime.date.fromisoformat(row.date), amount, currency, every, unit, row.updated_at)
            )
    return sorted(found, key=lambda v: (v.account, v.start))


def _text(account: str, start: datetime.date, amount: Decimal, currency: str, every: int, unit: str) -> str:
    word, count = UNIT_WORDS[unit], every
    if unit == "month" and every % 3 == 0:
        word, count = "quarterly", every // 3
    name = account if ":" in account else f'"{account}"'
    text = f'{start.isoformat()} custom "{TYPE}" {name} "{word}" {engine.decimal_text(amount)} {currency}\n'
    return text + (f"  every: {count}\n" if count > 1 else "")


def in_force(history: list[Version], on: datetime.date) -> Version | None:
    """The version in force on a day (an account's versions, in order), if it budgets anything."""
    current = None
    for v in history:
        if v.start <= on:
            current = v
    return current if current and current.amount > 0 else None


def _ancestors(name: str) -> list[str]:
    parts = name.split(":")
    return [":".join(parts[:i]) for i in range(1, len(parts))]


def _check(account: str, candidate: Version, everything: list[Version]) -> None:
    """Refuse a version that would put a budget above one on an account above it, or one on an
    account under it above this one, on any day from its start."""
    by_account: dict[str, list[Version]] = {}
    for v in everything:
        if not (v.account == account and v.start == candidate.start):
            by_account.setdefault(v.account, []).append(v)
    by_account.setdefault(account, []).append(candidate)
    for history in by_account.values():
        history.sort(key=lambda v: v.start)
    above = [a for a in _ancestors(account) if a in by_account]
    below = [a for a in by_account if a.startswith(account + ":")]
    days = sorted(
        {candidate.start}
        | {v.start for a in [account, *above, *below] for v in by_account[a] if v.start > candidate.start}
    )
    for day in days:
        mine = in_force(by_account[account], day)
        if mine is None:
            continue
        for a in above:
            theirs = in_force(by_account[a], day)
            if theirs is not None and mine.per_year > theirs.per_year:
                raise BudgetRefused(f"{account}'s budget would be more than {a}'s, which is over it")
        for a in below:
            theirs = in_force(by_account[a], day)
            if theirs is not None and theirs.per_year > mine.per_year:
                raise BudgetRefused(f"{a}'s budget, under it, would be more than {account}'s")


def put(ledger: Ledger, book_id: str, account: str, b: models.BudgetIn) -> models.Budget | None:
    """Write the version of `account`'s budget starting `b.start` (new, or replacing the one
    there). Ending a budget that has nothing before it removes it instead; returns None then."""
    accounts = {a.name: a for a in ledger.accounts(book_id)}
    if account not in accounts:
        raise NotFound(account)
    if accounts[account].type is None:
        raise BudgetRefused(f"{account} isn't under a known top-level account")
    amount = Decimal(b.amount)
    if amount < 0:
        raise BudgetRefused("a budget is 0 or more")
    everything = versions(ledger, book_id)
    mine = [v for v in everything if v.account == account]
    there = next((v for v in mine if v.start == b.start), None)
    if there is not None and b.updated_at != there.updated_at:
        ledger.store.check_version(book_id, there.id, b.updated_at or "")
    currency = investments.operating_currency(ledger._header(book_id))
    if amount == 0 and in_force([v for v in mine if v.start < b.start], b.start) is None:
        if there is not None:
            ledger.delete(book_id, there.id, expected=there.updated_at)
        return None
    candidate = Version(there.id if there else "", account, b.start, amount, currency, b.every, b.unit, "")
    _check(account, candidate, everything)
    directive = engine.parse_one(_text(account, b.start, amount, currency, b.every, b.unit), there.id if there else None)
    ledger._put(book_id, directive, there.updated_at if there else None)
    written = next(v for v in versions(ledger, book_id) if v.id == directive.id)
    return written.model()


# Periods


def _add_months(start: datetime.date, months: int) -> datetime.date:
    year, month = divmod(start.month - 1 + months, 12)
    year += start.year
    return datetime.date(year, month + 1, min(start.day, calendar.monthrange(year, month + 1)[1]))


def period_on(v: Version, on: datetime.date) -> tuple[datetime.date, datetime.date]:
    """The version's period that `on` falls in: [start, end), counted from the version's start."""
    if v.unit in ("day", "week"):
        step = v.every * (7 if v.unit == "week" else 1)
        k = (on - v.start).days // step
        start = v.start + datetime.timedelta(days=k * step)
        return start, start + datetime.timedelta(days=step)
    months = v.every * (12 if v.unit == "year" else 1)
    k = ((on.year - v.start.year) * 12 + on.month - v.start.month) // months
    if _add_months(v.start, k * months) > on:
        k -= 1
    return _add_months(v.start, k * months), _add_months(v.start, (k + 1) * months)


def _month(on: datetime.date) -> tuple[datetime.date, datetime.date]:
    first = on.replace(day=1)
    return first, _add_months(first, 1)


# Status


def status(ledger: Ledger, book_id: str, on: datetime.date, basis: Literal["period", "month"]) -> models.BudgetStatus:
    """Every budget in force on `on` (on accounts that aren't archived), measured over its current
    period (or, by `basis="month"`, restated per month and measured over `on`'s month)."""
    accounts = {a.name: a for a in ledger.accounts(book_id)}
    currency = investments.operating_currency(ledger._header(book_id))
    histories: dict[str, list[Version]] = {}
    for v in versions(ledger, book_id):
        histories.setdefault(v.account, []).append(v)
    current = {
        name: v
        for name, history in histories.items()
        if (v := in_force(history, on)) is not None
        and name in accounts
        and not (accounts[name].close and accounts[name].close <= on)
    }

    flows: dict[tuple[str, datetime.date, datetime.date], tuple[Decimal, Decimal, dict[str, Decimal]]] = {}

    def flow(name: str, span: tuple[datetime.date, datetime.date]) -> tuple[Decimal, Decimal, dict[str, Decimal]]:
        """The account's flow over [start, end), as it reads: (all of it, the unconfirmed part,
        other currencies)."""
        key = (name, *span)
        if key not in flows:
            sign = _SIGN.get(accounts[name].type or "", 1)
            total, unconfirmed, others = Decimal(0), Decimal(0), {}
            for row in ledger.store.flow(book_id, name, span[0].isoformat(), span[1].isoformat()):
                if row["amount"] is None:
                    continue
                number = Decimal(row["amount"]) * sign
                if row["currency"] != currency:
                    others[row["currency"]] = others.get(row["currency"], Decimal(0)) + number
                    continue
                total += number
                if row["flag"] == "!":
                    unconfirmed += number
            flows[key] = (total, unconfirmed, others)
        return flows[key]

    def money(number: Decimal) -> models.Amount:
        return models.Amount(number=engine.decimal_text(number.quantize(CENT)), currency=currency)

    def span_of(v: Version) -> tuple[datetime.date, datetime.date]:
        return period_on(v, on) if basis == "period" else _month(on)

    def amount_of(v: Version, per: Version | None = None) -> Decimal:
        """The version's budget per period of `per` (itself by default), or per month."""
        if basis == "month":
            return v.per_year / 12
        per = per or v
        return v.amount if per is v else v.per_year / (PER_YEAR[per.unit] / per.every)

    def budgeted_above(name: str) -> list[str]:
        return [a for a in _ancestors(name) if a in current]

    lines = []
    for name, v in sorted(current.items()):
        span = span_of(v)
        budget = amount_of(v)
        total, unconfirmed, others = flow(name, span)
        # The nearest budgeted accounts down each branch: those with no budgeted account between.
        nearest = [
            d for d in current if d.startswith(name + ":") and not any(a in current for a in _ancestors(d) if a.startswith(name + ":"))
        ]
        other = None
        problems = [
            f"More than {a}'s budget, which is over it" for a in budgeted_above(name) if v.per_year > current[a].per_year
        ]
        if nearest:
            rest_budget = budget - sum((amount_of(current[d], v) for d in nearest), Decimal(0))
            rest_spent = total - sum((flow(d, span)[0] for d in nearest), Decimal(0))
            other = models.BudgetOther(budget=money(rest_budget), spent=money(rest_spent), left=money(rest_budget - rest_spent))
            if rest_budget < 0:
                problems.append("The budgets under it add up to more than it")
        lines.append(
            models.BudgetLine(
                account=name,
                type=accounts[name].type,
                kind="limit" if accounts[name].type == "expense" else "goal",
                version=v.model(),
                period_start=span[0],
                period_end=span[1],
                budget=money(budget),
                spent=money(total),
                unconfirmed=money(unconfirmed),
                left=money(budget - total),
                other_currencies=[
                    models.Amount(number=engine.decimal_text(n), currency=c) for c, n in sorted(others.items()) if n
                ],
                other=other,
                problems=problems,
            )
        )

    tops = [name for name in current if accounts[name].type == "expense" and not budgeted_above(name)]
    summary = None
    if tops:
        month = _month(on)
        summary = models.BudgetSummary(
            month_start=month[0],
            budget=money(sum((current[name].per_year / 12 for name in tops), Decimal(0))),
            spent=money(sum((flow(name, month)[0] for name in tops), Decimal(0))),
        )
    return models.BudgetStatus(on=on, basis=basis, lines=lines, summary=summary)


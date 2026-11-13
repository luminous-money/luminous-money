"""Outflows (Loans step 2): spending as it's felt, not only as it's booked.

A loan's payment pays down a debt (an asset bought long ago), and an escrow payment fills an
account the lender holds; neither is an expense in the books, but both feel like the month's
spending. So an asset or liability can **count as spending** (`outflow:` on its `open`, naming an
expense account, for it and its subtree):

- what's paid **into** it counts as spending, as that expense account (a split added in the lens,
  marked `outflow_of`);
- what's paid **out of** it masks the spending it pays for: first the transaction's expenses (the
  county's tax bill paid from escrow was spent as escrow went in), then what it pays into another
  account that counts (escrow's surplus applied to principal), each in proportion, in cents;
- borrowing (the liability going the other way), a refund out of it, and everything else are left
  as they are: never spending.

Only the operating currency is counted. The lens adds and scales splits; it doesn't balance, and
it's only for reading spending (budgets, reports), never for balances. A split it adds has the
tags of the split it comes from, so reports by tag count it.
"""

from __future__ import annotations

from decimal import Decimal

from . import models

CENT = Decimal("0.01")


def targets(accounts: list[models.Account]) -> dict[str, str]:
    """Each asset or liability that counts as spending, with the expense account it counts as."""
    return {
        a.name: a.outflow
        for a in accounts
        if a.outflow and a.type in ("asset", "liability") and not a.implicit
    }


def target_of(account: str, found: dict[str, str]) -> tuple[str, str] | None:
    """The account (or its nearest ancestor) that counts as spending, and what it counts as."""
    parts = account.split(":")
    for i in range(len(parts), 0, -1):
        name = ":".join(parts[:i])
        if name in found:
            return name, found[name]
    return None


def _shared(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """`total` shared out in proportion to `weights`, in cents, the last taking what rounding left."""
    whole = sum(weights, Decimal(0))
    if not weights or whole == 0:
        return [Decimal(0)] * len(weights)
    parts = [(total * w / whole).quantize(CENT) for w in weights[:-1]]
    return [*parts, total - sum(parts, Decimal(0))]


def lensed(
    t: models.CompactTransaction,
    found: dict[str, str],
    is_expense,
    currency: str,
) -> models.CompactTransaction:
    """A transaction as outflows read it: expenses masked by what came out of an account that
    counts as spending, and what went into one added as spending."""
    if not found:
        return t

    def amount(p: models.CompactPosting) -> Decimal | None:
        return Decimal(p.amount.number) if p.amount and p.amount.currency == currency else None

    expenses = [i for i, p in enumerate(t.postings) if is_expense(p.account) and amount(p) is not None]
    proxies = [(i, target_of(p.account, found)) for i, p in enumerate(t.postings) if amount(p) is not None]
    proxies = [(i, hit) for i, hit in proxies if hit is not None]
    if not proxies:
        return t
    out = sum((-amount(t.postings[i]) for i, _ in proxies if amount(t.postings[i]) < 0), Decimal(0))
    into = [(i, hit) for i, hit in proxies if amount(t.postings[i]) > 0]

    # What came out masks the expenses first, then what went into another that counts.
    spent = sum((amount(t.postings[i]) for i in expenses), Decimal(0))
    masked_expenses = min(out, spent) if spent > 0 else Decimal(0)
    paid_in = sum((amount(t.postings[i]) for i, _ in into), Decimal(0))
    masked_in = min(out - masked_expenses, paid_in)

    postings = list(t.postings)
    if masked_expenses:
        weights = [amount(postings[i]) for i in expenses]
        for i, cut in zip(expenses, _shared(masked_expenses, weights)):
            left = amount(postings[i]) - cut
            postings[i] = postings[i].model_copy(
                update={"amount": models.Amount(number=str(left), currency=currency)}
            )
    cuts = _shared(masked_in, [amount(t.postings[i]) for i, _ in into]) if masked_in else [Decimal(0)] * len(into)
    added = [
        models.CompactPosting(
            account=target,
            amount=models.Amount(number=str(amount(t.postings[i]) - cut), currency=currency),
            flag=t.postings[i].flag,
            tags=t.postings[i].tags,
            outflow_of=proxy,
        )
        for (i, (proxy, target)), cut in zip(into, cuts)
        if amount(t.postings[i]) - cut != 0
    ]
    kept = [p for i, p in enumerate(postings) if not (i in expenses and amount(p) == 0)]
    return t.model_copy(update={"postings": kept + added})

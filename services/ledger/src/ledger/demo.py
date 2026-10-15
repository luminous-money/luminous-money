"""Demo books: realistic history from `bean-example`, with recent purchases staged for review.

The last few weeks of card and checking purchases become what the review queue will see once
bank feeds exist: transactions flagged `!` and marked `source: "demo-import"`. About half are
moved to `Expenses:Uncategorized`, like raw imports; the rest keep their category, like
proposals from a resolver. Amounts never change, so the book validates exactly as the generated
history did.

    python -m ledger.demo --years 2 --staged-days 45 > demo.beancount

`scripts/seed-demo.sh` (`pnpm seed`) imports the output into a running stack.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import re
import subprocess
import sys

from . import engine, models

UNCATEGORIZED = "Expenses:Uncategorized"
FUNDING = ("Assets:", "Liabilities:")


def generate(years: int, seed: int, today: datetime.date) -> str:
    begin = today.replace(year=today.year - years)
    return subprocess.run(
        ["bean-example", "--date-begin", begin.isoformat(), "--date-end", today.isoformat(), "--seed", str(seed)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


#: The accounts `pnpm seed` stars, so the home page has something to show, with human names.
#: (Keep in step with `scripts/seed-demo.sh`.)
STARRED = {"Assets:US:BofA:Checking": "BofA Checking", "Liabilities:US:Chase:Slate": "Chase Slate"}


def demo_ledger(history: str, staged_days: int, today: datetime.date) -> str:
    """Stage the recent purchases in `history` (a Beancount ledger) and return the new ledger,
    titled "Demo", with display names on the accounts it stars."""
    # bean-example names Google as the price source, which beanprice no longer has; its tickers
    # are real funds, so fetch them from Yahoo instead.
    history = re.sub(r'price: "USD:google/(?:[A-Z]+:)?([A-Z0-9.]+)"', r'price: "USD:yahoo/\1"', history)
    for account, name in STARRED.items():
        meta = f'  {engine.DISPLAY_NAME_KEY}: "{name}"\n'
        history = re.sub(rf"^(\d{{4}}-\d\d-\d\d open {re.escape(account)}\b.*\n)", rf"\g<1>{meta}", history, count=1, flags=re.M)
    parsed = engine.parse_text(history)
    since = today - datetime.timedelta(days=staged_days)
    first = min(d.date for d in parsed.directives)

    texts = [engine.parse_one(f"{first.isoformat()} open {UNCATEGORIZED}\n").text]
    for directive in parsed.directives:
        if directive.kind == "transaction" and directive.date >= since:
            [(_, transaction)] = engine.transactions([directive.text])
            if is_purchase(transaction):
                directive = engine.transaction_directive(stage(directive.id, transaction), directive.id)
        texts.append(directive.text)
    return engine.render(engine.with_title(parsed.header, "Demo"), texts)


#: The second demo book's account `pnpm seed` stars.
HOUSEHOLD_STARRED = {"Assets:Bank:Joint-Checking": "Joint Checking"}


def household_ledger(today: datetime.date, months: int = 4, staged_days: int = 14) -> str:
    """A small, made-up shared household book, titled "Demo Household": a joint checking account
    two people pay into, with rent, utilities and groceries. Purchases in the last
    `staged_days` are staged, as in the main demo. Deterministic for a given `today`."""
    checking = "Assets:Bank:Joint-Checking"
    begin = (today.replace(day=1) - datetime.timedelta(days=31 * months)).replace(day=1)
    usd = lambda n: models.Amount(number=f"{n:.2f}", currency="USD")  # noqa: E731
    vary = lambda key, low, high: low + int(hashlib.sha256(key.encode()).hexdigest(), 16) % (high - low)  # noqa: E731

    def pay(date, payee, narration, account, amount):
        return models.TransactionIn(
            date=date,
            flag="*",
            payee=payee,
            narration=narration,
            postings=[
                models.Posting(account=checking, units=usd(-amount)),
                models.Posting(account=account, units=usd(amount)),
            ],
        )

    accounts = ["Equity:Opening-Balances", "Income:Contributions:Kael", "Income:Contributions:Jess",
                "Expenses:Home:Rent", "Expenses:Home:Utilities", "Expenses:Food:Groceries", UNCATEGORIZED]
    texts = [engine.parse_one(f'{begin.isoformat()} open {checking} USD\n  {engine.DISPLAY_NAME_KEY}: "Joint Checking"\n').text]
    texts += [engine.parse_one(f"{begin.isoformat()} open {a}\n").text for a in accounts]
    batch = [models.TransactionIn(
        date=begin, flag="*", payee=None, narration="Opening balance",
        postings=[models.Posting(account=checking, units=usd(1200)), models.Posting(account="Equity:Opening-Balances", units=None)],
    )]
    day = begin
    while day <= today:
        if day.day == 1:
            for person in ("Kael", "Jess"):
                batch.append(models.TransactionIn(
                    date=day, flag="*", payee=person, narration="Monthly contribution",
                    postings=[models.Posting(account=checking, units=usd(1600)),
                              models.Posting(account=f"Income:Contributions:{person}", units=None)],
                ))
            batch.append(pay(day, "Maple Street Rentals", "Rent", "Expenses:Home:Rent", 2400))
        if day.day == 15:
            batch.append(pay(day, "City Power & Water", "Utilities", "Expenses:Home:Utilities", vary(f"u{day}", 90, 160)))
        if day.weekday() == 5:
            batch.append(pay(day, "Green Grocer", "Groceries", "Expenses:Food:Groceries", vary(f"g{day}", 60, 150) + 0.37))
        day += datetime.timedelta(days=1)
    since = today - datetime.timedelta(days=staged_days)
    for t in batch:
        directive_id = engine.new_id()
        if t.date >= since and is_purchase(t) and t.postings[1].account.startswith("Expenses:Food"):
            t = stage(directive_id, t)
        texts.append(engine.transaction_directive(t, directive_id).text)
    return engine.render(engine.with_title(['option "operating_currency" "USD"'], "Demo Household"), texts)


def is_purchase(t: models.TransactionIn) -> bool:
    """One expense paid from one bank or card account: what a bank feed delivers."""
    if len(t.postings) != 2:
        return False
    expense, funding = sorted(t.postings, key=lambda p: not p.account.startswith("Expenses:"))
    return expense.account.startswith("Expenses:") and funding.account.startswith(FUNDING) and expense.units is not None


def stage(directive_id: str, t: models.TransactionIn) -> models.TransactionIn:
    uncategorized = int(hashlib.sha256(directive_id.encode()).hexdigest(), 16) % 2 == 0
    postings = [
        p.model_copy(update={"account": UNCATEGORIZED}) if uncategorized and p.account.startswith("Expenses:") else p
        for p in t.postings
    ]
    return models.TransactionIn(
        **t.model_dump(exclude={"flag", "meta", "postings"}),
        flag="!",
        meta={**t.meta, "source": "demo-import"},
        postings=postings,
    )


def main() -> None:
    args = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    args.add_argument("--years", type=int, default=2, help="years of history (default 2)")
    args.add_argument("--staged-days", type=int, default=45, help="stage purchases this recent (default 45)")
    args.add_argument("--seed", type=int, default=3, help="bean-example random seed (default 3)")
    args.add_argument("--household", action="store_true", help="the small second demo book instead")
    opts = args.parse_args()

    today = datetime.date.today()
    if opts.household:
        sys.stdout.write(household_ledger(today))
        return
    sys.stdout.write(demo_ledger(generate(opts.years, opts.seed, today), opts.staged_days, today))


if __name__ == "__main__":
    main()

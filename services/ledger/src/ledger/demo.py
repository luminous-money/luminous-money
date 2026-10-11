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


#: The demo's money account, so the home page has something to show.
MONEY_ACCOUNT = "Assets:US:BofA:Checking"
MONEY_META = '  money: "bank"\n  display-name: "BofA Checking"\n  institution: "Bank of America"\n'


def demo_ledger(history: str, staged_days: int, today: datetime.date) -> str:
    """Stage the recent purchases in `history` (a Beancount ledger) and return the new ledger,
    titled "Demo", with its checking account marked as a money account."""
    history = re.sub(rf"^(\d{{4}}-\d\d-\d\d open {re.escape(MONEY_ACCOUNT)}\b.*\n)", rf"\1{MONEY_META}", history, count=1, flags=re.M)
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
    opts = args.parse_args()

    today = datetime.date.today()
    sys.stdout.write(demo_ledger(generate(opts.years, opts.seed, today), opts.staged_days, today))


if __name__ == "__main__":
    main()

"""Benchmark the ledger service on a decades-scale synthetic book.

Builds the book from several `bean-example` histories (different seeds), each under its own
account subtree, so the transaction count scales without duplicating data. Run it on the target
hardware:

    docker run --rm fava-beans-ledger:test python bench/bench.py --years 20 --copies 5
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import resource
import subprocess
import tempfile
import time
from contextlib import contextmanager

from ledger.service import Ledger
from ledger.store import Store

ROOTS = re.compile(r"\b(Assets|Liabilities|Equity|Income|Expenses):")
STAGED = '{date} ! "Bench" "Staged write"\n  Expenses:Bench   4.50 USD\n  Assets:Bench\n'

results: list[tuple[str, float]] = []


@contextmanager
def timed(label: str):
    start = time.perf_counter()
    yield
    results.append((label, time.perf_counter() - start))


def generate(path: str, years: int, copies: int) -> None:
    end = datetime.date.today()
    begin = end.replace(year=end.year - years)
    parts = []
    for i in range(copies):
        out = subprocess.run(
            ["bean-example", "--date-begin", begin.isoformat(), "--date-end", end.isoformat(), "--seed", str(i)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        if i > 0:
            # Same commodities and options as copy 0; everything else moves to its own subtree.
            out = "\n".join(line for line in out.splitlines() if not line.startswith(("option", "plugin")))
            out = re.sub(r"^\d{4}-\d\d-\d\d commodity .*\n(?:  .*\n)*", "", out + "\n", flags=re.MULTILINE)
            out = ROOTS.sub(rf"\1:C{i}:", out)
        parts.append(out)
    parts.append(f"{begin} open Expenses:Bench\n{begin} open Assets:Bench\n")
    with open(path, "w") as f:
        f.write("\n".join(parts))


def main() -> None:
    args = argparse.ArgumentParser()
    args.add_argument("--years", type=int, default=20)
    args.add_argument("--copies", type=int, default=5)
    opts = args.parse_args()

    work = tempfile.mkdtemp()
    source = os.path.join(work, "source.beancount")
    with timed("generate synthetic ledger"):
        generate(source, opts.years, opts.copies)

    ledger = Ledger(Store(os.path.join(work, "ledger.sqlite")))
    with timed("import (parse, canonicalize, insert)"):
        ledger.apply_file("bench", source)

    rows = ledger.store.live("bench")
    counts = {}
    for r in rows:
        counts[r.kind] = counts.get(r.kind, 0) + 1

    with timed("full load: render + book + plugins + validate (cold)"):
        loaded = ledger.load("bench")
    with timed("full load (cached, unchanged book)"):
        ledger.load("bench")

    today = datetime.date.today()
    with timed("write: create one staged transaction"):
        created = ledger.create("bench", STAGED.format(date=today))
    with timed("write: confirm it"):
        ledger.set_flag("bench", created.id, "*")
    with timed("revalidate after a write (full load)"):
        problems = ledger.problems("bench")

    with timed("SQL: review queue (flag = '!')"):
        ledger.store.find("bench", flag="!", limit=1000)
    window = today - datetime.timedelta(days=14 * 31)
    with timed("SQL: 14-month resolver context (all accounts)"):
        context = ledger.store.find("bench", date_from=window, limit=1_000_000)
    with timed("SQL: one account subtree, 14 months"):
        ledger.store.find("bench", account="Assets:US", date_from=window, limit=1_000_000)

    with timed("BQL: balances by account"):
        ledger.query("bench", "SELECT account, sum(position) GROUP BY account")
    with timed("BQL: monthly expenses, last year"):
        ledger.query(
            "bench",
            f"SELECT year, month, sum(cost(position)) WHERE account ~ '^Expenses' AND date >= {today.year - 1}-01-01 GROUP BY year, month",
        )

    with timed("export (whole book as Beancount text)"):
        exported = ledger.export("bench")
    with timed("backup: full"):
        full = ledger.backup()
    ledger.create("bench", STAGED.format(date=today))
    with timed("backup: incremental (one change)"):
        ledger.backup(full.cursor)

    ledger.store._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db_bytes = sum(
        os.path.getsize(os.path.join(work, f)) for f in os.listdir(work) if f.startswith("ledger.sqlite")
    )
    peak_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

    print(f"\nSynthetic book: {opts.years} years x {opts.copies} histories")
    print("  " + ", ".join(f"{n} {k}" for k, n in sorted(counts.items(), key=lambda kv: -kv[1])))
    print(f"  {len(loaded.entries)} booked entries, {len(problems)} problems, {len(context)} directives in the 14-month context")
    print(f"  database {db_bytes / 1e6:.1f} MB, export {len(exported) / 1e6:.1f} MB, peak RSS {peak_mb:.0f} MB\n")
    width = max(len(label) for label, _ in results)
    for label, seconds in results:
        print(f"  {label:<{width}}  {seconds * 1000:>9.1f} ms")


if __name__ == "__main__":
    main()

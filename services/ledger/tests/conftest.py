from __future__ import annotations

import os
import subprocess

import pytest
from beancount.core import data
from beancount.parser import printer

from ledger.service import Ledger
from ledger.store import Store

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
FEATURES = os.path.join(FIXTURES, "features.beancount")


@pytest.fixture
def ledger(tmp_path) -> Ledger:
    return Ledger(Store(str(tmp_path / "ledger.sqlite")), export_dir=str(tmp_path))


@pytest.fixture(scope="session")
def example_ledger(tmp_path_factory) -> str:
    """A realistic multi-year ledger from Beancount's own generator."""
    path = tmp_path_factory.mktemp("example") / "example.beancount"
    subprocess.run(
        ["bean-example", "--date-begin", "2021-01-01", "--date-end", "2024-01-01", "--seed", "7", "-o", str(path)],
        check=True,
        capture_output=True,
    )
    return str(path)


def canonical(entries: list[data.Directive]) -> list[str]:
    """Booked entries as text, ignoring where they came from (file, line, our ID)."""
    out = []
    for entry in entries:
        meta = {k: v for k, v in entry.meta.items() if k not in ("filename", "lineno", "id")}
        if isinstance(entry, data.Transaction):
            entry = entry._replace(
                postings=[
                    # Plugins such as `pad` copy the source directive's metadata, our ID included,
                    # onto the postings they generate.
                    p._replace(meta={k: v for k, v in (p.meta or {}).items() if k not in ("filename", "lineno", "id")})
                    for p in entry.postings
                ]
            )
        out.append(printer.format_entry(entry._replace(meta=meta)))
    return out


STAGED = """\
2024-03-01 ! "Corner Cafe" "Coffee"
  Expenses:Food   4.50 USD
  Assets:Bank:Checking
"""

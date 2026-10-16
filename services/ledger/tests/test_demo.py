import datetime
import re
import subprocess

import pytest

from ledger import demo

TODAY = datetime.date(2026, 10, 1)


@pytest.fixture(scope="module")
def history() -> str:
    return demo.generate(years=1, seed=3, today=TODAY)


def test_recent_purchases_are_staged_some_uncategorized(ledger, history):
    ledger.apply_text("demo", demo.demo_ledger(history, staged_days=21, today=TODAY))

    staged = ledger.transactions("demo", flag="!")
    accounts = [p.account for t in staged for p in t.postings]

    assert len(staged) >= 10
    assert all(t.meta.get("source") == "demo-import" for t in staged)
    assert all(t.date >= TODAY - datetime.timedelta(days=21) for t in staged)
    assert demo.UNCATEGORIZED in accounts
    assert any(a.startswith("Expenses:") and a != demo.UNCATEGORIZED for a in accounts)


def test_staging_changes_no_amounts_so_validation_is_unchanged(ledger, history):
    ledger.apply_text("original", history)
    ledger.apply_text("demo", demo.demo_ledger(history, staged_days=21, today=TODAY))

    # Problems carry a line number, and the added metadata shifts lines; compare the rest.
    def messages(book):
        return [re.sub(r"^<string>:\d+: ", "", p.message) for p in ledger.problems(book)]

    original, staged = messages("original"), messages("demo")

    assert staged == original
    assert ledger.query("demo", "SELECT sum(position) WHERE account ~ '^Assets'")[1] == ledger.query(
        "original", "SELECT sum(position) WHERE account ~ '^Assets'"
    )[1]


def test_the_cli_prints_a_ledger():
    out = subprocess.run(
        ["python", "-m", "ledger.demo", "--years", "1", "--staged-days", "7"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    assert 'source: "demo-import"' in out
    assert f"open {demo.UNCATEGORIZED}" in out


def test_the_demo_has_a_title_and_named_accounts_to_star(ledger, history):
    ledger.apply_text("demo", demo.demo_ledger(history, staged_days=21, today=TODAY))

    assert ledger.book("demo").name == "Demo"
    summary = ledger.summary("demo", list(demo.STARRED))
    assert {a.name: a.display_name for a in summary} == demo.STARRED


def test_the_demo_fetches_prices_from_a_source_beanprice_has(history):
    out = demo.demo_ledger(history, staged_days=21, today=TODAY)

    assert "USD:google/" not in out
    assert 'price: "USD:yahoo/' in out


def test_the_household_demo_is_a_small_valid_book_with_some_purchases_staged(ledger):
    ledger.apply_text("household", demo.household_ledger(TODAY))

    staged = ledger.transactions("household", flag="!")

    assert ledger.book("household").name == "Demo Household"
    assert ledger.problems("household") == []
    assert staged and all(t.date >= TODAY - datetime.timedelta(days=14) for t in staged)
    # Which staged purchases are left uncategorized depends on their (random) IDs.
    assert all("Assets:Bank:Joint-Checking" in {p.account for p in t.postings} for t in staged)
    assert list(demo.HOUSEHOLD_STARRED) == ["Assets:Bank:Joint-Checking"]
    assert float(ledger.balance("household", "Assets:Bank:Joint-Checking")[0].number) > 0

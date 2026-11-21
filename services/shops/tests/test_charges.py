"""A charge Amazon dates anew between syncs is the same charge (2026-11-21), with made-up charges:
no real ones here."""

import datetime

from shops.amazon import redated
from shops.db import Db

SINCE = datetime.date(2026, 3, 1)


def row(id: str, date: str, amount: str = "-86.55", order: str | None = "111-1", last4: str | None = "4242") -> dict:
    return {
        "id": id,
        "date": date,
        "amount": amount,
        "last4": last4,
        "payment_method": "Visa",
        "order_number": order,
        "seller": "Amazon.com",
        "order_link": None,
    }


def test_a_charge_dated_a_day_later_is_the_one_kept() -> None:
    kept = [row("a", "2026-03-10"), row("other", "2026-03-05", "-5.00", "222-2")]
    listed = [row("b", "2026-03-11"), row("other", "2026-03-05", "-5.00", "222-2")]
    assert redated(kept, listed, SINCE) == {"b": "a"}


def test_one_kept_under_both_dates_is_one_charge_under_the_first() -> None:
    kept = [row("a", "2026-03-10"), row("b", "2026-03-11")]
    assert redated(kept, [row("b", "2026-03-11")], SINCE) == {"b": "a"}


def test_two_charges_of_one_amount_both_listed_are_two() -> None:
    both = [row("a", "2026-03-10"), row("b", "2026-03-11")]
    assert redated(both, both, SINCE) == {}


def test_only_the_same_order_amount_and_card_nearby_is_the_same_charge() -> None:
    kept = [row("a", "2026-03-10")]
    assert redated(kept, [row("b", "2026-03-11", order="111-2")], SINCE) == {}
    assert redated(kept, [row("b", "2026-03-11", amount="-86.50")], SINCE) == {}
    assert redated(kept, [row("b", "2026-03-11", last4="1881")], SINCE) == {}
    assert redated(kept, [row("b", "2026-03-14")], SINCE) == {}
    assert redated([row("a", "2026-03-10", order=None)], [row("b", "2026-03-11", order=None)], SINCE) == {}


def test_one_from_before_what_was_read_isnt_missing() -> None:
    assert redated([row("a", "2026-03-01")], [row("b", "2026-03-02")], SINCE) == {}


def test_each_listed_charge_is_at_most_one_kept_the_earliest() -> None:
    kept = [row("a", "2026-03-10"), row("b", "2026-03-11")]
    listed = [row("c", "2026-03-12")]
    assert redated(kept, listed, SINCE) == {"c": "a"}


def test_kept_the_charge_takes_its_new_date_and_the_double_goes(tmp_path) -> None:
    db = Db(str(tmp_path / "shops.sqlite"))
    db.put_charges("book", [row("a", "2026-03-10"), row("b", "2026-03-11")])
    kept = db.kept_charges("book", SINCE.isoformat())
    listed = [row("b", "2026-03-11")]
    moves = redated(kept, listed, SINCE)
    for r in listed:
        r["id"] = moves.get(r["id"], r["id"])
    assert db.put_charges("book", listed, merged=list(moves)) == 0
    assert [(c["id"], c["date"]) for c in db.charges("book")] == [("a", "2026-03-11")]

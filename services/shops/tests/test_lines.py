"""Amazon's charges as `app` takes them (shops.lines), with made-up orders: no real ones here."""

import datetime
from decimal import Decimal

from shops.amazon import belongs, read_window
from shops.lines import for_app, spread


def item(title: str, price: str, quantity: int = 1) -> dict:
    return {"title": title, "price": price, "quantity": quantity, "asin": None, "link": f"/dp/{title[:3]}"}


def order(number: str, items: list[dict], shipments: list[list[dict]] | None = None, **totals: str) -> dict:
    return {
        "order_number": number,
        "items": items,
        "shipments": [{"id": str(n), "status": "Delivered", "items": s} for n, s in enumerate(shipments or [items])],
        "totals": totals,
    }


def charge(id: str, amount: str, o: dict | None, last4: str | None = "4242", date: str = "2026-03-10") -> dict:
    return {
        "id": id,
        "date": date,
        "amount": amount,
        "last4": last4,
        "payment_method": "Visa",
        "order_number": o["order_number"] if o else None,
        "order_link": "https://www.amazon.com/order" if o else None,
        "seller": "Amazon.com",
        "order": o,
    }


def lines_of(c: dict) -> list[tuple[str, str, str | None]]:
    return [(line["text"], line["amount"], line["account"]) for line in c["lines"]]


def total(c: dict) -> Decimal:
    return sum(Decimal(line["amount"]) for line in c["lines"])


def test_a_whole_order_is_its_items_shipping_tax_and_what_paid_besides_the_card() -> None:
    o = order(
        "111-1",
        [item("Paper towels", "20.00"), item("Coffee", "6.00", 2)],
        grand_total="31.40",
        subtotal="32.00",
        shipping_total="5.99",
        free_shipping="-5.99",
        promotion_applied="-3.00",  # spread by price: 20 of 32, 12 of 32
        estimated_tax="2.40",
        gift_card="-0.00",
        reward_points="-0.00",
    )
    [c] = for_app([charge("c1", "-31.40", o)], "Income:Gifts", None)
    assert lines_of(c) == [
        ("Paper towels", "18.13", None),
        ("Coffee", "10.87", None),
        ("Tax", "2.40", None),
    ]
    assert c["note"] is None
    assert c["card"] == {"last_four": "4242", "brand": None}
    assert c["orders"] == [{"number": "111-1", "url": "https://www.amazon.com/order"}]
    assert c["lines"][1]["quantity"] == 2


def test_a_gift_card_and_points_are_lines_from_their_accounts() -> None:
    o = order("111-2", [item("Book", "25.00")], grand_total="12.00", estimated_tax="2.00", gift_card="-10.00", reward_points="-5.00")
    [c] = for_app([charge("c1", "-12.00", o)], "Income:Gifts", "Income:Rewards:Example-Visa")
    assert lines_of(c) == [
        ("Book", "25.00", None),
        ("Tax", "2.00", None),
        ("Gift card", "-10.00", "Income:Gifts"),
        ("Rewards points", "-5.00", "Income:Rewards:Example-Visa"),
    ]
    # Without a rewards account, points are as other payments.
    [c] = for_app([charge("c1", "-12.00", o)], "Income:Gifts", None)
    assert c["lines"][-1]["account"] == "Income:Gifts"


def test_a_refund_of_a_one_item_order_is_that_item_coming_back() -> None:
    o = order("111-3", [item("Kettle", "40.00")], grand_total="43.20", estimated_tax="3.20")
    [refund, paid] = for_app([charge("r1", "43.20", o, date="2026-03-20"), charge("c1", "-43.20", o)], "Income:Gifts", None)
    assert lines_of(refund) == [("Kettle", "-40.00", None), ("Tax", "-3.20", None)]
    assert total(paid) == Decimal("43.20")
    # Part of it back: shared between the item and its tax in proportion.
    [partial] = for_app([charge("r2", "10.80", o)], "Income:Gifts", None)
    assert lines_of(partial) == [("Kettle", "-10.00", None), ("Tax", "-0.80", None)]


def test_a_refund_is_the_item_in_the_shipment_amazon_marks_returned() -> None:
    lamp, bulbs = item("Lamp", "60.00"), item("Bulbs", "15.00")
    o = order("111-8", [lamp, bulbs], [[lamp], [bulbs]], grand_total="81.00", estimated_tax="6.00")
    o["shipments"][1]["status"] = "Return complete"
    [refund] = for_app([charge("r1", "16.20", o)], "Income:Gifts", None)
    assert lines_of(refund) == [("Bulbs", "-15.00", None), ("Tax", "-1.20", None)]
    assert "marks returned" in refund["note"]


def test_a_refund_is_the_items_whose_share_it_is_or_one_line_if_that_isnt_clear() -> None:
    lamp, bulbs, shade = item("Lamp", "60.00"), item("Bulbs", "15.00"), item("Shade", "25.00")
    o = order("111-9", [lamp, bulbs, shade], grand_total="108.00", estimated_tax="8.00")
    [refund] = for_app([charge("r1", "43.20", o)], "Income:Gifts", None)  # bulbs and shade
    assert lines_of(refund) == [("Bulbs", "-15.00", None), ("Shade", "-25.00", None), ("Tax", "-3.20", None)]
    # Two items of the same price: which came back isn't clear.
    a, b = item("Left glove", "20.00"), item("Right glove", "20.00")
    o = order("111-10", [a, b], grand_total="43.20", estimated_tax="3.20")
    [refund] = for_app([charge("r1", "21.60", o)], "Income:Gifts", None)
    assert lines_of(refund) == [("Refund: Left glove; Right glove", "-21.60", None)]


def test_after_the_first_sync_it_reads_back_15_days_before_the_last() -> None:
    today = datetime.date(2026, 11, 20)
    first = {"sync_from": "2026-07-25", "read_back_to": None, "last_sync_at": None}
    assert read_window(first, today) == (datetime.date(2026, 7, 25), datetime.date(2026, 7, 25))
    later = {**first, "read_back_to": "2026-07-25", "last_sync_at": "2026-11-13T06:00:00.000000Z"}
    assert read_window(later, today)[1] == datetime.date(2026, 10, 29)
    assert read_window({**later, "sync_from": "2026-11-01"}, today)[1] == datetime.date(2026, 11, 1)
    assert read_window({"sync_from": None, "read_back_to": None, "last_sync_at": None}, today)[1] == datetime.date(2026, 10, 21)


def test_a_split_order_is_charged_by_its_shipments_when_their_sums_say_which() -> None:
    a, b = item("Lamp", "60.00"), item("Bulbs", "15.00")
    o = order("111-4", [a, b], [[a], [b]], grand_total="81.00", estimated_tax="6.00")
    lamp, bulbs = for_app([charge("c1", "-64.80", o), charge("c2", "-16.20", o)], "Income:Gifts", None)
    assert lines_of(lamp) == [("Lamp", "60.00", None), ("Tax", "4.80", None)]
    assert lines_of(bulbs) == [("Bulbs", "15.00", None), ("Tax", "1.20", None)]
    assert "shipments' sums" in lamp["note"]


def test_one_it_cant_tell_is_one_line_naming_the_order() -> None:
    a, b = item("Lamp", "50.00"), item("Shade", "50.00")
    o = order("111-5", [a, b], [[a], [b]], grand_total="100.00")
    first, second = for_app([charge("c1", "-30.00", o), charge("c2", "-70.00", o)], "Income:Gifts", None)
    assert lines_of(first) == [("Part of Amazon order 111-5: Lamp; Shade", "30.00", None)]
    assert "doesn't say which items" in first["note"]
    assert total(second) == Decimal("70.00")


def test_one_whose_other_charges_arent_here_is_still_matched_to_its_shipment() -> None:
    a, b = item("Lamp", "60.00"), item("Bulbs", "15.00")
    o = order("111-6", [a, b], [[a], [b]], grand_total="81.00", estimated_tax="6.00")
    [bulbs] = for_app([charge("c2", "-16.20", o)], "Income:Gifts", None)  # the lamp's on another card
    assert lines_of(bulbs) == [("Bulbs", "15.00", None), ("Tax", "1.20", None)]


def test_one_whose_order_wasnt_read_is_one_line() -> None:
    [c] = for_app([charge("c1", "-9.99", None, last4=None)], "Income:Gifts", None)
    assert lines_of(c) == [("Amazon", "9.99", None)]
    assert c["card"] is None and c["orders"] == []
    assert c["note"] == "Its order hasn't been read."


def test_a_difference_from_amazons_total_goes_to_tax_or_a_line_of_its_own() -> None:
    o = order("111-7", [item("Mug", "10.00")], grand_total="10.83", estimated_tax="0.80")
    [c] = for_app([charge("c1", "-10.83", o)], "Income:Gifts", None)
    assert lines_of(c) == [("Mug", "10.00", None), ("Tax", "0.83", None)]


def test_spread_leaves_the_cents_to_the_largest() -> None:
    assert spread(Decimal("-1.00"), [Decimal(1), Decimal(1), Decimal(1)]) == [
        Decimal("-0.34"),
        Decimal("-0.33"),
        Decimal("-0.33"),
    ]
    assert sum(spread(Decimal("-1.00"), [Decimal(3), Decimal(1), Decimal(1)])) == Decimal("-1.00")


def test_a_charge_is_the_books_by_its_card() -> None:
    assert belongs("4242", set(), set())  # every card, when none is included
    assert belongs("4242", {"4242"}, set())
    assert not belongs("1881", {"4242"}, set())
    assert not belongs("4242", set(), {"4242"})
    assert belongs(None, {"4242"}, {"1881"})  # no card at all: always kept

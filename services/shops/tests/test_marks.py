"""Amazon's FSA or HSA mark (HSA tracking), from made-up pages shaped as Amazon's were when read
on Emmer (2026-11-19): no real orders here."""

import json
import os

from bs4 import BeautifulSoup

from shops.amazon import _only_looks, eligible_amount, invoice_path, invoiced, marked_eligible
from shops.db import Db
from shops.lines import for_app

from test_lines import charge, item, order


def element(html: str):
    return BeautifulSoup(html, "html.parser").div


def item_html(title: str, mark: str) -> str:
    return (
        '<div class="a-fixed-left-grid"><a href="/dp/B000">' + title + "</a>"
        '<div class="" data-component="healthBenefitAccountInformation">'
        f'<span class="a-size-small">{mark}</span></div></div>'
    )


def test_an_item_is_eligible_when_its_block_says_so_and_not_when_its_empty() -> None:
    assert marked_eligible(element(item_html("Thermometer", "FSA or HSA eligible")))
    assert not marked_eligible(element(item_html("Paperback", "")))
    assert not marked_eligible(element('<div class="a-fixed-left-grid"><a>Old page</a></div>'))
    assert not marked_eligible(None)


def test_the_orders_summary_says_its_eligible_amount() -> None:
    summary = element(
        "<div>"
        '<div class="a-row"><div class="od-line-item-row-label"><span>Item(s) Subtotal:</span></div>'
        '<div class="od-line-item-row-content"><span>$48.00</span></div></div>'
        '<div class="a-row"><div class="od-line-item-row-label"><span>FSA or HSA eligible: <br/>'
        "(inc. tax and shipping)</span></div>"
        '<div class="od-line-item-row-content"><span>$1,234.56</span></div></div>'
        "</div>"
    )
    assert eligible_amount(summary) == "1234.56"
    assert eligible_amount(element("<div><div class='od-line-item-row-label'>Total</div></div>")) is None


def eligible(title: str, price: str, quantity: int = 1) -> dict:
    return {**item(title, price, quantity), "hsa_fsa_eligible": True}


def marks(c: dict) -> list[tuple[str, bool]]:
    return [(line["text"], bool(line.get("hsa_fsa_eligible"))) for line in c["lines"]]


def test_an_eligible_items_line_says_so_and_a_mixed_charges_tax_doesnt() -> None:
    o = order("111-1", [eligible("Thermometer", "20.00"), item("Paperback", "10.00")], grand_total="32.40", estimated_tax="2.40")
    [c] = for_app([charge("c1", "-32.40", o)], "Income:Gifts", None)
    assert marks(c) == [("Thermometer", True), ("Paperback", False), ("Tax", False)]


def test_when_every_item_is_eligible_so_are_its_tax_and_shipping_but_not_a_gift_card() -> None:
    o = order(
        "111-2",
        [eligible("Pulse oximeter", "30.00"), eligible("Bandages", "5.00")],
        grand_total="35.80",
        shipping_total="2.99",
        estimated_tax="2.81",
        gift_card="-5.00",
    )
    [c] = for_app([charge("c1", "-35.80", o)], "Income:Gifts", None)
    assert marks(c) == [("Pulse oximeter", True), ("Bandages", True), ("Shipping", True), ("Tax", True), ("Gift card", False)]


def test_a_refunded_eligible_item_comes_back_marked() -> None:
    o = order("111-3", [eligible("Knee brace", "50.00")], grand_total="53.50", estimated_tax="3.50")
    [c] = for_app([charge("r1", "53.50", o)], "Income:Gifts", None)
    assert marks(c) == [("Knee brace", True), ("Tax", True)]
    assert [line["amount"] for line in c["lines"]] == ["-50.00", "-3.50"]


def test_orders_kept_before_marks_were_read_are_read_again_once(tmp_path) -> None:
    db = Db(str(tmp_path / "shops.sqlite"))
    db.put_order("b1", "111-old", "2026-03-01", order("111-old", [item("Coffee", "6.00")]))
    db.put_order("b1", "111-new", "2026-03-02", order("111-new", [{**item("Tea", "4.00"), "hsa_fsa_eligible": False}]))
    db.put_order("b2", "111-other", "2026-03-02", order("111-other", [item("Soap", "3.00")]))
    assert db.unmarked_orders("b1") == {"111-old"}
    db.put_order("b1", "111-old", "2026-03-01", json.loads(json.dumps(order("111-old", [eligible("Coffee", "6.00")]))))
    assert db.unmarked_orders("b1") == set()


class Route:
    """A Playwright route, as `_only_looks` sees it."""

    def __init__(self, kind: str, url: str) -> None:
        self.request = type("Request", (), {"resource_type": kind, "url": url})()
        self.went = ""

    def continue_(self) -> None:
        self.went = "continued"

    def abort(self) -> None:
        self.went = "aborted"


def test_an_invoice_loads_only_pictures_and_styles_from_amazons_image_hosts() -> None:
    def went(kind: str, url: str) -> str:
        route = Route(kind, url)
        _only_looks(route)
        return route.went

    assert went("image", "https://m.media-amazon.com/images/I/x.jpg") == "continued"
    assert went("stylesheet", "https://images-na.ssl-images-amazon.com/a.css") == "continued"
    assert went("script", "https://m.media-amazon.com/a.js") == "aborted"
    assert went("image", "https://fls-na.amazon.com/pixel") == "aborted"
    assert went("image", "https://media-amazon.com.example.net/x.jpg") == "aborted"


def test_an_eligible_orders_invoice_is_kept_by_its_number_and_said_to_app(tmp_path) -> None:
    db = Db(str(tmp_path / "shops.sqlite"))
    db.put_order("b1", "111-2", "2026-03-02", order("111-2", [eligible("Thermometer", "20.00")]))
    db.put_order("b1", "111-3", "2026-03-02", order("111-3", [{**item("Tea", "4.00"), "hsa_fsa_eligible": False}]))
    assert db.eligible_orders("b1") == {"111-2"}

    data = str(tmp_path / "shops")
    assert invoice_path(data, "b1", "../../etc/passwd") is None
    path = invoice_path(data, "b1", "111-2")
    assert path.endswith("amazon/b1/invoices/111-2.pdf")
    assert invoiced(data, "b1", {"111-2", "111-3"}) == set()
    os.makedirs(os.path.dirname(path))
    with open(path, "wb") as f:
        f.write(b"%PDF-1.4")
    assert invoiced(data, "b1", {"111-2", "111-3"}) == {"111-2"}

    o = order("111-2", [eligible("Thermometer", "20.00")], grand_total="20.00")
    [c] = for_app([charge("c1", "-20.00", o)], "Income:Gifts", None, {"111-2"})
    assert c["orders"] == [{"number": "111-2", "url": "https://www.amazon.com/order", "invoice": True}]
    [c] = for_app([charge("c1", "-20.00", o)], "Income:Gifts", None)
    assert "invoice" not in c["orders"][0]

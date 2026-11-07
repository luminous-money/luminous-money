"""Amazon's charges as `app` takes them (`POST /books/{book}/orders`, the one door for any shop):
each with its lines, summing to what the card paid (Amazon orders, step 2, 2026-11-07).

Kael's answers (the plan's "Decided with Kael"): tax and shipping are lines of their own; a
discount on the whole order is spread over its items in proportion to their prices, the cents
left over to the largest; a gift card or rewards points paying part of a charge is a line from
its account (gift cards and other payments, and rewards points, as the connection says), so the
bank's smaller amount still balances.

Amazon charges per shipment and doesn't say which items a charge paid for. An order charged
once is all of it. One charged more than once is matched to its shipments by their sums
(the order's total shared in proportion to each shipment's items); when that's clear, each
charge is its shipments' items, with its share of the rest. When it isn't, the charge is one
line naming what the order held, for the categorize chain to place. A refund names only its
order, so it's matched to its items by what the order says (`_refund`), else it's one line too.
"""

import itertools
import re
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

CENT = Decimal("0.01")
# Order-wide discounts, each a negative amount (amazon-orders' totals).
DISCOUNTS = ("promotion_applied", "coupon_savings", "subscription_discount", "multibuy_discount", "amazon_discount")
# How far a shipment's share may be from a charge and still be the one it paid for: tax rates
# differ between items, so a share is an estimate.
MATCH_SLACK = Decimal("0.015")
# How far a charge may be from the shipments it's matched to, when that's clearly the best fit.
ASSIGN_SLACK = Decimal("0.05")


def dec(value: Any) -> Decimal:
    return Decimal(str(value)) if value not in (None, "") else Decimal(0)


def cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def spread(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """`total` shared in proportion to `weights`, in cents, the cents left over to the largest."""
    whole = sum(weights)
    if not weights or whole == 0 or total == 0:
        return [Decimal(0)] * len(weights)
    shares = [cents(total * w / whole) for w in weights]
    shares[weights.index(max(weights))] += total - sum(shares)
    return shares


def _line(text: str, amount: Decimal, *, account: str | None = None, **more: Any) -> dict[str, Any]:
    return {"text": text, "amount": str(cents(amount)), "account": account, **more}


def _items(items: list[dict[str, Any]], discount: Decimal) -> list[dict[str, Any]]:
    costs = [dec(i["price"]) * (i["quantity"] or 1) for i in items]
    return [
        _line(i["title"], cost + share, quantity=i["quantity"] or 1, url=i.get("link"))
        for i, cost, share in zip(items, costs, spread(discount, costs))
    ]


def _rest(totals: dict[str, Any], share: Decimal, other: str, rewards: str) -> list[dict[str, Any]]:
    """Shipping, gift wrap and tax, then what paid besides the card, each its `share` of the
    order's (1 for a whole order)."""
    parts = [
        ("Shipping", dec(totals.get("shipping_total")) + dec(totals.get("free_shipping")), None),
        ("Gift wrap", dec(totals.get("gift_wrap")), None),
        ("Tax", dec(totals.get("estimated_tax")), None),
        ("Gift card", dec(totals.get("gift_card")), other),
        ("Rewards points", dec(totals.get("reward_points")), rewards),
    ]
    return [_line(text, amount * share, account=account) for text, amount, account in parts if cents(amount * share)]


def _balanced(lines: list[dict[str, Any]], paid: Decimal, text: str) -> list[dict[str, Any]]:
    """Lines summing to `paid`: any difference goes to the tax line (a share is an estimate), else
    a line of its own."""
    left = paid - sum(dec(line["amount"]) for line in lines)
    if left == 0:
        return lines
    tax = next((line for line in lines if line["text"] == "Tax"), None)
    if tax is not None and abs(left) <= max(CENT * 5, abs(dec(tax["amount"]))):
        tax["amount"] = str(dec(tax["amount"]) + left)
        return lines
    return [*lines, _line(text, left)]


def _summary(order: dict[str, Any] | None, refund: bool, number: str | None) -> str:
    titles = [i["title"] for i in (order or {}).get("items", [])]
    what = "; ".join(titles[:3]) + (f" and {len(titles) - 3} more" if len(titles) > 3 else "")
    lead = "Refund" if refund else f"Part of Amazon order {number}" if order else "Amazon"
    return f"{lead}: {what}" if what else lead


def close(a: Decimal, b: Decimal) -> bool:
    return abs(a - b) <= max(CENT * 2, abs(b) * MATCH_SLACK)


def _assign(paid: list[Decimal], shipments: list[Decimal], partial: bool) -> list[tuple[int, ...]] | None:
    """Which shipments each charge paid for: every charge some of them, each shipment at most
    once (every one, unless the order's other charges aren't here: `partial`). The way that fits
    best, if each charge is within `ASSIGN_SLACK` of its shipments' sum and it's clearly better
    than the next (under half its difference), else None."""
    if not paid or len(shipments) > 8 or len(paid) > len(shipments):
        return None
    scored = []
    for owner in itertools.product(range(len(paid) + partial), repeat=len(shipments)):
        groups = [tuple(s for s, o in enumerate(owner) if o == c) for c in range(len(paid))]
        if not all(groups):
            continue
        misses = [abs(sum(shipments[s] for s in g) - p) for g, p in zip(groups, paid)]
        if all(m <= max(CENT * 2, p * ASSIGN_SLACK) for m, p in zip(misses, paid)):
            scored.append((sum(misses), groups))
    scored.sort(key=lambda s: s[0])
    if not scored or (len(scored) > 1 and scored[1][0] < scored[0][0] * 2 + CENT):
        return None
    return scored[0][1]


RETURNED = re.compile(r"return|refund", re.I)


def _refund(order: dict[str, Any], refund: Decimal, discount: Decimal, grand: Decimal) -> tuple[list[dict[str, Any]], str | None]:
    """A refund's lines, negative: the items it was for, when the order says (Amazon's refund
    names only the order). The order's only item; else the only item in a shipment Amazon marks
    returned or refunded; else the one set of items (the marked shipments' first, then the
    order's) whose share of the order is the refund. Each item's line is its price less its
    discounts, scaled to what came back if that's less (a partial refund), then the rest as tax.
    Else one line naming the order's items."""
    items = order.get("items") or []
    cost = lambda i: dec(i["price"]) * (i["quantity"] or 1)  # noqa: E731
    subtotal = sum(cost(i) for i in items)
    marked = [i for s in order.get("shipments") or [] if RETURNED.search(s.get("status") or "") for i in s.get("items") or []]
    found, note = None, None
    if len(items) == 1:
        found = items
    elif len(marked) == 1:
        found, note = marked, "Its item is the one in the shipment Amazon marks returned."
    elif subtotal and grand:
        share = lambda group: sum(cost(i) for i in group) * grand / subtotal  # noqa: E731
        for pool in (marked, items):
            fits = [g for n in range(1, min(len(pool), 6) + 1) for g in itertools.combinations(pool, n) if close(refund, share(g))]
            if len(fits) == 1:
                found, note = list(fits[0]), "Its items are the ones whose share of the order is the refund."
            if fits:
                break
    if not found:
        return [_line(_summary(order, True, None), -refund)], None
    costs = [cost(i) for i in found]
    base = [c + d for c, d in zip(costs, spread(discount * sum(costs) / subtotal if subtotal else Decimal(0), costs))]
    full = sum(base) * grand / subtotal if subtotal and grand else sum(base)
    scale = min(Decimal(1), refund / full) if full else Decimal(1)
    lines = [
        _line(i["title"], -(b * scale), quantity=i["quantity"] or 1, url=i.get("link")) for i, b in zip(found, base)
    ]
    left = -refund - sum(dec(line["amount"]) for line in lines)
    return ([*lines, _line("Tax", left)] if cents(left) else lines), note


def order_charges(
    order: dict[str, Any], charges: list[dict[str, Any]], other: str, rewards: str
) -> dict[str, tuple[list[dict[str, Any]], str | None]]:
    """Each of an order's charges' lines (summing to what the card paid, as a positive amount
    spent) and a note, by the charge's ID."""
    totals = order.get("totals") or {}
    items = order.get("items") or []
    discount = sum(dec(totals.get(k)) for k in DISCOUNTS)
    # What the cards paid; Amazon's page doesn't always say, but its parts do.
    grand = dec(totals.get("grand_total")) or sum(
        dec(totals.get(k)) for k in ("total_before_tax", "estimated_tax", "gift_card", "reward_points")
    )
    out: dict[str, tuple[list[dict[str, Any]], str | None]] = {}
    spent = [c for c in charges if dec(c["amount"]) < 0]
    for c in charges:
        if dec(c["amount"]) > 0:
            out[c["id"]] = _refund(order, dec(c["amount"]), discount, grand)

    if not spent:
        return out
    if len(spent) == 1 and (not grand or close(-dec(spent[0]["amount"]), grand)):
        c = spent[0]
        paid = -dec(c["amount"])
        lines = _items(items, discount) + _rest(totals, Decimal(1), other, rewards)
        note = None if not grand or cents(grand) == paid else f"Amazon's total for the order is {cents(grand)}."
        out[c["id"]] = (_balanced(lines, paid, "Other (Amazon's total differs)"), note)
        return out

    # Charged more than once: by shipment, if the sums say which.
    shipments = [s for s in order.get("shipments") or [] if s.get("items")]
    subtotal = sum(dec(i["price"]) * (i["quantity"] or 1) for s in shipments for i in s["items"])
    bases = [sum(dec(i["price"]) * (i["quantity"] or 1) for i in s["items"]) for s in shipments]
    paid_all = [-dec(c["amount"]) for c in spent]
    partial = not close(sum(paid_all), grand)  # some of its charges are another card's, or older
    groups = _assign(paid_all, [grand * b / subtotal for b in bases], partial) if subtotal and grand else None
    for n, c in enumerate(spent):
        paid = -dec(c["amount"])
        if groups is None:
            out[c["id"]] = (
                [_line(_summary(order, False, order.get("order_number")), paid)],
                "Amazon charged this order in parts and doesn't say which items this paid for.",
            )
            continue
        own = [i for s in groups[n] for i in shipments[s]["items"]]
        base = sum(bases[s] for s in groups[n])
        lines = _items(own, discount * base / subtotal) + _rest(totals, base / subtotal, other, rewards)
        out[c["id"]] = (
            _balanced(lines, paid, "Other (its share of the order)"),
            "Amazon charged this order in parts; these are the items its shipments' sums say this paid for.",
        )
    return out


def for_app(charges: list[dict[str, Any]], other: str, rewards: str | None) -> list[dict[str, Any]]:
    """The book's charges (as `Db.charges` gives them, each with its order) in `app`'s shape."""
    rewards = rewards or other
    by_order: dict[str, list[dict[str, Any]]] = {}
    for c in charges:
        if c["order_number"] and c["order"]:
            by_order.setdefault(c["order_number"], []).append(c)
    read: dict[str, tuple[list[dict[str, Any]], str | None]] = {}
    for group in by_order.values():
        read.update(order_charges(group[0]["order"], group, other, rewards))

    out = []
    for c in charges:
        amount = dec(c["amount"])
        lines, note = read.get(c["id"]) or (
            [_line(_summary(c["order"], amount > 0, c["order_number"]), -amount)],
            None if c["order"] else "Its order hasn't been read.",
        )
        out.append(
            {
                "id": c["id"],
                "shop": "amazon",
                "date": c["date"],
                "amount": str(cents(amount)),
                "card": {"last_four": c["last4"], "brand": None} if c["last4"] else None,
                "orders": [{"number": c["order_number"], "url": c["order_link"]}] if c["order_number"] else [],
                "lines": lines,
                "note": note,
            }
        )
    return out

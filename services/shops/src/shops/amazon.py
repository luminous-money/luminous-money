"""Reading a book's Amazon (the Amazon orders spike, 2026-11-06).

Logs in as the connection's owner (their password, and codes made from their authenticator
app's setup key), or reuses the session kept from last time, then reads Amazon's Transactions
page for the charges since the connection's `sync_from` and each order behind them that hasn't
been read yet. Everything is through `amazon-orders`, which parses Amazon's own pages: Amazon
has no API for a shopper's orders. Nothing here writes to the books.
"""

import datetime
import hashlib
import json
import logging
import os
import re
import time
from decimal import Decimal
from typing import Any, Callable
from urllib.parse import urlparse

from amazonorders.conf import AmazonOrdersConfig
from amazonorders.exception import AmazonOrdersAuthError, AmazonOrdersError
from amazonorders.orders import AmazonOrders
from amazonorders.session import AmazonSession, IODefault
from amazonorders.transactions import AmazonTransactions

from . import seal
from .db import Db

log = logging.getLogger("shops.amazon")

# Orders read again on every sync (their shipments and charges may still change).
RECENT_DAYS = 14
# Between one order's page and the next: a person's pace, not a crawler's.
ORDER_PAUSE_SECONDS = 1.0


class NeedsPerson(Exception):
    """Amazon asked for something only a person can give: a captcha, a choice of device, a code
    the setup key can't make."""


class NoPrompts(IODefault):
    """A server has nobody to ask: Amazon's questions stop the sync and say what was asked."""

    def echo(self, msg: str, **kwargs: Any) -> None:
        log.info("amazon says: %s", msg)

    def prompt(self, msg: str, type: Any = None, **kwargs: Any) -> Any:
        choices = kwargs.get("choices")
        raise NeedsPerson(f"Amazon asked: {msg}" + (f" ({', '.join(map(str, choices))})" if choices else ""))


class BotCheck(AmazonOrdersError):
    """Amazon showed its "not a robot" check on a page read after logging in."""


def challenged(constants: Any, parsed: Any) -> bool:
    """Whether a page is Amazon's JavaScript bot check (its "not a robot" text, or Akamai's
    interstitial)."""
    if parsed is None:
        return False
    return bool(
        re.search(constants.JS_ROBOT_TEXT_REGEX, parsed.text)
        or re.search(constants.AKAMAI_INTERSTITIAL_REGEX, str(parsed))
    )


class Session(AmazonSession):
    """amazon-orders' session, with two changes from what Emmer met (2026-11-07):

    - **A challenged home page is passed over.** Logging in starts by fetching Amazon's home page
      for its first cookies. From Emmer, Amazon often answered it with its bot check while its
      sign-in page let the same requests through (six times of six), and a browser started from
      the challenged session's cookies never cleared it (the sync timed out after a minute). So
      a challenged home page is left, and the sign-in goes ahead without its cookies; the
      browser forms still meet any challenge in the sign-in itself.
    - **A challenge after logging in is an error that says so,** rather than a page read as
      having no charges.
    """

    def _provision_cookies(self) -> None:
        config = self.config
        for attempt in range(config.max_cookie_attempts):
            if attempt:
                time.sleep(config.cookie_reattempt_wait)
            response = self.get(config.constants.BASE_URL)
            if challenged(config.constants, response.parsed):
                log.info("Amazon's home page asked for its bot check; going straight to sign-in")
                return
            self._process_forms(response)
            # Amazon sometimes answers with its tablet page; ask again for the desktop one.
            if response.parsed.select_one(config.selectors.BAD_INDEX_SELECTOR) is None:
                return

    def request(self, method: str, url: str, persist_cookies: bool | None = None, binary: bool = False, **kwargs: Any) -> Any:
        response = super().request(method, url, persist_cookies=persist_cookies, binary=binary, **kwargs)
        if self.is_authenticated and not binary and challenged(self.config.constants, response.parsed):
            raise BotCheck(
                f"Amazon asked for its \"not a robot\" check reading {urlparse(url).path}. Try again later."
            )
        return response


def belongs(last4: str | None, include: set[str], exclude: set[str]) -> bool:
    """Whether a charge is the book's, by its card: one of the cards included (any card, if none
    is), and not one excluded. One with no card (a gift card or points paid all of it) is kept:
    it's likely wanted, and nothing else could tell (Kael)."""
    if not last4:
        return True
    if last4 in exclude:
        return False
    return not include or last4 in include


def money(value: float | int | None) -> str | None:
    if value is None:
        return None
    return str(Decimal(str(value)).quantize(Decimal("0.01")))


def _config(directory: str) -> AmazonOrdersConfig:
    os.makedirs(directory, mode=0o700, exist_ok=True)
    return AmazonOrdersConfig(
        config_path=os.path.join(directory, "config.yml"),  # never written: everything is passed in
        data={
            "cookie_jar_path": os.path.join(directory, "cookies.json"),
            "output_dir": os.path.join(directory, "output"),
            "request_timeout": 30,
            "thread_pool_size": 2,
            "warn_on_missing_required_field": True,
            # Amazon's JavaScript and AWS WAF challenges, met in a headless Chromium.
            "browser": "chromium",
            "browser_timeout": 60,
            "auth_forms_classes": [
                "amazonorders.contrib.browser.playwright.PlaywrightAcicForm",
                "amazonorders.contrib.browser.playwright.PlaywrightJSAuthForm",
            ],
        },
    )


def _order_data(order: Any) -> dict[str, Any]:
    def item(i: Any) -> dict[str, Any]:
        return {
            "title": i.title,
            "quantity": i.quantity,
            "price": money(i.price),
            "asin": getattr(i, "asin", None),
            "link": i.link,
        }

    fields = [
        "grand_total", "subtotal", "shipping_total", "free_shipping", "promotion_applied", "coupon_savings",
        "reward_points", "subscription_discount", "multibuy_discount", "amazon_discount", "gift_card",
        "gift_wrap", "total_before_tax", "estimated_tax", "refund_total",
    ]
    placed = order.order_placed_date
    return {
        "order_number": order.order_number,
        "placed": placed.isoformat() if isinstance(placed, datetime.date) else placed,
        "link": order.order_details_link,
        "payment_method": order.payment_method,
        "last4": order.payment_method_last_4,
        "cancelled": getattr(order, "cancelled", False),
        "whole_foods": getattr(order, "is_whole_foods", False),
        "totals": {f: money(getattr(order, f, None)) for f in fields},
        "items": [item(i) for i in order.items or []],
        "shipments": [
            {
                "id": getattr(s, "shipment_id", None),
                "status": s.delivery_status,
                "items": [item(i) for i in s.items or []],
            }
            for s in order.shipments or []
        ],
        "parse_failures": [str(f) for f in getattr(order, "parse_failures", [])][:10],
    }


def _charge_rows(transactions: list[Any]) -> list[dict[str, Any]]:
    """Amazon's charges as rows. A charge has no ID of its own, so it's its date, amount, card and
    order, and which of identical ones it is."""
    seen: dict[str, int] = {}
    rows = []
    for t in transactions:
        date = t.completed_date.isoformat()
        amount = money(t.grand_total)
        base = f"{date}|{amount}|{t.payment_method_last_4}|{t.order_number}"
        n = seen.get(base, 0)
        seen[base] = n + 1
        rows.append(
            {
                "id": hashlib.sha1(f"{base}|{n}".encode()).hexdigest()[:16],
                "date": date,
                "amount": amount,
                "payment_method": t.payment_method,
                "last4": t.payment_method_last_4,
                "order_number": t.order_number,
                "seller": t.seller,
                "order_link": t.order_details_link,
            }
        )
    return rows


def sync(db: Db, data_dir: str, book: str, step: Callable[[str], None]) -> dict[str, Any]:
    """Log in, read the charges since `sync_from` and the orders behind them, and keep them.
    Returns counts; raises NeedsPerson, AmazonOrdersAuthError (Amazon refused the login) or
    AmazonOrdersError."""
    connection = db.connection(book)
    if not connection or not connection["email"] or not connection["password"]:
        raise AmazonOrdersAuthError("Set the Amazon account's email and password first.")
    directory = os.path.join(data_dir, "amazon", book)
    config = _config(directory)
    session = Session(
        connection["email"],
        seal.unseal(connection["password"]),
        otp_secret_key=seal.unseal(connection["otp_secret"]) if connection["otp_secret"] else None,
        io=NoPrompts(),
        config=config,
    )

    step("Logging in to Amazon…")
    if session.auth_cookies_stored():
        try:
            valid = session.check_session(verify=True)
        except AmazonOrdersError as e:
            log.info("book %s: couldn't check the kept Amazon session (%s)", book, e)
            valid = False
        if not valid:
            log.info("book %s: logging in to Amazon again", book)
            session.logout()
    session.login()
    log.info("book %s: logged in to Amazon", book)

    today = datetime.date.today()
    since = datetime.date.fromisoformat(connection["sync_from"]) if connection["sync_from"] else today - datetime.timedelta(days=30)
    days = max((today - since).days, 1)
    step(f"Reading Amazon's charges since {since.isoformat()}…")
    transactions = AmazonTransactions(session).get_transactions(
        days=days, progress=lambda n: step(f"Reading Amazon's charges since {since.isoformat()}… {n} so far")
    )
    rows = _charge_rows(transactions)
    db.put_cards(book, rows)
    include = set(json.loads(connection["include_cards"] or "[]"))
    exclude = set(json.loads(connection["exclude_cards"] or "[]"))
    mine = [r for r in rows if belongs(r["last4"], include, exclude)]
    new_charges = db.put_charges(book, mine)
    pruned = db.prune(book, lambda last4: belongs(last4, include, exclude))
    log.info(
        "book %s: %d charges read, %d the book's (%d new), %d kept before no longer the book's",
        book, len(rows), len(mine), new_charges, pruned,
    )
    rows = mine

    known = db.order_numbers(book)
    recent = (today - datetime.timedelta(days=RECENT_DAYS)).isoformat()
    wanted = sorted(
        {r["order_number"] for r in rows if r["order_number"] and (r["order_number"] not in known or r["date"] >= recent)}
    )
    orders = AmazonOrders(session)
    failed: list[str] = []
    for n, number in enumerate(wanted, start=1):
        step(f"Reading order {n} of {len(wanted)}…")
        try:
            order = orders.get_order(number)
            data = _order_data(order)
            db.put_order(book, number, data["placed"], data)
        except AmazonOrdersError as e:
            log.warning("book %s: order %s couldn't be read: %s", book, number, e)
            failed.append(f"{number}: {e}")
        time.sleep(ORDER_PAUSE_SECONDS)
    return {
        "charges": len(rows),
        "new_charges": new_charges,
        "other_cards": len(transactions) - len(rows),
        "orders": len(wanted) - len(failed),
        "failed": failed,
    }

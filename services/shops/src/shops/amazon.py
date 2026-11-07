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
from urllib.parse import urlencode, urljoin, urlparse

import pyotp
from amazonorders.conf import AmazonOrdersConfig, cookies_file_lock
from amazonorders.exception import AmazonOrdersAuthError, AmazonOrdersError
from amazonorders.orders import AmazonOrders
from amazonorders.session import AmazonSession, IODefault
from amazonorders.transactions import AmazonTransactions
from playwright.sync_api import Error as PlaywrightError, sync_playwright

from . import seal
from .db import Db

log = logging.getLogger("shops.amazon")

# Orders read again on every sync (their shipments and charges may still change).
RECENT_DAYS = 14
# Between one order's page and the next: a person's pace, not a crawler's.
ORDER_PAUSE_SECONDS = 1.0
# After the first sync reads back to `sync_from`, each reads back this far before the last (Kael:
# "it's not the end of the world if we miss one or two Amazon orders"), so each morning's is a
# few pages, not every charge since the start.
BACK_READ_DAYS = 15


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

    - **It signs in in a browser** (`browser_sign_in`), not with amazon-orders' requests and
      forms: from Emmer, Amazon answered those with its bot check, and amazon-orders' browser
      never cleared it. Its cookies become the session's, kept as amazon-orders keeps its own.
    - **A challenge after logging in is an error that says so,** rather than a page read as
      having no charges.
    """

    def __init__(self, *args: Any, step: Callable[[str], None] = lambda s: None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.step = step

    def login(self) -> None:
        if self._sign_in_required:
            self.logout()
        if not self.auth_cookies_stored():
            browser_sign_in(self, self.step)
        self.is_authenticated = True

    def request(self, method: str, url: str, persist_cookies: bool | None = None, binary: bool = False, **kwargs: Any) -> Any:
        response = super().request(method, url, persist_cookies=persist_cookies, binary=binary, **kwargs)
        if not binary and self._pass_checkpoint(response):
            response = super().request(method, url, persist_cookies=persist_cookies, binary=binary, **kwargs)
            if self._checkpoint(response):
                raise NeedsPerson("Amazon keeps asking to tick \"I am human\" before showing your account.")
        if self.is_authenticated and not binary and challenged(self.config.constants, response.parsed):
            raise BotCheck(
                f"Amazon asked for its \"not a robot\" check reading {urlparse(url).path}. Try again later."
            )
        return response

    @staticmethod
    def _checkpoint(response: Any) -> Any:
        """Amazon's "Check the box to continue: I am human" page, put in front of a signed-in
        session's pages (met on Emmer right after signing in, 2026-11-07), if it's this one."""
        return response.parsed.select_one(CHECKPOINT_FORM) if response.parsed else None

    def _pass_checkpoint(self, response: Any) -> bool:
        """Tick the checkpoint's box and continue, as its form does. Whether there was one."""
        form = self._checkpoint(response)
        if form is None:
            return False
        data = {i["name"]: i.get("value", "") for i in form.select("input[type='hidden'][name]")}
        data[CHECKPOINT_BOX] = "true"
        log.info("Amazon asked to tick \"I am human\"; ticking it")
        super().request("POST", urljoin(response.response.url, form.get("action") or ""), data=data)
        return True


CHECKPOINT_FORM = "form#checkpointForm"
CHECKPOINT_BOX = "continueCheck"


# Signing in in a browser (2026-11-07). Probed from Emmer without an account: Playwright's
# headless shell (what amazon-orders launches, its user agent saying "HeadlessChrome") never got
# past Amazon's bot check, while a full Chromium in its new headless mode, with an ordinary user
# agent and without the automation flag, got Amazon's own sign-in page at once. So the whole
# sign-in happens there, answering each page as a person would.

SIGN_IN_SECONDS = 180  # the whole sign-in
STUCK_SECONDS = 30  # one page, unchanged, before it's one nothing here can answer
BROWSER_ARGS = ["--disable-blink-features=AutomationControlled"]


def browser_sign_in(session: Session, step: Callable[[str], None]) -> None:
    """Sign in to Amazon in a browser (the email, the password, a code made from the
    authenticator app's setup key) and make its cookies the session's. Raises NeedsPerson when
    Amazon asks what only a person can answer, AmazonOrdersAuthError when it refuses what it was
    given, and AmazonOrdersError otherwise. A page it stopped on is kept, as a screenshot and its
    HTML, in the connection's `output` directory."""
    constants = session.config.constants
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, channel="chromium", args=BROWSER_ARGS)
        page = None
        try:
            context = browser.new_context(
                user_agent=constants.BASE_HEADERS["User-Agent"],
                locale="en-US",
                viewport={"width": 1366, "height": 900},
            )
            page = context.new_page()
            page.on("console", lambda m: m.type == "error" and log.info("Amazon's page says: %s", m.text[:300]))
            page.on("pageerror", lambda e: log.info("Amazon's page failed: %s", str(e)[:300]))
            page.goto(
                f"{constants.SIGN_IN_URL}?{urlencode(constants.SIGN_IN_QUERY_PARAMS)}", wait_until="domcontentloaded"
            )
            _answer_until_signed_in(session, context, page, step)
            page.wait_for_timeout(2000)  # the last redirects' cookies
            _take_cookies(session, context)
        except PlaywrightError as e:
            _keep_page(session, page, "signin-failed")
            raise AmazonOrdersError(f"The browser stopped signing in to Amazon: {str(e).splitlines()[0]}") from e
        except (NeedsPerson, AmazonOrdersError):
            _keep_page(session, page, "signin-failed")
            raise
        finally:
            browser.close()
    log.info("signed in to Amazon in a browser")


def _answer_until_signed_in(session: Session, context: Any, page: Any, step: Callable[[str], None]) -> None:
    deadline = time.monotonic() + SIGN_IN_SECONDS
    answered: dict[str, int] = {}
    showing, since = None, time.monotonic()
    while time.monotonic() < deadline:
        try:
            if _signed_in(session, context, page):
                return
            now = _answer(session, page, answered, step)
        except PlaywrightError as e:  # the page navigated while being read
            log.debug("sign-in page changed while read: %s", e)
            now = "navigating"
        if now != showing:
            log.info("Amazon's sign-in: %s", now)
            showing, since = now, time.monotonic()
        elif time.monotonic() - since > STUCK_SECONDS and now != "approval":
            raise NeedsPerson(f"Amazon's sign-in stopped at a page it can't answer ({now}): {_heading(page)}")
        page.wait_for_timeout(1500)
    raise NeedsPerson(f"Signing in to Amazon took over {SIGN_IN_SECONDS} seconds, at: {_heading(page)}")


def _answer(session: Session, page: Any, answered: dict[str, int], step: Callable[[str], None]) -> str:
    """Answer the page Amazon's sign-in is showing, if it's one that can be; say which it is."""
    selectors = session.config.selectors

    def visible(selector: str | list[str]) -> Any | None:
        for s in [selector] if isinstance(selector, str) else selector:
            found = page.locator(s).first
            if found.count() and found.is_visible():
                return found
        return None

    def gone(field: Any, seconds: int) -> bool:
        try:
            field.wait_for(state="hidden", timeout=seconds * 1000)
            return True
        except PlaywrightError:
            return False

    def submit(field: Any) -> None:
        """Send the page's answer as a person would, with its form's button (else Enter), and
        give Amazon time to answer. When Amazon's own script holds the form back (on Emmer, the
        password page's never sent it, 2026-11-07), it's sent as a plain form, as amazon-orders
        sends it: only if nothing was sent, so an answer never goes twice."""
        host = urlparse(page.url).hostname
        sent: list[str] = []

        def sending(request: Any) -> None:
            url = urlparse(request.url)
            if request.method == "POST" and url.hostname == host and url.path.startswith(("/ap/", "/ax/")):
                sent.append(url.path)

        page.on("request", sending)
        try:
            button = field.locator("xpath=ancestor::form[1]//*[@type='submit']").first
            if button.count() and button.is_visible():
                button.click()
            else:
                field.press("Enter")
            if not gone(field, 20) and not sent:
                log.info("Amazon's page didn't send its form; sending it as a plain form")
                field.evaluate("f => HTMLFormElement.prototype.submit.call(f.form)")
            gone(field, 45)
        finally:
            page.remove_listener("request", sending)
        alert = _alert(page)
        log.info(
            "Amazon's sign-in, after answering: %s (sent %s)%s",
            urlparse(page.url).path, ", ".join(sent) or "nothing", f", saying {alert!r}" if alert else "",
        )

    def first_time(what: str) -> bool:
        """Whether this page hasn't been answered yet. An email or password is never sent twice:
        a page asking again with an error ends the sign-in with it; one without, it waits on."""
        answered[what] = answered.get(what, 0) + 1
        if answered[what] == 1:
            return True
        if alert := _alert(page):
            raise AmazonOrdersAuthError(f"Amazon didn't take the {what}: {alert}")
        return False

    if code := visible("input[name='otpCode']"):
        if not session.otp_secret_key:
            raise NeedsPerson("Amazon asked for a two-step code: add the authenticator app's setup key.")
        if not first_time("two-step code"):
            # Refused with an error (first_time raised otherwise): one more, with the next code.
            if answered["two-step code"] > 2:
                raise AmazonOrdersAuthError(f"Amazon didn't take the two-step codes: {_alert(page) or _heading(page)}")
            time.sleep(31 - time.time() % 30)
        step("Logging in to Amazon: its two-step code…")
        code.fill(pyotp.TOTP(session.otp_secret_key.replace(" ", "")).now())
        if remember := visible("input[name='rememberDevice']"):
            remember.check()
        submit(code)
        return "two-step code"
    if visible("input[name='customerName']") or visible("#ap_register_form"):
        # Never fill in Amazon's sign-up form: that's an email it doesn't know.
        raise AmazonOrdersAuthError(f"Amazon doesn't know the email {session.username}: {_heading(page)}")
    if visible(selectors.INTENT_FORM_SELECTOR):
        # What Amazon says after an email it can't sign in with (amazon-orders stops here too).
        message = visible(selectors.INTENT_MESSAGE_SELECTOR)
        text = " ".join(message.inner_text().split())[:200] if message else _heading(page)
        raise AmazonOrdersAuthError(f"Amazon wouldn't sign in {session.username}: {text}")
    if (
        visible(selectors.CAPTCHA_1_FORM_SELECTOR)
        or visible(selectors.CAPTCHA_2_FORM_SELECTOR)
        or visible(selectors.ACIC_VISUAL_CAPTCHA_MODAL_SELECTOR)
        or visible("input[name='guess']")  # a picture beside the password, asked again
    ):
        raise NeedsPerson(f"Amazon asked for a picture puzzle (a captcha): {_heading(page)}")
    if password := visible("input[name='password']"):
        if not first_time("password"):
            return "password (waiting for Amazon)"
        step("Logging in to Amazon: the password…")
        if (email := visible(selectors.SIGN_IN_EMAIL_INPUT_SELECTOR)) and not email.input_value():
            email.fill(session.username or "")  # the older page asks for both at once
        password.fill(session.password or "")
        if remember := visible("input[name='rememberMe']"):
            remember.check()
        submit(password)
        return "password"
    if email := visible(selectors.SIGN_IN_EMAIL_INPUT_SELECTOR):
        if not first_time("email"):
            return "email (waiting for Amazon)"
        step("Logging in to Amazon: the email…")
        email.fill(session.username or "")
        submit(email)
        return "email"
    if visible(selectors.MFA_DEVICE_SELECT_FORM_SELECTOR):
        # Where to send a code: the authenticator app, if it's offered.
        if not first_time("choice of where to send a code"):
            return "choice of where to send a code (waiting for Amazon)"
        app = page.locator(f"{selectors.MFA_DEVICE_SELECT_INPUT_SELECTOR}[value*='TOTP']").first
        if not app.count():
            raise NeedsPerson(f"Amazon asked where to send a code, and the authenticator app isn't offered: {_heading(page)}")
        app.check(force=True)
        page.locator(f"{selectors.MFA_DEVICE_SELECT_FORM_SELECTOR} input[type='submit']").first.click()
        return "choice of where to send a code"
    if link := visible(selectors.PASSKEY_PASSWORD_CHALLENGE_LINK_SELECTOR):
        if not first_time("passkey"):
            return "passkey (waiting for Amazon)"
        link.click()
        return "passkey (using the password instead)"
    if visible(CHECKPOINT_FORM):
        if not first_time("\"I am human\" box"):
            return "\"I am human\" box (waiting for Amazon)"
        step("Logging in to Amazon: its \"I am human\" box…")
        page.locator(f"{CHECKPOINT_FORM} input[name='{CHECKPOINT_BOX}']").first.check(force=True)
        page.locator(f"{CHECKPOINT_FORM} [type='submit']").first.click()
        page.wait_for_load_state("domcontentloaded")
        return "\"I am human\" box"
    if button := visible("button:has-text('Continue shopping'), input[type='submit'][value*='Continue shopping']"):
        if answered.setdefault("continue shopping", 0) >= 3:
            return "continue shopping (waiting for Amazon)"
        answered["continue shopping"] += 1
        button.click()
        return "continue shopping"
    if visible(selectors.CAPTCHA_OTP_FORM_SELECTOR) or visible("input[name='code']"):
        raise NeedsPerson(f"Amazon sent a code to check it's you, which only you can read: {_heading(page)}")
    text = page.evaluate("document.body ? document.body.innerText : ''")
    if re.search(session.config.constants.JS_ROBOT_TEXT_REGEX, text) or re.search(
        session.config.constants.AKAMAI_INTERSTITIAL_REGEX, page.content()
    ):
        step("Logging in to Amazon: its \"not a robot\" check…")
        return "bot check"
    if re.search(r"approv", text, re.I):
        step("Logging in to Amazon: approve the sign-in where Amazon sent it…")
        return "approval"
    return f"a page at {urlparse(page.url).path}"


def _signed_in(session: Session, context: Any, page: Any) -> bool:
    """Amazon's signed-in cookies are set, and it isn't holding the account behind a checkpoint."""
    names = {c["name"] for c in context.cookies() if c["domain"].lstrip(".").endswith(_site(session))}
    if not all(n in names for n in session.config.constants.COOKIES_SET_WHEN_AUTHENTICATED):
        return False
    return not urlparse(page.url).path.startswith("/checkpoint") and not page.locator(CHECKPOINT_FORM).count()


def _site(session: Session) -> str:
    return (urlparse(session.config.constants.BASE_URL).hostname or "").removeprefix("www.")


def _take_cookies(session: Session, context: Any) -> None:
    jar = session.session.cookies
    jar.clear()
    for c in context.cookies():
        if c["domain"].lstrip(".").endswith(_site(session)):
            jar.set(
                c["name"],
                c["value"],
                domain=c["domain"],
                path=c.get("path", "/"),
                secure=c.get("secure", False),
                expires=int(c["expires"]) if c.get("expires", -1) > 0 else None,
            )
    with cookies_file_lock:
        session._write_cookie_jar()


def _heading(page: Any) -> str:
    try:
        for selector in ("h1", "h2", "h4"):
            found = page.locator(selector).first
            if found.count() and (text := " ".join(found.inner_text(timeout=1000).split())):
                return text[:200]
        return page.title() or urlparse(page.url).path
    except Exception:
        return urlparse(page.url).path


def _alert(page: Any) -> str | None:
    try:
        found = page.locator(".a-alert-content:visible").first
        return " ".join(found.inner_text(timeout=1000).split())[:200] if found.count() else None
    except Exception:
        return None


def _keep_page(session: Session, page: Any, name: str) -> None:
    """The page a sign-in stopped on, for whoever looks into it (on the server, beside the kept
    session: it may show the account's email)."""
    if page is None:
        return
    try:
        directory = session.config.output_dir
        os.makedirs(directory, mode=0o700, exist_ok=True)
        page.screenshot(path=os.path.join(directory, f"{name}.png"), full_page=True)
        with open(os.path.join(directory, f"{name}.html"), "w", encoding="utf-8") as f:
            f.write(page.content())
        log.info("the sign-in page it stopped on is kept as %s.png and .html in %s", name, directory)
    except Exception:
        log.warning("couldn't keep the sign-in page", exc_info=True)


def read_window(connection: dict[str, Any], today: datetime.date) -> tuple[datetime.date, datetime.date]:
    """Where a sync starts (`sync_from`, else 30 days ago) and how far back it reads: back to the
    start once (the first sync, or when what it keeps changed), after that only `BACK_READ_DAYS`
    before the last sync."""
    start = datetime.date.fromisoformat(connection["sync_from"]) if connection["sync_from"] else today - datetime.timedelta(days=30)
    if not (connection.get("read_back_to") and connection.get("last_sync_at")):
        return start, start
    last = datetime.datetime.fromisoformat(connection["last_sync_at"]).date()
    return start, max(start, last - datetime.timedelta(days=BACK_READ_DAYS))


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
        step=step,
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
    start, since = read_window(connection, today)
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
    if since == start:
        db.set_read_back(book, start.isoformat())
    return {
        "charges": len(rows),
        "new_charges": new_charges,
        "other_cards": len(transactions) - len(rows),
        "orders": len(wanted) - len(failed),
        "failed": failed,
    }

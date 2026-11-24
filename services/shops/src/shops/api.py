"""The shops service's API, at /api/shops/v1 (the Amazon orders spike, 2026-11-06).

Every route but health needs the caller (X-User-Id, set by the gateway from their session); their
role in the book is the ledger's. Members see a book's Amazon connection; managers change it;
writers sync it. Secrets are taken, sealed and never sent back.

**Sign-ins are people's** (shared connections, 2026-11-24): an Amazon account's email, password
and setup key, and Amazon's session, are their owner's, who alone sees or changes them. A manager
puts one of their own in a book (`login_id`); its owner can always take it out, and it isn't
used once they've left the book. The book keeps the rest: its cards, dates and accounts, and what
was read.

- `GET /amazon/logins`, `POST /amazon/logins`: the caller's sign-ins (with the books using
  each), a new one.
- `PATCH /amazon/logins/{id}`, `DELETE /amazon/logins/{id}?updated_at=`: change or delete one.
- `DELETE /me`: forget the caller's sign-ins (their account is being deleted).
- `GET /books/{book}/amazon`: the connection (no secrets: whether each is set).
- `PATCH /books/{book}/amazon`: change it, against the `updated_at` read (null before it exists).
- `DELETE /books/{book}/amazon?updated_at=`: forget it, and everything read with it.
- `POST /books/{book}/amazon/sync`: start reading Amazon (202); `GET` the same says how it's going.
- `GET /books/{book}/amazon/charges`: what's been read, newest first, each with its order.
"""

import datetime
import json
import logging
import os
import re
import shutil
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import pyotp
from amazonorders.exception import AmazonOrdersAuthError, AmazonOrdersError
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import amazon, bodies, lines, seal
from .db import Db, StaleVersion

log = logging.getLogger("shops")
VERSION = os.environ.get("LUMINOUS_MONEY_VERSION", "dev")
RANKS = ["read", "write", "manage", "owner"]
RoleOf = Callable[[str, str], str | None]


SendOrders = Callable[[str, str, list[dict[str, Any]]], dict[str, Any]]


def orders_to(app_url: str) -> SendOrders:
    """Hand a book's charges to `app` (`POST /books/{book}/orders`), as the user: all of them,
    so it forgets any this no longer keeps (one merged into another: `amazon.redated`)."""

    def send(book: str, user: str, charges: list[dict[str, Any]]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{app_url}/api/app/v1/books/{urllib.parse.quote(book, safe='')}/orders",
            data=json.dumps({"charges": charges, "all_of": "amazon"}).encode(),
            headers={"X-User-Id": user, "content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            raise RuntimeError(f"the book said {e.code}: {detail}") from e

    return send


def roles_from(ledger_url: str) -> RoleOf:
    """The caller's role in a book, asking the ledger as them; None if they have none."""

    def role_of(user: str, book: str) -> str | None:
        request = urllib.request.Request(
            f"{ledger_url}/api/ledger/v1/books/{urllib.parse.quote(book, safe='')}", headers={"X-User-Id": user}
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response).get("role")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    return role_of


class ConnectionPatch(BaseModel):
    updated_at: str | None
    login_id: str | None = None  # one of the caller's sign-ins; null: none
    sync_from: datetime.date | None = None
    other_payments: str | None = None
    rewards: str | None = None  # "" or null: as other payments
    include_cards: list[str] | None = None  # last fours: only charges on these (all, if none)
    exclude_cards: list[str] | None = None  # last fours: never charges on these


class LoginIn(BaseModel):
    email: str
    password: str | None = None
    otp_secret: str | None = None  # the authenticator app's setup key


class LoginPatch(BaseModel):
    updated_at: str
    email: str | None = None
    password: str | None = None  # "" forgets it
    otp_secret: str | None = None  # "" forgets it


def card_list(text: str | None) -> list[str]:
    return json.loads(text) if text else []


def setup_key(text: str | None) -> str | None:
    """An authenticator app's setup key, as typed (spaces, any case), or None; 422 if it isn't one."""
    secret = "".join((text or "").split()).upper()
    if not secret:
        return None
    try:
        pyotp.TOTP(secret).now()
    except Exception:
        raise HTTPException(422, "That isn't an authenticator setup key (letters and digits, like JBSW Y3DP…)")
    return secret


def login_view(login: dict[str, Any] | None, caller: str) -> dict[str, Any] | None:
    """A sign-in without its secrets. Only its owner sees which Amazon account it is (a book's
    own, from before, shows as it did)."""
    if not login:
        return None
    mine = login.get("user_id") == caller
    return {
        "id": login.get("id"),
        "mine": mine,
        "owner_id": login.get("user_id"),
        "email": login["email"] if mine or login.get("user_id") is None else None,
        "has_password": bool(login.get("password")),
        "has_otp_secret": bool(login.get("otp_secret")),
    }


def view(row: dict[str, Any] | None, cards: list[dict[str, Any]], login: dict[str, Any] | None, caller: str) -> dict[str, Any]:
    row = row or {}
    return {
        "include_cards": card_list(row.get("include_cards")),
        "exclude_cards": card_list(row.get("exclude_cards")),
        "cards": cards,
        "login": login_view(login, caller),
        # Whether it can sync (`app`'s morning sync asks).
        "has_password": bool(login and login.get("password")),
        "sync_from": row.get("sync_from"),
        "other_payments": row.get("other_payments", "Income:Uncategorized"),
        "rewards": row.get("rewards"),
        "status": row.get("status", "new"),
        "status_detail": row.get("status_detail"),
        "last_sync_at": row.get("last_sync_at"),
        "updated_at": row.get("updated_at"),
        "sealing": seal.ready(),
    }


def create_app(db: Db, data_dir: str, role_of: RoleOf, send_orders: SendOrders | None = None) -> FastAPI:
    app = FastAPI(title="Luminous Money shops", version=VERSION)
    # Only small JSON comes here (a connection's settings), so 64 KB is plenty (S4).
    app.add_middleware(bodies.BodyLimit, limit_for=lambda _: (64 * 1024, "a request is at most 64 KB"))
    api = APIRouter(prefix="/api/shops/v1")
    jobs: dict[str, dict[str, Any]] = {}
    jobs_lock = threading.Lock()
    # One sync at a time per sign-in: books sharing one share Amazon's session.
    sessions: dict[str, threading.Lock] = {}

    def health() -> dict[str, Any]:
        return {"status": "up", "version": VERSION, "schema": db.schema(), "sealing": seal.ready()}

    app.get("/health")(health)
    api.get("/health")(health)

    def user(x_user_id: str | None = Header(default=None)) -> str:
        if not x_user_id:
            raise HTTPException(401, "not logged in")
        return x_user_id

    def adopt(book: str, owner: str) -> None:
        """The book's own sign-in, from before, becomes its owner's (`Db.adopt`), session and all."""
        login_id = db.adopt(book, owner)
        if login_id is None:
            return
        log.info("book %s: its Amazon sign-in is its owner's now (%s)", book, login_id)
        try:
            amazon.move_session(data_dir, book, login_id)
        except OSError:
            log.warning("book %s: Amazon's session couldn't move with its sign-in: the next sync signs in again", book, exc_info=True)

    def need(caller: str, book: str, rank: str) -> str:
        role = role_of(caller, book)
        if role is None:
            raise HTTPException(404, "not found")
        if role == "owner":
            adopt(book, caller)
        if RANKS.index(role) < RANKS.index(rank):
            raise HTTPException(403, f"that needs {rank} access to the book")
        return role

    def book_login(book: str, caller: str) -> dict[str, Any] | None:
        """The sign-in the book uses: a person's (none once they've left the book), or its own
        from before."""
        row = db.connection(book)
        if not row:
            return None
        if row["login_id"]:
            login = db.login(row["login_id"])
            if login and login["user_id"] != caller and role_of(login["user_id"], book) is None:
                log.info("book %s: its Amazon sign-in's owner has left it: it isn't used", book)
                db.drop_login(book)
                return None
            return login
        if row["email"] or row["password"]:
            return {"id": None, "user_id": None, "email": row["email"], "password": row["password"], "otp_secret": row["otp_secret"]}
        return None

    def forget_session(login_id: str) -> None:
        shutil.rmtree(amazon.session_dir(data_dir, {"id": login_id}, ""), ignore_errors=True)

    def own_view(login: dict[str, Any]) -> dict[str, Any]:
        return {**login_view(login, login["user_id"]), "updated_at": login["updated_at"], "books": db.books_using(login["id"])}  # type: ignore[dict-item]

    def sealing() -> None:
        if not seal.ready():
            raise HTTPException(503, "the shops service has no key to seal secrets with (SHOPS_ENCRYPTION_KEY)")

    @api.get("/amazon/logins")
    def my_logins(caller: str = Depends(user)) -> list[dict[str, Any]]:
        return [own_view(login) for login in db.logins(caller)]

    @api.post("/amazon/logins", status_code=201)
    def add_login(body: LoginIn, caller: str = Depends(user)) -> dict[str, Any]:
        sealing()
        email = body.email.strip()
        if not email:
            raise HTTPException(422, "Enter the Amazon account's email")
        secret = setup_key(body.otp_secret)
        login = db.add_login(
            caller, email, seal.seal(body.password) if body.password else None, seal.seal(secret) if secret else None
        )
        return own_view(login)

    @api.patch("/amazon/logins/{id}")
    def patch_login(id: str, patch: LoginPatch, caller: str = Depends(user)) -> dict[str, Any]:
        login = db.login(id)
        if not login or login["user_id"] != caller:
            raise HTTPException(404, "not found")
        given = patch.model_fields_set - {"updated_at"}
        changes: dict[str, Any] = {}
        if "email" in given:
            changes["email"] = (patch.email or "").strip()
            if not changes["email"]:
                raise HTTPException(422, "Enter the Amazon account's email")
        if given & {"password", "otp_secret"}:
            sealing()
        if "password" in given:
            changes["password"] = seal.seal(patch.password) if patch.password else None
        if "otp_secret" in given:
            secret = setup_key(patch.otp_secret)
            changes["otp_secret"] = seal.seal(secret) if secret else None
        try:
            saved = db.set_login(id, changes, patch.updated_at)
        except StaleVersion as e:
            raise HTTPException(409, {"message": "it changed since it was read", "current": e.current})
        if changes.get("email", login["email"]) != login["email"]:
            forget_session(id)  # another Amazon account: its own session
        return own_view(saved)

    @api.delete("/amazon/logins/{id}", status_code=204)
    def delete_login(id: str, updated_at: str, caller: str = Depends(user)) -> None:
        login = db.login(id)
        if not login or login["user_id"] != caller:
            raise HTTPException(404, "not found")
        try:
            db.delete_login(id, updated_at)
        except StaleVersion as e:
            raise HTTPException(409, {"message": "it changed since it was read", "current": e.current})
        forget_session(id)

    @api.delete("/me", status_code=204)
    def forget_me(caller: str = Depends(user)) -> None:
        for id in db.forget_user(caller):
            forget_session(id)

    @api.get("/books/{book}/amazon")
    def get_connection(book: str, caller: str = Depends(user)) -> dict[str, Any]:
        need(caller, book, "read")
        return view(db.connection(book), db.cards(book), book_login(book, caller), caller)

    @api.patch("/books/{book}/amazon")
    def patch_connection(book: str, patch: ConnectionPatch, caller: str = Depends(user)) -> dict[str, Any]:
        given = patch.model_fields_set - {"updated_at"}
        current = db.connection(book)
        using = db.login(current["login_id"]) if current and current["login_id"] else None
        # A sign-in's owner can always take theirs out; anything else is a manager's.
        theirs = given == {"login_id"} and patch.login_id is None and bool(using) and using["user_id"] == caller  # type: ignore[index]
        need(caller, book, "read" if theirs else "manage")
        changes: dict[str, Any] = {}
        if "login_id" in given:
            if patch.login_id is not None:
                chosen = db.login(patch.login_id)
                if not chosen or chosen["user_id"] != caller:
                    raise HTTPException(422, "That isn't one of your Amazon accounts")
            # Another Amazon account (or none): the book's own from before goes, and the next
            # sync reads back to the start.
            changes.update(login_id=patch.login_id, email="", password=None, otp_secret=None)
            changes.update(read_back_to=None, status="new", status_detail=None)
        if "sync_from" in given:
            changes["sync_from"] = patch.sync_from.isoformat() if patch.sync_from else None
        if "other_payments" in given:
            changes["other_payments"] = (patch.other_payments or "").strip() or "Income:Uncategorized"
        if "rewards" in given:
            changes["rewards"] = (patch.rewards or "").strip() or None
        for name in ("include_cards", "exclude_cards"):
            if name in given:
                cards = sorted({c.strip() for c in getattr(patch, name) or [] if c.strip()})
                if any(not re.fullmatch(r"\d{2,6}", c) for c in cards):
                    raise HTTPException(422, "A card is its last four digits, like 1234")
                changes[name] = json.dumps(cards) if cards else None
        if given & {"sync_from", "include_cards", "exclude_cards"}:
            # What a sync keeps changed: the next reads back to `sync_from` again.
            changes["read_back_to"] = None
        try:
            saved = db.set_connection(book, changes, patch.updated_at)
        except StaleVersion as e:
            raise HTTPException(409, {"message": "it changed since it was read", "current": e.current})
        if "login_id" in given:
            # The book's own session from before, if any, was its own sign-in's (its invoices stay).
            own = os.path.join(data_dir, "amazon", book)
            if os.path.exists(os.path.join(own, "cookies.json")):
                os.remove(os.path.join(own, "cookies.json"))
            shutil.rmtree(os.path.join(own, "output"), ignore_errors=True)
        return view(saved, db.cards(book), book_login(book, caller), caller)

    @api.delete("/books/{book}/amazon", status_code=204)
    def forget(book: str, updated_at: str, caller: str = Depends(user)) -> None:
        need(caller, book, "manage")
        try:
            db.forget(book, updated_at)
        except StaleVersion as e:
            raise HTTPException(409, {"message": "it changed since it was read", "current": e.current})
        jar = os.path.join(data_dir, "amazon", book, "cookies.json")
        if os.path.exists(jar):
            os.remove(jar)
        shutil.rmtree(os.path.join(data_dir, "amazon", book, "invoices"), ignore_errors=True)

    def hand_over(book: str, caller: str) -> str:
        """Hand the book's charges, with their lines, to `app`; say how it went."""
        if send_orders is None:
            return ""
        connection = db.connection(book) or {}
        include = set(card_list(connection.get("include_cards")))
        exclude = set(card_list(connection.get("exclude_cards")))
        mine = [c for c in db.charges(book, limit=100_000) if amazon.belongs(c["last4"], include, exclude)]
        charges = lines.for_app(
            mine,
            connection.get("other_payments") or "Income:Uncategorized",
            connection.get("rewards"),
            amazon.invoiced(data_dir, book, {c["order_number"] for c in mine if c["order_number"]}),
        )
        try:
            sent = send_orders(book, caller, charges)
            log.info("book %s: %d charges handed to the book (%d new)", book, len(charges), sent.get("new", 0))
            return f" {sent.get('new', 0)} new for the book."
        except Exception as e:
            log.warning("book %s: the charges couldn't be handed to the book: %s", book, e)
            return f" They couldn't be handed to the book ({e}); the next sync tries again."

    def run(book: str, caller: str) -> None:
        job = jobs[book]

        def step(text: str) -> None:
            job["step"] = text

        session: threading.Lock | None = None
        try:
            login = book_login(book, caller)
            with jobs_lock:
                lock = sessions.setdefault(login["id"] if login and login["id"] else f"book:{book}", threading.Lock())
            if not lock.acquire(blocking=False):
                step("Waiting for another book's sync with this Amazon account…")
                lock.acquire()
            session = lock
            result = amazon.sync(db, data_dir, book, step, login)
            failed = f"; {len(result['failed'])} orders couldn't be read" if result["failed"] else ""
            invoices = f", {result['invoices']} invoices saved" if result["invoices"] else ""
            others = f" ({result['other_cards']} on other cards left out)" if result["other_cards"] else ""
            step("Handing the charges to the book…")
            handed = hand_over(book, caller)
            db.set_status(
                book,
                "ok",
                f"{result['charges']} charges{others} and {result['orders']} orders read{invoices}{failed}.{handed}",
                synced=True,
            )
            job.update(state="done", step="Done", result=result)
        except (amazon.NeedsPerson, AmazonOrdersAuthError) as e:
            log.warning("book %s: Amazon login: %s", book, e)
            db.set_status(book, "login", str(e))
            job.update(state="failed", error=str(e))
        except AmazonOrdersError as e:
            log.warning("book %s: the Amazon sync stopped: %s", book, e)
            db.set_status(book, "failed", str(e))
            job.update(state="failed", error=str(e))
        except Exception as e:  # a spike: say what went wrong, whatever it was
            log.exception("book %s: the Amazon sync failed", book)
            db.set_status(book, "failed", f"{type(e).__name__}: {e}")
            job.update(state="failed", error=f"{type(e).__name__}: {e}")
        finally:
            if session:
                session.release()
            job["finished_at"] = datetime.datetime.now(datetime.UTC).isoformat()

    @api.post("/books/{book}/amazon/sync", status_code=202)
    def start_sync(book: str, caller: str = Depends(user)) -> dict[str, Any]:
        need(caller, book, "write")
        with jobs_lock:
            if jobs.get(book, {}).get("state") == "running":
                raise HTTPException(409, "a sync is already running")
            jobs[book] = {"state": "running", "step": "Starting…", "started_at": datetime.datetime.now(datetime.UTC).isoformat()}
        threading.Thread(target=run, args=(book, caller), daemon=True, name=f"amazon-sync-{book}").start()
        return jobs[book]

    @api.get("/books/{book}/amazon/sync")
    def sync_state(book: str, caller: str = Depends(user)) -> dict[str, Any]:
        need(caller, book, "read")
        return jobs.get(book, {"state": "none"})

    @api.get("/books/{book}/amazon/orders/{number}/invoice")
    def invoice(book: str, number: str, caller: str = Depends(user)) -> FileResponse:
        """An order's invoice, kept as a PDF (HSA tracking), for `app` to attach to its charge's
        transaction."""
        need(caller, book, "read")
        path = amazon.invoice_path(data_dir, book, number)
        if path is None or not os.path.exists(path):
            raise HTTPException(404, "that order's invoice isn't kept")
        return FileResponse(path, media_type="application/pdf", filename=f"Amazon order {number}.pdf")

    @api.get("/books/{book}/amazon/charges")
    def charges(book: str, caller: str = Depends(user)) -> list[dict[str, Any]]:
        need(caller, book, "read")
        connection = db.connection(book) or {}
        include = set(card_list(connection.get("include_cards")))
        exclude = set(card_list(connection.get("exclude_cards")))
        return [c for c in db.charges(book) if amazon.belongs(c["last4"], include, exclude)]

    @app.exception_handler(HTTPException)
    async def detail(request: Request, e: HTTPException) -> JSONResponse:
        body = e.detail if isinstance(e.detail, dict) else {"detail": e.detail}
        if "message" in body and "detail" not in body:
            body = {"detail": body["message"], **body}
        return JSONResponse(body, status_code=e.status_code)

    app.include_router(api)
    return app


def from_env() -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    data = os.environ.get("SHOPS_DATA_DIR", "/data")
    return create_app(
        Db(os.path.join(data, "shops.sqlite")),
        data_dir=os.path.join(data, "shops"),
        role_of=roles_from(os.environ.get("LEDGER_URL", "http://ledger:8000")),
        send_orders=orders_to(os.environ.get("APP_URL", "http://app:3000")),
    )

"""The shops service's API, at /api/shops/v1 (the Amazon orders spike, 2026-11-06).

Every route but health needs the caller (X-User-Id, set by the gateway from their session); their
role in the book is the ledger's. Members see a book's Amazon connection; managers change it;
writers sync it. Secrets are taken, sealed and never sent back.

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
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import pyotp
from amazonorders.exception import AmazonOrdersAuthError, AmazonOrdersError
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import amazon, lines, seal
from .db import Db, StaleVersion

log = logging.getLogger("shops")
VERSION = os.environ.get("LUMINOUS_MONEY_VERSION", "dev")
RANKS = ["read", "write", "manage", "owner"]
RoleOf = Callable[[str, str], str | None]


SendOrders = Callable[[str, str, list[dict[str, Any]]], dict[str, Any]]


def orders_to(app_url: str) -> SendOrders:
    """Hand a book's charges to `app` (`POST /books/{book}/orders`), as the user."""

    def send(book: str, user: str, charges: list[dict[str, Any]]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{app_url}/api/app/v1/books/{urllib.parse.quote(book, safe='')}/orders",
            data=json.dumps({"charges": charges}).encode(),
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
    email: str | None = None
    password: str | None = None  # "" forgets it
    otp_secret: str | None = None  # the authenticator app's setup key; "" forgets it
    sync_from: datetime.date | None = None
    other_payments: str | None = None
    rewards: str | None = None  # "" or null: as other payments
    include_cards: list[str] | None = None  # last fours: only charges on these (all, if none)
    exclude_cards: list[str] | None = None  # last fours: never charges on these


def card_list(text: str | None) -> list[str]:
    return json.loads(text) if text else []


def view(row: dict[str, Any] | None, cards: list[dict[str, Any]]) -> dict[str, Any]:
    row = row or {}
    return {
        "include_cards": card_list(row.get("include_cards")),
        "exclude_cards": card_list(row.get("exclude_cards")),
        "cards": cards,
        "email": row.get("email", ""),
        "has_password": bool(row.get("password")),
        "has_otp_secret": bool(row.get("otp_secret")),
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
    api = APIRouter(prefix="/api/shops/v1")
    jobs: dict[str, dict[str, Any]] = {}
    jobs_lock = threading.Lock()

    def health() -> dict[str, Any]:
        return {"status": "up", "version": VERSION, "schema": db.schema(), "sealing": seal.ready()}

    app.get("/health")(health)
    api.get("/health")(health)

    def user(x_user_id: str | None = Header(default=None)) -> str:
        if not x_user_id:
            raise HTTPException(401, "not logged in")
        return x_user_id

    def need(caller: str, book: str, rank: str) -> None:
        role = role_of(caller, book)
        if role is None:
            raise HTTPException(404, "not found")
        if RANKS.index(role) < RANKS.index(rank):
            raise HTTPException(403, f"that needs {rank} access to the book")

    @api.get("/books/{book}/amazon")
    def get_connection(book: str, caller: str = Depends(user)) -> dict[str, Any]:
        need(caller, book, "read")
        return view(db.connection(book), db.cards(book))

    @api.patch("/books/{book}/amazon")
    def patch_connection(book: str, patch: ConnectionPatch, caller: str = Depends(user)) -> dict[str, Any]:
        need(caller, book, "manage")
        given = patch.model_fields_set - {"updated_at"}
        changes: dict[str, Any] = {}
        if "email" in given:
            changes["email"] = (patch.email or "").strip()
        if given & {"password", "otp_secret"} and not seal.ready():
            raise HTTPException(503, "the shops service has no key to seal secrets with (SHOPS_ENCRYPTION_KEY)")
        if "password" in given:
            changes["password"] = seal.seal(patch.password) if patch.password else None
        if "otp_secret" in given:
            secret = "".join((patch.otp_secret or "").split()).upper()
            if secret:
                try:
                    pyotp.TOTP(secret).now()
                except Exception:
                    raise HTTPException(422, "That isn't an authenticator setup key (letters and digits, like JBSW Y3DP…)")
            changes["otp_secret"] = seal.seal(secret) if secret else None
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
        if given & {"email", "password", "otp_secret"}:
            # New credentials: the next sync logs in afresh.
            changes["status"] = "new"
            changes["status_detail"] = None
        try:
            return view(db.set_connection(book, changes, patch.updated_at), db.cards(book))
        except StaleVersion as e:
            raise HTTPException(409, {"message": "it changed since it was read", "current": e.current})

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

    def hand_over(book: str, caller: str) -> str:
        """Hand the book's charges, with their lines, to `app`; say how it went."""
        if send_orders is None:
            return ""
        connection = db.connection(book) or {}
        include = set(card_list(connection.get("include_cards")))
        exclude = set(card_list(connection.get("exclude_cards")))
        mine = [c for c in db.charges(book, limit=100_000) if amazon.belongs(c["last4"], include, exclude)]
        charges = lines.for_app(
            mine, connection.get("other_payments") or "Income:Uncategorized", connection.get("rewards")
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

        try:
            result = amazon.sync(db, data_dir, book, step)
            failed = f"; {len(result['failed'])} orders couldn't be read" if result["failed"] else ""
            others = f" ({result['other_cards']} on other cards left out)" if result["other_cards"] else ""
            step("Handing the charges to the book…")
            handed = hand_over(book, caller)
            db.set_status(
                book,
                "ok",
                f"{result['charges']} charges{others} and {result['orders']} orders read{failed}.{handed}",
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

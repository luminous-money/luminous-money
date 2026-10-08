"""HTTP API, mounted at /api/ledger/v1. Traefik routes the prefix here without stripping it.

Two ways to write:

- **Transactions as JSON** (`/transactions`): what the app uses when composing or editing a
  transaction from form fields. The ledger renders the canonical Beancount text, so Beancount
  syntax never leaves this service.
- **Any directive as Beancount text** (`/directives`, `/import`): raw editing, any directive type,
  bulk import and restore.

Both write the same rows, and both read back either way.
"""

from __future__ import annotations

import datetime
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse, PlainTextResponse

from . import engine, models
from .service import Ledger, NotFound
from .store import Row, Store

BeancountText = Annotated[str, Body(media_type="text/plain")]

log = logging.getLogger(__name__)


class Filters:
    """Query parameters shared by the list endpoints."""

    def __init__(
        self,
        account: Annotated[str | None, Query(description="An account and its subaccounts.")] = None,
        flag: str | None = None,
        date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
        date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
        limit: int = 500,
    ):
        self.values = dict(account=account, flag=flag, date_from=date_from, date_to=date_to, limit=limit)


def create_app(ledger: Ledger, export_interval: float | None = None) -> FastAPI:
    """With `export_interval` (seconds) and an export directory, books are re-exported for Fava
    in the background whenever they change."""

    @asynccontextmanager
    async def lifespan(_):
        stop = threading.Event()
        if export_interval and ledger.export_dir:
            threading.Thread(target=_export_loop, args=(ledger, export_interval, stop), daemon=True).start()
        yield
        stop.set()

    app = FastAPI(
        title="fava-beans ledger",
        docs_url="/api/ledger/v1/docs",
        openapi_url="/api/ledger/v1/openapi.json",
        lifespan=lifespan,
    )
    api = APIRouter(prefix="/api/ledger/v1")

    @app.exception_handler(NotFound)
    async def not_found(_, exc: NotFound):
        return JSONResponse({"detail": f"not found: {exc.args[0]}"}, status_code=404)

    @app.exception_handler(engine.ParseFailure)
    async def unparseable(_, exc: engine.ParseFailure):
        return JSONResponse({"detail": exc.errors}, status_code=422)

    @app.exception_handler(ValueError)
    async def invalid(_, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    # Books

    @api.get("/books")
    def books() -> list[str]:
        return ledger.books()

    @api.put("/books/{book_id}", status_code=201)
    def create_book(book_id: str) -> models.Book:
        ledger.create_book(book_id)
        return models.Book(id=book_id)

    @api.post("/books/{book_id}/import")
    def import_text(book_id: str, text: BeancountText) -> models.Applied:
        applied = ledger.apply_text(book_id, text)
        return models.Applied(put=applied.put, deleted=applied.deleted)

    @api.get("/books/{book_id}/export", response_class=PlainTextResponse)
    def export(book_id: str) -> str:
        return ledger.export(book_id)

    @api.get("/books/{book_id}/accounts")
    def accounts(book_id: str) -> list[models.Account]:
        return ledger.accounts(book_id)

    # Transactions, as JSON

    @api.get("/books/{book_id}/transactions")
    def list_transactions(book_id: str, filters: Annotated[Filters, Depends()]) -> list[models.Transaction]:
        return ledger.transactions(book_id, **filters.values)

    @api.post("/books/{book_id}/transactions", status_code=201)
    def create_transaction(book_id: str, transaction: models.TransactionIn) -> models.Transaction:
        return ledger.transaction(book_id, ledger.create_transaction(book_id, transaction).id)

    @api.get("/books/{book_id}/transactions/{directive_id}")
    def get_transaction(book_id: str, directive_id: str) -> models.Transaction:
        return ledger.transaction(book_id, directive_id)

    @api.put("/books/{book_id}/transactions/{directive_id}")
    def update_transaction(
        book_id: str, directive_id: str, transaction: models.TransactionIn
    ) -> models.Transaction:
        ledger.update_transaction(book_id, directive_id, transaction)
        return ledger.transaction(book_id, directive_id)

    # Any directive, as Beancount text

    @api.get("/books/{book_id}/directives")
    def list_directives(book_id: str, filters: Annotated[Filters, Depends()]) -> list[models.Directive]:
        return [_row(r) for r in ledger.store.find(book_id, **filters.values)]

    @api.post("/books/{book_id}/directives", status_code=201)
    def create_directive(book_id: str, text: BeancountText) -> models.Directive:
        return _directive(ledger.create(book_id, text))

    @api.get("/books/{book_id}/directives/{directive_id}")
    def get_directive(book_id: str, directive_id: str) -> models.Directive:
        return _row(ledger.get(book_id, directive_id))

    @api.put("/books/{book_id}/directives/{directive_id}")
    def update_directive(book_id: str, directive_id: str, text: BeancountText) -> models.Directive:
        return _directive(ledger.update(book_id, directive_id, text))

    @api.post("/books/{book_id}/directives/{directive_id}/confirm")
    def confirm(book_id: str, directive_id: str) -> models.Directive:
        return _directive(ledger.set_flag(book_id, directive_id, "*"))

    @api.delete("/books/{book_id}/directives/{directive_id}", status_code=204)
    def delete_directive(book_id: str, directive_id: str) -> None:
        ledger.delete(book_id, directive_id)

    # The engine

    @api.get("/books/{book_id}/problems")
    def problems(book_id: str) -> list[models.Problem]:
        return [models.Problem(message=p.message, directive_id=p.directive_id) for p in ledger.problems(book_id)]

    @api.post("/books/{book_id}/query")
    def query(book_id: str, bql: BeancountText) -> models.QueryResult:
        columns, rows = ledger.query(book_id, bql)
        return models.QueryResult(columns=columns, rows=rows)

    # Backups

    @api.get("/backup")
    def backup(since: int = 0) -> models.Backup:
        b = ledger.backup(since)
        return models.Backup(since=b.since, cursor=b.cursor, chunks=b.chunks)

    app.include_router(api)
    return app


def _row(r: Row) -> models.Directive:
    return models.Directive(id=r.id, date=datetime.date.fromisoformat(r.date), kind=r.kind, flag=r.flag, text=r.text)


def _directive(d: engine.Directive) -> models.Directive:
    return models.Directive(id=d.id, date=d.date, kind=d.kind, flag=d.flag, text=d.text)


def _export_loop(ledger: Ledger, interval: float, stop: threading.Event) -> None:
    written: dict[str, int] = {}
    while not stop.is_set():
        try:
            for book_id in ledger.write_changed_exports(written):
                log.info("exported %s", book_id)
        except Exception:
            log.exception("export failed; retrying")
        stop.wait(interval)


def from_env() -> FastAPI:
    data_dir = os.environ.get("LEDGER_DATA_DIR", "/data")
    export_dir = os.environ.get("LEDGER_EXPORT_DIR")
    interval = float(os.environ.get("LEDGER_EXPORT_INTERVAL", "2"))
    return create_app(Ledger(Store(os.path.join(data_dir, "ledger.sqlite")), export_dir), interval)

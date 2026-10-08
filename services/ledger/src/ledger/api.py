"""HTTP API, mounted at /api/ledger/v1. Traefik routes the prefix here without stripping it.

Directives are exchanged as Beancount text, the canonical form. Structured JSON input for writes
(the app composing a transaction from form fields) comes later; reads already return the derived
columns alongside the text.
"""

from __future__ import annotations

import datetime
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Body, FastAPI, Query
from fastapi.responses import JSONResponse, PlainTextResponse

from . import engine
from .service import Ledger, NotFound
from .store import Row, Store

BeancountText = Annotated[str, Body(media_type="text/plain")]

log = logging.getLogger(__name__)


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

    @api.get("/books")
    def books() -> list[str]:
        return ledger.books()

    @api.put("/books/{book_id}", status_code=201)
    def create_book(book_id: str) -> dict:
        ledger.create_book(book_id)
        return {"id": book_id}

    @api.post("/books/{book_id}/import")
    def import_text(book_id: str, text: BeancountText) -> dict:
        applied = ledger.apply_text(book_id, text)
        return {"put": applied.put, "deleted": applied.deleted}

    @api.get("/books/{book_id}/export", response_class=PlainTextResponse)
    def export(book_id: str) -> str:
        return ledger.export(book_id)

    @api.get("/books/{book_id}/directives")
    def find(
        book_id: str,
        account: str | None = None,
        flag: str | None = None,
        date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
        date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
        limit: int = 500,
    ) -> list[dict]:
        rows = ledger.store.find(
            book_id, account=account, flag=flag, date_from=date_from, date_to=date_to, limit=limit
        )
        return [_row(r) for r in rows]

    @api.post("/books/{book_id}/directives", status_code=201)
    def create(book_id: str, text: BeancountText) -> dict:
        return _directive(ledger.create(book_id, text))

    @api.get("/books/{book_id}/directives/{directive_id}")
    def get(book_id: str, directive_id: str) -> dict:
        return _row(ledger.get(book_id, directive_id))

    @api.put("/books/{book_id}/directives/{directive_id}")
    def update(book_id: str, directive_id: str, text: BeancountText) -> dict:
        return _directive(ledger.update(book_id, directive_id, text))

    @api.post("/books/{book_id}/directives/{directive_id}/confirm")
    def confirm(book_id: str, directive_id: str) -> dict:
        return _directive(ledger.set_flag(book_id, directive_id, "*"))

    @api.delete("/books/{book_id}/directives/{directive_id}", status_code=204)
    def delete(book_id: str, directive_id: str) -> None:
        ledger.delete(book_id, directive_id)

    @api.get("/books/{book_id}/problems")
    def problems(book_id: str) -> list[dict]:
        return [{"message": p.message, "directive_id": p.directive_id} for p in ledger.problems(book_id)]

    @api.post("/books/{book_id}/query")
    def query(book_id: str, bql: BeancountText) -> dict:
        columns, rows = ledger.query(book_id, bql)
        return {"columns": columns, "rows": rows}

    @api.get("/backup")
    def backup(since: int = 0) -> dict:
        b = ledger.backup(since)
        return {"since": b.since, "cursor": b.cursor, "chunks": b.chunks}

    app.include_router(api)
    return app


def _row(r: Row) -> dict:
    return {"id": r.id, "date": r.date, "kind": r.kind, "flag": r.flag, "text": r.text}


def _directive(d: engine.Directive) -> dict:
    return {"id": d.id, "date": d.date.isoformat(), "kind": d.kind, "flag": d.flag, "text": d.text}


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

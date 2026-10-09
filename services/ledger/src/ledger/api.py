"""HTTP API, mounted at /api/ledger/v1. Traefik routes the prefix here without stripping it.

Two ways to write:

- **Transactions as JSON** (`/transactions`): what the app uses when composing or editing a
  transaction from form fields. The ledger renders the canonical Beancount text, so Beancount
  syntax never leaves this service.
- **Any directive as Beancount text** (`/directives`, `/import`): raw editing, any directive type,
  bulk import and restore.

Both write the same rows, and both read back either way.

Edits are versioned. Every directive carries `updated_at`, which changes on every write; an edit
sends back the `updated_at` it read (in the body for JSON, as a query parameter for text and
deletes), and if the stored one has moved on, the edit is refused with 409 Conflict.
"""

from __future__ import annotations

import datetime
import os
from typing import Annotated

from fastapi import APIRouter, Body, Depends, FastAPI, Query
from fastapi.responses import JSONResponse, PlainTextResponse

from . import engine, models
from .service import Ledger, NotFound
from .store import Row, StaleVersion, Store

BeancountText = Annotated[str, Body(media_type="text/plain")]
VersionParam = Annotated[str, Query(description="The `updated_at` this edit was based on.")]

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


def create_app(ledger: Ledger) -> FastAPI:
    app = FastAPI(
        title="fava-beans ledger",
        docs_url="/api/ledger/v1/docs",
        openapi_url="/api/ledger/v1/openapi.json",
    )
    api = APIRouter(prefix="/api/ledger/v1")

    @app.exception_handler(NotFound)
    async def not_found(_, exc: NotFound):
        return JSONResponse({"detail": f"not found: {exc.args[0]}"}, status_code=404)

    @app.exception_handler(engine.ParseFailure)
    async def unparseable(_, exc: engine.ParseFailure):
        return JSONResponse({"detail": exc.errors}, status_code=422)

    @app.exception_handler(StaleVersion)
    async def stale(_, exc: StaleVersion):
        return JSONResponse({"detail": str(exc), "updated_at": exc.current}, status_code=409)

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

    @api.post("/books/{book_id}/accounts", status_code=201)
    def create_account(book_id: str, account: models.AccountIn) -> models.Account:
        return ledger.create_account(book_id, account)

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

    @api.put("/books/{book_id}/transactions/{directive_id}", responses={409: {"description": "Stale version"}})
    def replace_transaction(
        book_id: str, directive_id: str, transaction: models.TransactionUpdate
    ) -> models.Transaction:
        body = models.TransactionIn.model_validate(transaction.model_dump(exclude={"updated_at"}))
        ledger.update_transaction(book_id, directive_id, body, expected=transaction.updated_at)
        return ledger.transaction(book_id, directive_id)

    @api.patch("/books/{book_id}/transactions/{directive_id}", responses={409: {"description": "Stale version"}})
    def patch_transaction(book_id: str, directive_id: str, patch: models.TransactionPatch) -> models.Transaction:
        ledger.patch_transaction(book_id, directive_id, patch)
        return ledger.transaction(book_id, directive_id)

    # Any directive, as Beancount text

    @api.get("/books/{book_id}/directives")
    def list_directives(book_id: str, filters: Annotated[Filters, Depends()]) -> list[models.Directive]:
        return [_row(r) for r in ledger.store.find(book_id, **filters.values)]

    @api.post("/books/{book_id}/directives", status_code=201)
    def create_directive(book_id: str, text: BeancountText) -> models.Directive:
        return _row(ledger.get(book_id, ledger.create(book_id, text).id))

    @api.get("/books/{book_id}/directives/{directive_id}")
    def get_directive(book_id: str, directive_id: str) -> models.Directive:
        return _row(ledger.get(book_id, directive_id))

    @api.put("/books/{book_id}/directives/{directive_id}", responses={409: {"description": "Stale version"}})
    def update_directive(
        book_id: str, directive_id: str, text: BeancountText, updated_at: VersionParam
    ) -> models.Directive:
        ledger.update(book_id, directive_id, text, expected=updated_at)
        return _row(ledger.get(book_id, directive_id))

    @api.delete(
        "/books/{book_id}/directives/{directive_id}",
        status_code=204,
        responses={409: {"description": "Stale version"}},
    )
    def delete_directive(book_id: str, directive_id: str, updated_at: VersionParam) -> None:
        ledger.delete(book_id, directive_id, expected=updated_at)

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
    return models.Directive(
        id=r.id,
        date=datetime.date.fromisoformat(r.date),
        kind=r.kind,
        flag=r.flag,
        text=r.text,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def from_env() -> FastAPI:
    data_dir = os.environ.get("LEDGER_DATA_DIR", "/data")
    return create_app(Ledger(Store(os.path.join(data_dir, "ledger.sqlite"))))

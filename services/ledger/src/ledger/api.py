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
import re
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from . import budgets, chart, engine, investments, models, reconcile
from .service import Ledger, NameTaken, NotFound, TooLarge
from .store import Row, StaleVersion, Store

BeancountText = Annotated[str, Body(media_type="text/plain")]
VersionParam = Annotated[str, Query(description="The `updated_at` this edit was based on.")]
ReconciledParam = Annotated[
    bool | None, Query(description="Only reconciled transactions (true), or only those not (false).")
]

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


def current_user(x_user_id: Annotated[str | None, Header(include_in_schema=False)] = None) -> str:
    """The caller, from X-User-Id. Traefik sets it after checking the session with the auth
    service, and this service is only reachable through Traefik. (Kept out of the published
    schema: clients never send it themselves.)"""
    if not x_user_id:
        raise HTTPException(401, "not logged in")
    return x_user_id


User = Annotated[str, Depends(current_user)]


def member_book(book_id: str, user: User, request: Request) -> str:
    """The book in the path, if the caller may do what the request does: reading (GET) needs a
    member's read; anything else, write (M13). Anyone not in the book gets 404, as if it didn't
    exist; a member without the role, 403."""
    ledger: Ledger = request.app.state.ledger
    if ledger.role(book_id, user) is None:
        raise NotFound(book_id)
    need = "read" if request.method in ("GET", "HEAD") else "write"
    if not ledger.can(book_id, user, need):
        raise HTTPException(403, "you can see this book, but not change it")
    return book_id


MemberBook = Annotated[str, Depends(member_book)]


def require(ledger: Ledger, book_id: str, user: str, need: str) -> None:
    """Refuse (403) unless the caller has `need` in the book: manage, or owner."""
    if not ledger.can(book_id, user, need):
        what = "the owner" if need == "owner" else "a manager of the book"
        raise HTTPException(403, f"only {what} can do that")


def create_app(ledger: Ledger) -> FastAPI:
    """Every route needs the caller's user ID (see `current_user`); book routes answer only for
    books the caller owns (see `owned_book`)."""

    app = FastAPI(
        title="luminous-money ledger",
        docs_url="/api/ledger/v1/docs",
        openapi_url="/api/ledger/v1/openapi.json",
    )
    app.state.ledger = ledger
    api = APIRouter(prefix="/api/ledger/v1")

    @app.get("/health", include_in_schema=False)
    def health():
        """Up, which version, and its database's schema: for the stack's healthchecks and `app`'s
        public summary. Not routed outside, so it needs no session."""
        return {
            "status": "ok",
            "service": "ledger",
            "version": os.environ.get("LUMINOUS_MONEY_VERSION", "dev"),
            "schema": ledger.store.schema_version(),
        }

    @app.exception_handler(NotFound)
    async def not_found(_, exc: NotFound):
        return JSONResponse({"detail": f"not found: {exc.args[0]}"}, status_code=404)

    @app.exception_handler(engine.ParseFailure)
    async def unparseable(_, exc: engine.ParseFailure):
        return JSONResponse({"detail": exc.errors}, status_code=422)

    @app.exception_handler(StaleVersion)
    async def stale(_, exc: StaleVersion):
        return JSONResponse({"detail": str(exc), "updated_at": exc.current}, status_code=409)

    @app.exception_handler(chart.AccountRefused)
    async def account_refused(_, exc: chart.AccountRefused):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(budgets.BudgetRefused)
    async def budget_refused(_, exc: budgets.BudgetRefused):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(reconcile.ReconcileRefused)
    async def reconcile_refused(_, exc: reconcile.ReconcileRefused):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(TooLarge)
    async def too_large(_, exc: TooLarge):
        return JSONResponse({"detail": str(exc)}, status_code=413)

    @app.exception_handler(NameTaken)
    async def name_taken(_, exc: NameTaken):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(ValueError)
    async def invalid(_, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    # Books

    @api.get("/books")
    def books(user: User) -> list[models.Book]:
        return ledger.books(user)

    @api.post("/books", status_code=201, responses={422: {"description": "Name taken, or text that doesn't parse"}})
    def create_named_book(book: models.BookIn, user: User) -> models.Book:
        created = ledger.create_book(name=book.name, owner_id=user, text=book.text)
        return ledger.book(created.id, user)

    @api.put("/books/{book_id}", status_code=201)
    def create_book(book_id: str, user: User) -> models.Book:
        return ledger.book(ledger.create_book(book_id, owner_id=user).id, user)

    @api.get("/books/{book_id}")
    def get_book(book_id: MemberBook, user: User) -> models.Book:
        return ledger.book(book_id, user)

    @api.patch("/books/{book_id}", responses={409: {"description": "Stale version"}, 422: {"description": "Name taken"}})
    def rename_book(book_id: MemberBook, patch: models.BookPatch, user: User) -> models.Book:
        """Rename the book (a manager)."""
        require(ledger, book_id, user, "manage")
        ledger.rename_book(book_id, patch.name, expected=patch.updated_at)
        return ledger.book(book_id, user)

    @api.delete("/books/{book_id}", status_code=204, responses={409: {"description": "Stale version"}})
    def delete_book(book_id: MemberBook, updated_at: VersionParam, user: User) -> None:
        """Delete the book and everything in it (its owner). Backups carry the deletion as
        tombstones."""
        require(ledger, book_id, user, "owner")
        ledger.delete_book(book_id, expected=updated_at)

    # Members (M13)

    @api.get("/books/{book_id}/members")
    def members(book_id: MemberBook) -> list[models.Member]:
        """Who has the book: its owner, then its members, each with their role."""
        return ledger.members(book_id)

    @api.put("/books/{book_id}/members/{user_id}", responses={409: {"description": "Stale version"}})
    def put_member(book_id: MemberBook, user_id: str, m: models.MemberIn, user: User) -> models.Member:
        """Add a member, or change their role (a manager)."""
        require(ledger, book_id, user, "manage")
        return ledger.set_member(book_id, user_id, m)

    @api.delete("/books/{book_id}/members/{user_id}", status_code=204)
    def remove_member(book_id: str, user_id: str, user: User) -> None:
        """Take a member out (a manager), or leave (yourself)."""
        if ledger.role(book_id, user) is None:
            raise NotFound(book_id)
        if user_id != user:
            require(ledger, book_id, user, "manage")
        ledger.remove_member(book_id, user_id)

    @api.post("/books/{book_id}/import")
    def import_text(book_id: str, text: BeancountText, user: User) -> models.Applied:
        """Apply Beancount text. Creates the book, owned by the caller, if it doesn't exist."""
        if ledger.store.book(book_id) is not None:  # or deleted
            if ledger.role(book_id, user) is None:
                raise NotFound(book_id)
            if not ledger.can(book_id, user, "write"):
                raise HTTPException(403, "you can see this book, but not change it")
        applied = ledger.apply_text(book_id, text, owner_id=user)
        return models.Applied(put=applied.put, deleted=applied.deleted)

    @api.get("/books/{book_id}/export", response_class=PlainTextResponse)
    def export(book_id: MemberBook) -> PlainTextResponse:
        """The whole book as one Beancount file, named for downloading: the user's own copy of their
        data, which `/import` can restore. (`/backup` gives every book of the caller's, changed
        since a cursor, for scheduled backups.)"""
        filename = re.sub(r"[^A-Za-z0-9_-]+", "-", ledger.book(book_id).name).strip("-") or book_id
        return PlainTextResponse(
            ledger.export(book_id),
            headers={"Content-Disposition": f'attachment; filename="{filename}.beancount"'},
        )

    @api.get("/books/{book_id}/accounts")
    def accounts(book_id: MemberBook) -> list[models.Account]:
        return ledger.accounts(book_id)

    @api.post("/books/{book_id}/accounts", status_code=201)
    def create_account(book_id: MemberBook, account: models.AccountIn) -> models.Account:
        return ledger.create_account(book_id, account)

    # Account summaries and ledgers

    @api.get("/books/{book_id}/accounts/summary")
    def account_summary(
        book_id: MemberBook,
        account: Annotated[list[str], Query(description="The accounts to summarize; repeat for more.")],
    ) -> list[models.AccountSummary]:
        """Accounts with their balances and opening-balance dates: what the home page's cards and a
        ledger's header show."""
        return ledger.summary(book_id, account)

    # Investments (M5)

    # The chart of accounts (M10)

    @api.get("/books/{book_id}/accounts/tree")
    def account_tree(book_id: MemberBook) -> list[models.TreeAccount]:
        """Every account, with its own balance, its subtree's, and the subtree's value."""
        return chart.tree(ledger, book_id)

    # Budgets (M11)

    @api.get("/books/{book_id}/budgets")
    def list_budgets(book_id: MemberBook) -> list[models.Budget]:
        """Every version of every budget, by account, then start."""
        return [v.model() for v in budgets.versions(ledger, book_id)]

    @api.get("/books/{book_id}/budgets/status")
    def budget_status(
        book_id: MemberBook,
        on: Annotated[datetime.date | None, Query(description="The day to measure on (the caller's today).")] = None,
        basis: Annotated[Literal["period", "month"], Query(description="Each its own period, or all per month.")] = "period",
    ) -> models.BudgetStatus:
        """Every budget in force, measured over its current period, with what's left."""
        return budgets.status(ledger, book_id, on or datetime.date.today(), basis)

    @api.put(
        "/books/{book_id}/budgets/{account}",
        responses={409: {"description": "Stale version"}, 422: {"description": "Not allowed"}},
    )
    def put_budget(book_id: MemberBook, account: str, b: models.BudgetIn) -> models.Budget | None:
        """Set the account's budget from `start` on (an amount of 0 ends it). Refused if it would
        be more than one above it, or less than one under it. None when ending it left nothing."""
        return budgets.put(ledger, book_id, account, b)

    @api.post(
        "/books/{book_id}/accounts/{account}/rename",
        responses={409: {"description": "Stale version"}, 422: {"description": "Not allowed"}},
    )
    def rename_account(book_id: MemberBook, account: str, r: models.AccountRename) -> models.Account:
        """Rename or move an account and everything under it: every directive naming them is
        rewritten, history included, in one write."""
        return chart.rename(ledger, book_id, account, r.to, expected=r.updated_at)

    @api.post(
        "/books/{book_id}/accounts/{account}/divide",
        responses={409: {"description": "Stale version"}, 422: {"description": "Not allowed"}},
    )
    def divide_account(book_id: MemberBook, account: str, d: models.DivideIn) -> models.Account:
        """Divide an asset or liability account (M15): a divided account of the same name, its
        history in its main part, the other parts given their amounts by one transfer."""
        return chart.divide(ledger, book_id, account, d)

    @api.post("/books/{book_id}/accounts/{account}/archive", responses={422: {"description": "Not allowed"}})
    def archive_account(book_id: MemberBook, account: str, a: models.AccountArchive) -> list[str]:
        """Close the account and every opened account under it (after an optional closing
        transfer). Returns the accounts closed."""
        return chart.archive(ledger, book_id, account, date=a.date, transfer_to=a.transfer_to, expected=a.updated_at)

    @api.post("/books/{book_id}/accounts/{account}/unarchive")
    def unarchive_account(book_id: MemberBook, account: str) -> list[str]:
        """Reopen an archived account and everything under it. Returns the accounts reopened."""
        return chart.unarchive(ledger, book_id, account)

    @api.delete(
        "/books/{book_id}/accounts/{account}",
        responses={409: {"description": "Stale version"}, 422: {"description": "Not allowed"}},
    )
    def delete_account(
        book_id: MemberBook, account: str, substitute: str | None = None, updated_at: str | None = None
    ) -> list[str]:
        """Delete the account and its subtree, moving every posting to `substitute` (needed if
        there are any). Merging is this. Returns the accounts deleted."""
        return chart.delete(ledger, book_id, account, substitute=substitute, expected=updated_at)

    @api.get("/books/{book_id}/accounts/{account}/purge")
    def purge_preview(book_id: MemberBook, account: str) -> models.PurgePreview:
        """What deleting the account with its transactions would do: what goes, and every other
        account those transactions touch."""
        return chart.purge_preview(ledger, book_id, account)

    @api.post(
        "/books/{book_id}/accounts/{account}/purge",
        responses={409: {"description": "Stale version"}, 422: {"description": "Not allowed"}},
    )
    def purge(book_id: MemberBook, account: str, body: models.PurgeIn) -> models.Purged:
        """Delete the account and its subtree with every transaction that posts to them (from
        every account they touch). Returns what was deleted."""
        return chart.purge(ledger, book_id, account, expected=body.updated_at)

    @api.get("/books/{book_id}/accounts/{account}/holdings")
    def holdings(book_id: MemberBook, account: str, on: datetime.date | None = None) -> models.Holdings:
        """What an account and everything under it holds: units, prices, value, cost basis, gains
        and lots per commodity."""
        return investments.holdings(ledger, book_id, account, on)

    @api.post("/books/{book_id}/accounts/{account}/revalue", status_code=201)
    def revalue(book_id: MemberBook, account: str, r: models.RevalueIn) -> models.Transaction:
        """Record a revalued asset's value on a date (against Income:Unrealized-Gains)."""
        directive = investments.revalue(ledger, book_id, account, r)
        return ledger.transaction(book_id, directive.id)

    @api.patch("/books/{book_id}/accounts/{account}", responses={409: {"description": "Stale version"}})
    def set_account(book_id: MemberBook, account: str, patch: models.AccountPatch) -> models.Account:
        """Change an account's settings: how its sales pick lots; whether it's a revalued asset."""
        return ledger.set_account(book_id, account, patch)

    @api.post("/books/{book_id}/accounts/{account}/trades/preview")
    def preview_trade(book_id: MemberBook, account: str, t: models.TradeIn) -> models.TradePreview:
        """What a trade would write: the transaction, and the lots a sale draws on."""
        return investments.plan_trade(ledger, book_id, account, t)

    @api.post("/books/{book_id}/accounts/{account}/trades", status_code=201)
    def trade(book_id: MemberBook, account: str, t: models.TradeIn) -> models.Transaction:
        """Write a buy, sale or dividend, checked by booking first."""
        directive = investments.trade(ledger, book_id, account, t)
        return ledger.transaction(book_id, directive.id)

    @api.get("/books/{book_id}/prices")
    def price_list(book_id: MemberBook, commodity: str) -> list[models.PriceOut]:
        """A commodity's prices, newest first."""
        return investments.price_list(ledger, book_id, commodity)

    @api.post("/books/{book_id}/prices", status_code=201)
    def add_price(book_id: MemberBook, price: models.PriceIn) -> models.PriceOut:
        """Record a price (replacing one for the same commodity, currency and date)."""
        return investments.add_price(ledger, book_id, price)

    @api.post("/books/{book_id}/prices/fetch")
    def fetch_prices(book_id: MemberBook) -> models.FetchResult:
        """Fetch the latest prices of the commodities still held that name a source (beanprice)."""
        return investments.fetch_prices(ledger, book_id)

    @api.get("/books/{book_id}/commodities")
    def commodity_list(book_id: MemberBook) -> list[models.CommodityOut]:
        """Every commodity declared, held or priced, with its latest price."""
        return investments.commodity_list(ledger, book_id)

    @api.put("/books/{book_id}/commodities/{currency}", responses={409: {"description": "Stale version"}})
    def set_commodity(book_id: MemberBook, currency: str, c: models.CommodityIn) -> models.CommodityOut:
        """Declare a commodity, or change its name, price source or staleness."""
        return investments.set_commodity(ledger, book_id, currency, c)

    @api.get("/books/{book_id}/accounts/{account}/ledger")
    def account_ledger(
        book_id: MemberBook,
        account: str,
        cursor: Annotated[str | None, Query(description="The page just older than this row.")] = None,
        after: Annotated[str | None, Query(description="The page just newer than this row.")] = None,
        date: Annotated[datetime.date | None, Query(description="The page starting on or before this date.")] = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 200,
        reconciled: ReconciledParam = None,
    ) -> models.LedgerPage:
        if sum(x is not None for x in (cursor, after, date)) > 1:
            raise HTTPException(422, "pass one of cursor, after and date")
        return ledger.account_ledger(
            book_id, account, cursor=cursor, after=after, date=date, limit=limit, reconciled=reconciled
        )

    @api.get("/books/{book_id}/journal")
    def journal(
        book_id: MemberBook,
        cursor: Annotated[str | None, Query(description="The page just older than this row.")] = None,
        after: Annotated[str | None, Query(description="The page just newer than this row.")] = None,
        date: Annotated[datetime.date | None, Query(description="The page starting on or before this date.")] = None,
        limit: Annotated[int, Query(ge=1, le=1000)] = 200,
        reconciled: ReconciledParam = None,
    ) -> models.JournalPage:
        """Every transaction in the book (every account's), newest first, paged as an account's
        ledger is."""
        if sum(x is not None for x in (cursor, after, date)) > 1:
            raise HTTPException(422, "pass one of cursor, after and date")
        return ledger.journal(book_id, cursor=cursor, after=after, date=date, limit=limit, reconciled=reconciled)

    # Reconciliation (M14)

    @api.get("/books/{book_id}/accounts/{account}/reconciliation", responses={422: {"description": "Not reconciled itself"}})
    def reconciliation(
        book_id: MemberBook,
        account: str,
        through: Annotated[
            datetime.date | None, Query(description="The statement's date: transactions to 14 days after it.")
        ] = None,
    ) -> models.ReconcileState:
        """What reconciling the account needs: what's reconciled so far, the last statement, and
        the unreconciled transactions, oldest first."""
        return reconcile.state(ledger, book_id, account, through)

    @api.post(
        "/books/{book_id}/accounts/{account}/reconciliations",
        status_code=201,
        responses={422: {"description": "It doesn't balance, or isn't allowed"}},
    )
    def reconcile_account(book_id: MemberBook, account: str, r: models.ReconcileIn) -> models.Reconciled:
        """Reconcile the account with a statement, in one write: the ticked transactions (and
        transfers within it) marked, unconfirmed ones confirmed, dates moved to agree with the
        statement, its balance written. Refused unless it balances."""
        return reconcile.reconcile(ledger, book_id, account, r)

    @api.get("/books/{book_id}/accounts/{account}/reconciliations")
    def reconciliations(book_id: MemberBook, account: str) -> models.Reconciliations:
        """The account's reconciliations (and balance checks from imported books), newest first,
        each against the books."""
        return reconcile.history(ledger, book_id, account)

    @api.delete(
        "/books/{book_id}/accounts/{account}/reconciliations/{statement_date}",
        status_code=204,
        responses={422: {"description": "Not the latest"}},
    )
    def undo_reconciliation(book_id: MemberBook, account: str, statement_date: datetime.date) -> None:
        """Undo the account's latest reconciliation: its marks and balance go."""
        reconcile.undo(ledger, book_id, account, statement_date)

    @api.get("/books/{book_id}/accounts/{account}/balances")
    def day_balances(
        book_id: MemberBook,
        account: str,
        date_from: Annotated[datetime.date, Query(alias="from")],
        date_to: Annotated[datetime.date, Query(alias="to")],
    ) -> models.DayBalances:
        """The account's (and its subtree's) balance at the end of each day it changed, in its
        currency, and at the end of the day before `from`."""
        return reconcile.day_balances(ledger, book_id, account, date_from, date_to)

    # Transactions, as JSON

    @api.post("/books/{book_id}/transactions/batch", status_code=201)
    def create_transactions(book_id: MemberBook, batch: list[models.TransactionIn]) -> list[models.Transaction]:
        """Create many transactions in one atomic write: all of them, or none."""
        created = ledger.create_transactions(book_id, batch)
        return [ledger.transaction(book_id, d.id) for d in created]

    @api.post("/books/{book_id}/transactions/changes", responses={409: {"description": "Stale version"}})
    def apply_changes(book_id: MemberBook, changes: models.TransactionChanges) -> list[models.Transaction]:
        """Create, change (versioned patches) and delete transactions in one atomic write: all of
        it, or none. Returns the created ones."""
        created = ledger.apply_changes(book_id, changes)
        return [ledger.transaction(book_id, d.id) for d in created]

    @api.get("/books/{book_id}/transactions/compact")
    def compact_transactions(
        book_id: MemberBook,
        date_from: Annotated[datetime.date, Query(alias="from", description="The first date included.")],
    ) -> list[models.CompactTransaction]:
        """Every transaction from a date on, oldest first, with only payee, narration, whether it
        counts against budgets, and each posting's account and amount: the context categorizers
        work from, and reports' posting stream. Not paged."""
        return ledger.compact(book_id, date_from)

    @api.get("/books/{book_id}/transactions")
    def list_transactions(book_id: MemberBook, filters: Annotated[Filters, Depends()]) -> list[models.Transaction]:
        return ledger.transactions(book_id, **filters.values)

    @api.post("/books/{book_id}/transactions", status_code=201)
    def create_transaction(book_id: MemberBook, transaction: models.TransactionIn) -> models.Transaction:
        return ledger.transaction(book_id, ledger.create_transaction(book_id, transaction).id)

    @api.get("/books/{book_id}/transactions/{directive_id}")
    def get_transaction(book_id: MemberBook, directive_id: str) -> models.Transaction:
        return ledger.transaction(book_id, directive_id)

    @api.put("/books/{book_id}/transactions/{directive_id}", responses={409: {"description": "Stale version"}})
    def replace_transaction(
        book_id: MemberBook, directive_id: str, transaction: models.TransactionUpdate
    ) -> models.Transaction:
        body = models.TransactionIn.model_validate(transaction.model_dump(exclude={"updated_at"}))
        ledger.update_transaction(book_id, directive_id, body, expected=transaction.updated_at)
        return ledger.transaction(book_id, directive_id)

    @api.patch("/books/{book_id}/transactions/{directive_id}", responses={409: {"description": "Stale version"}})
    def patch_transaction(book_id: MemberBook, directive_id: str, patch: models.TransactionPatch) -> models.Transaction:
        ledger.patch_transaction(book_id, directive_id, patch)
        return ledger.transaction(book_id, directive_id)

    # Attachments (M16)

    @api.get("/books/{book_id}/transactions/{directive_id}/attachments")
    def attachments(book_id: MemberBook, directive_id: str) -> list[models.Attachment]:
        """The files a transaction holds, oldest first."""
        return ledger.attachments(book_id, directive_id)

    @api.post(
        "/books/{book_id}/transactions/{directive_id}/attachments",
        status_code=201,
        responses={413: {"description": "Over 5 MB"}},
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
            }
        },
    )
    async def attach(
        book_id: MemberBook,
        directive_id: str,
        request: Request,
        filename: Annotated[str, Query(description="The file's name, as it was.")] = "attachment",
    ) -> models.Attachment:
        """Attach a file (at most 5 MB): the body is the file, its `Content-Type` its type."""
        declared = int(request.headers.get("content-length") or 0)
        if declared > Ledger.ATTACHMENT_LIMIT:
            raise TooLarge("an attachment is at most 5 MB")
        data = await request.body()
        content_type = request.headers.get("content-type") or "application/octet-stream"
        return ledger.attach(book_id, directive_id, filename, content_type.split(";")[0].strip(), data)

    @api.get(
        "/books/{book_id}/attachments/{attachment_id}",
        response_class=Response,
        responses={200: {"content": {"application/octet-stream": {}}, "description": "The file."}},
    )
    def attachment_file(book_id: MemberBook, attachment_id: str) -> Response:
        """An attachment's file, as it was attached."""
        found, data = ledger.attachment(book_id, attachment_id)
        safe = re.sub(r'["\\\r\n]', "", found.filename) or "attachment"
        return Response(
            content=data,
            media_type=found.content_type,
            headers={"Content-Disposition": f'inline; filename="{safe}"', "Cache-Control": "private, max-age=3600"},
        )

    @api.delete("/books/{book_id}/attachments/{attachment_id}", status_code=204)
    def detach(book_id: MemberBook, attachment_id: str) -> None:
        ledger.detach(book_id, attachment_id)

    # Any directive, as Beancount text

    @api.get("/books/{book_id}/directives")
    def list_directives(book_id: MemberBook, filters: Annotated[Filters, Depends()]) -> list[models.Directive]:
        return [_row(r) for r in ledger.store.find(book_id, **filters.values)]

    @api.post("/books/{book_id}/directives", status_code=201)
    def create_directive(book_id: MemberBook, text: BeancountText) -> models.Directive:
        return _row(ledger.get(book_id, ledger.create(book_id, text).id))

    @api.get("/books/{book_id}/directives/{directive_id}")
    def get_directive(book_id: MemberBook, directive_id: str) -> models.Directive:
        return _row(ledger.get(book_id, directive_id))

    @api.put("/books/{book_id}/directives/{directive_id}", responses={409: {"description": "Stale version"}})
    def update_directive(
        book_id: MemberBook, directive_id: str, text: BeancountText, updated_at: VersionParam
    ) -> models.Directive:
        ledger.update(book_id, directive_id, text, expected=updated_at)
        return _row(ledger.get(book_id, directive_id))

    @api.delete(
        "/books/{book_id}/directives/{directive_id}",
        status_code=204,
        responses={409: {"description": "Stale version"}},
    )
    def delete_directive(book_id: MemberBook, directive_id: str, updated_at: VersionParam) -> None:
        ledger.delete(book_id, directive_id, expected=updated_at)

    # The engine

    @api.get("/books/{book_id}/problems")
    def problems(book_id: MemberBook) -> list[models.Problem]:
        return [models.Problem(message=p.message, directive_id=p.directive_id) for p in ledger.problems(book_id)]

    @api.post("/books/{book_id}/query")
    def query(book_id: MemberBook, bql: BeancountText) -> models.QueryResult:
        columns, rows = ledger.query(book_id, bql)
        return models.QueryResult(columns=columns, rows=rows)

    # Backups

    @api.get("/backup")
    def backup(user: User, since: int = 0) -> models.Backup:
        """The caller's books, changed since `since`."""
        b = ledger.backup(since, books=ledger.store.books(user, deleted=True))
        return models.Backup(since=b.since, cursor=b.cursor, chunks=b.chunks, deleted_books=b.deleted_books)

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

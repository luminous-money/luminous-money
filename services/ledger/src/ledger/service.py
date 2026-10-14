"""The ledger service's operations: books, writes, the engine, import/export and backups.

Import and restore are the same operation: apply Beancount text containing directives (upserted
by `id` metadata) and tombstones (deleted by ID). A backup chunk is just such text, so restoring
a backup means applying its chunks in cursor order.
"""

from __future__ import annotations

import datetime
import threading
from dataclasses import dataclass
from decimal import Decimal

from . import engine, investments, models
from .store import Row, Store

# New books: dollars, and sales draw on the oldest lots first (US tax reporting's default).
DEFAULT_HEADER = ['option "operating_currency" "USD"', 'option "booking_method" "FIFO"']


class NotFound(KeyError):
    pass


@dataclass(frozen=True)
class Applied:
    put: int
    deleted: int


@dataclass(frozen=True)
class Backup:
    since: int
    cursor: int
    chunks: dict[str, str]  # book id -> Beancount text (header, changed directives, tombstones)


class Ledger:
    def __init__(self, store: Store):
        self.store = store
        self._loaded: dict[str, tuple[int, engine.Loaded]] = {}
        self._load_lock = threading.Lock()

    # Books

    def books(self, owner_id: str | None = None) -> list[models.Book]:
        """Every book, or just those `owner_id` owns, oldest first."""
        return [self.book(book_id) for book_id in self.store.books(owner_id)]

    def book(self, book_id: str) -> models.Book:
        row = self.store.book(book_id)
        if row is None:
            raise NotFound(book_id)
        header = [line for line in row["header"].split("\n") if line]
        return models.Book(
            id=row["id"],
            name=engine.book_title(header) or row["id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def owns(self, book_id: str, user_id: str) -> bool:
        row = self.store.book(book_id)
        return row is not None and row["owner_id"] == user_id

    def create_book(
        self,
        book_id: str | None = None,
        header: list[str] | None = None,
        *,
        name: str | None = None,
        owner_id: str | None = None,
    ) -> models.Book:
        """Create a book. Its ID is generated unless given; its name becomes its title."""
        book_id = book_id or engine.new_id()
        header = header or DEFAULT_HEADER
        if name is not None:
            header = engine.with_title(header, name)
        with self.store.transaction():
            if self.store.book(book_id) is not None:
                raise ValueError(f"book {book_id} already exists")
            self.store.put_book(book_id, header, owner_id)
        return self.book(book_id)

    def rename_book(self, book_id: str, name: str, *, expected: str | None = None) -> models.Book:
        """Rename a book: its title changes, so exports and backups carry the new name too."""
        header = engine.with_title(self._header(book_id), name)
        with self.store.transaction():
            if expected is not None:
                self.store.check_book_version(book_id, expected)
            self.store.put_book(book_id, header)
        return self.book(book_id)

    def _header(self, book_id: str) -> list[str]:
        header = self.store.header(book_id)
        if header is None:
            raise NotFound(book_id)
        return header

    # Import, export, restore

    def apply_text(self, book_id: str, text: str, *, owner_id: str | None = None) -> Applied:
        return self._apply(book_id, engine.parse_text(text), owner_id)

    def apply_file(self, book_id: str, path: str, *, owner_id: str | None = None) -> Applied:
        return self._apply(book_id, engine.parse_file(path), owner_id)

    def _apply(self, book_id: str, parsed: engine.Parsed, owner_id: str | None = None) -> Applied:
        """Apply parsed input atomically, creating the book (owned by `owner_id`) if needed.
        Header lines are merged."""
        with self.store.transaction():
            current = self.store.header(book_id)
            merged = list(dict.fromkeys((current or []) + parsed.header)) or DEFAULT_HEADER
            if merged != current:
                self.store.put_book(book_id, merged, owner_id)
            self.store.put(book_id, parsed.directives)
            deleted = self.store.delete(book_id, parsed.tombstones)
        return Applied(put=len(parsed.directives), deleted=len(deleted))

    def export(self, book_id: str) -> str:
        """The whole book as a self-contained Beancount ledger."""
        return engine.render(self._header(book_id), [r.text for r in self.store.live(book_id)])

    # Backups

    def backup(self, since: int = 0, books: list[str] | None = None) -> Backup:
        """Everything changed after cursor `since`, as one Beancount chunk per changed book.

        Directives come out in ordinal order, so applying chunks in order reproduces the same
        within-day ordering: existing directives keep their ordinal, and new ones append, just as
        they did when they were created. Taken in one read transaction so the cursor and chunks
        agree.
        """
        with self.store.transaction():
            cursor = self.store.cursor()
            chunks = {}
            for book_id in self.store.books() if books is None else books:
                if not self.store.book_changed_since(book_id, since):
                    continue
                today = datetime.date.today()
                texts = [
                    engine.tombstone(r.id, today) if r.deleted else r.text
                    for r in self.store.changed_since(book_id, since)
                ]
                chunks[book_id] = engine.render(self._header(book_id), texts)
        return Backup(since=since, cursor=cursor, chunks=chunks)

    # Directives

    def get(self, book_id: str, directive_id: str) -> Row:
        row = self.store.get(book_id, directive_id)
        if row is None or row.deleted:
            raise NotFound(directive_id)
        return row

    def create(self, book_id: str, text: str) -> engine.Directive:
        return self._insert(book_id, self._postable(book_id, engine.parse_one(text)))

    def update(self, book_id: str, directive_id: str, text: str, *, expected: str | None = None) -> engine.Directive:
        """Replace a directive. With `expected` (the version read), refuse if it has moved on."""
        self.get(book_id, directive_id)
        return self._put(book_id, self._postable(book_id, engine.parse_one(text, directive_id)), expected)

    def create_transaction(self, book_id: str, t: models.TransactionIn) -> engine.Directive:
        return self._insert(book_id, self._postable(book_id, engine.transaction_directive(t)))

    def update_transaction(
        self, book_id: str, directive_id: str, t: models.TransactionIn, *, expected: str | None = None
    ) -> engine.Directive:
        if self.get(book_id, directive_id).kind != "transaction":
            raise ValueError(f"directive {directive_id} is not a transaction")
        return self._put(book_id, self._postable(book_id, engine.transaction_directive(t, directive_id)), expected)

    def patch_transaction(self, book_id: str, directive_id: str, patch: models.TransactionPatch) -> engine.Directive:
        """Change only the fields given, against the version given."""
        current = self.transaction(book_id, directive_id)
        changes = patch.model_dump(exclude_unset=True, exclude={"updated_at"})
        merged = models.TransactionIn.model_validate(
            {**current.model_dump(include=set(models.TransactionIn.model_fields)), **changes}
        )
        return self.update_transaction(book_id, directive_id, merged, expected=patch.updated_at)

    def set_flag(self, book_id: str, directive_id: str, flag: str, *, expected: str | None = None) -> engine.Directive:
        """Confirm (`*`) or re-stage (`!`) a transaction."""
        return self._put(book_id, engine.with_flag(self.get(book_id, directive_id).text, flag), expected)

    def delete(self, book_id: str, directive_id: str, *, expected: str | None = None) -> None:
        self.get(book_id, directive_id)
        with self.store.transaction():
            if expected is not None:
                self.store.check_version(book_id, directive_id, expected)
            self.store.delete(book_id, [directive_id])

    def transaction(self, book_id: str, directive_id: str) -> models.Transaction:
        found = self._with_versions([self.get(book_id, directive_id)])
        if not found:
            raise NotFound(directive_id)
        return found[0]

    def transactions(self, book_id: str, **filters) -> list[models.Transaction]:
        """Transactions matching `Store.find` filters, structured, in ledger order."""
        self._header(book_id)
        return self._with_versions(self.store.find(book_id, kind="transaction", **filters))

    def _with_versions(self, rows: list[Row]) -> list[models.Transaction]:
        by_id = {r.id: r for r in rows}
        return [
            models.Transaction(
                id=directive_id,
                created_at=by_id[directive_id].created_at,
                updated_at=by_id[directive_id].updated_at,
                **body.model_dump(),
            )
            for directive_id, body in engine.transactions([r.text for r in rows])
        ]

    def _kinds(self, book_id: str) -> dict[str, str]:
        return {a.name: a.kind for a in self.accounts(book_id)}

    def _postable(
        self, book_id: str, directive: engine.Directive, kinds: dict[str, str] | None = None
    ) -> engine.Directive:
        """Refuse writes that post to node accounts. (Imports aren't refused; validation flags them.)"""
        if directive.postings:
            kinds = kinds if kinds is not None else self._kinds(book_id)
            nodes = sorted({p.account for p in directive.postings if kinds.get(p.account) == "node"})
            if nodes:
                raise engine.ParseFailure([engine.node_posting_message(name) for name in nodes])
        return directive

    def accounts(self, book_id: str) -> list[models.Account]:
        header = self._header(book_id)
        rows = [r for kind in ("open", "close") for r in self.store.find(book_id, kind=kind, limit=None)]
        return engine.accounts(header, [r.text for r in rows], {r.id: r.updated_at for r in rows})

    def set_account(self, book_id: str, name: str, patch: models.AccountPatch) -> models.Account:
        """Change an account's settings (only those given), against its version: how its sales
        pick lots, and whether it's a revalued asset (and how often)."""
        account = next((a for a in self.accounts(book_id) if a.name == name and not a.implicit), None)
        if account is None:
            raise NotFound(name)
        row = next(r for r in self.store.find(book_id, kind="open", limit=None) if engine.opened(r.text) == name)
        changes = patch.model_dump(exclude_unset=True, exclude={"updated_at"})
        directive = engine.reopened(
            row.text,
            booking=changes.get("booking", account.booking),
            revalue_every=changes.get("revalue_every", account.revalue_every),
        )
        self._put(book_id, engine.parse_one(directive.text, row.id), patch.updated_at)
        return self._account(book_id, name)

    def create_account(self, book_id: str, a: models.AccountIn) -> models.Account:
        """Open an account by its fully qualified name. Its root sets the type.

        Top-level accounts are built in, so a new account is always below one. Its nearest existing
        ancestor must be a node: leaves hold transactions, not sub-accounts. Levels in between that
        don't exist at all are opened as nodes along the way, in the same write. A name that's only
        implicit so far can be opened explicitly, but only as a node, since it already has
        accounts under it.

        A leaf can come with an opening balance: its balance on a date, from a statement. It's
        recorded as a transaction against `Equity:Opening-Balances` on that date (even when it's
        zero: its date is the account's `as_of`, which says where imports start, and it can be
        moved like any transaction), and the account opens then and holds that currency. All of
        it is one write.
        """
        opening = a.opening_balance
        if (opening or a.opening_holdings) and a.kind != "leaf":
            raise engine.ParseFailure(["only a leaf account can have an opening balance or holdings"])
        if a.opening_holdings and not opening:
            raise engine.ParseFailure(["opening holdings need an opening balance's date (its amount can be 0)"])
        opened = a.open or (opening.date if opening else None)
        meta = {engine.REVALUE_EVERY_KEY: Decimal(a.revalue_every)} if a.revalue_every else None
        directives = self._account_directives(
            book_id,
            a.name,
            a.kind,
            opened,
            # Only a plain cash account is held to its currency: holdings bring their own.
            currencies=[opening.currency] if opening and not a.opening_holdings else None,
            meta=meta,
            booking=a.booking,
        )
        if opening:
            if self.OPENING_BALANCES not in {x.name for x in self.accounts(book_id) if not x.implicit}:
                directives += self._account_directives(book_id, self.OPENING_BALANCES, "leaf", opening.date)
            transaction = models.TransactionIn(
                date=opening.date,
                flag="*",
                narration="Opening balance",
                postings=[
                    models.Posting(account=a.name, units=models.Amount(number=opening.amount, currency=opening.currency)),
                    *investments.opening_lots(self, book_id, a.name, a.opening_holdings, opening),
                    models.Posting(account=self.OPENING_BALANCES),
                ],
            )
            directives.append(engine.transaction_directive(transaction))
        with self.store.transaction():
            self.store.put(book_id, directives)
        return self._account(book_id, a.name)

    def _account(self, book_id: str, name: str) -> models.Account:
        return next(x for x in self.accounts(book_id) if x.name == name)

    def _account_directives(
        self,
        book_id: str,
        name: str,
        kind: str,
        opened: datetime.date | None,
        *,
        currencies: list[str] | None = None,
        meta: dict[str, object] | None = None,
        booking: str | None = None,
    ) -> list[engine.Directive]:
        """The `open` directives for a new account and any nodes on the way, after checking the
        account rules (see `create_account`)."""
        tree = {x.name: x for x in self.accounts(book_id)}
        roots = engine.root_types(self._header(book_id))
        segments = name.split(":")
        existing = tree.get(name)
        if segments[0] not in roots:
            raise engine.ParseFailure([f"account names start with one of {', '.join(roots)}"])
        if len(segments) == 1:
            raise engine.ParseFailure(["top-level accounts are built in; name an account under one"])
        if existing and not existing.implicit:
            raise ValueError(f"{name} already exists")
        if existing and kind == "leaf":
            raise engine.ParseFailure([f"{name} already has sub-accounts, so it can only be a node"])
        ancestor = next(
            tree[n] for i in range(len(segments) - 1, 0, -1) if (n := ":".join(segments[:i])) in tree
        )
        if ancestor.kind != "node":
            raise engine.ParseFailure([f"{ancestor.name} is a leaf account and can't have sub-accounts"])
        if ancestor.close:
            raise engine.ParseFailure([f"{ancestor.name} is closed"])

        opened = opened or self._default_open(book_id, ancestor, tree)
        depth = ancestor.name.count(":") + 1
        en_route = [":".join(segments[:i]) for i in range(depth + 1, len(segments))]
        directives = [engine.open_directive(n, opened, "node") for n in en_route]
        directives.append(engine.open_directive(name, opened, kind, currencies=currencies, meta=meta, booking=booking))
        return directives

    # Opening balances and summaries

    OPENING_BALANCES = "Equity:Opening-Balances"

    def compact(self, book_id: str, date_from: datetime.date) -> list[models.CompactTransaction]:
        """Every transaction dated `date_from` or later, oldest first, in compact form: the
        context categorizers work from, read with plain SQL so a long window stays fast."""
        self._header(book_id)
        out: list[models.CompactTransaction] = []
        for r in self.store.compact(book_id, date_from.isoformat()):
            if not out or out[-1].id != r["id"]:
                out.append(
                    models.CompactTransaction(
                        id=r["id"],
                        date=datetime.date.fromisoformat(r["date"]),
                        flag=r["flag"],
                        payee=r["payee"],
                        narration=r["narration"],
                        postings=[],
                    )
                )
            amount = (
                models.Amount(number=r["amount"], currency=r["amount_currency"]) if r["amount"] is not None else None
            )
            out[-1].postings.append(models.CompactPosting(account=r["account"], amount=amount))
        return out

    def summary(self, book_id: str, names: list[str]) -> list[models.AccountSummary]:
        """The named accounts (those that exist, in the order asked), with their balances and the
        dates of their opening balances."""
        openings = self.store.opening_dates(book_id, self.OPENING_BALANCES)
        by_name = {a.name: a for a in self.accounts(book_id)}
        return [
            investments.valued(
                self,
                book_id,
                models.AccountSummary(
                    **by_name[name].model_dump(),
                    balance=self.balance(book_id, name),
                    as_of=openings.get(name),
                ),
            )
            for name in dict.fromkeys(names)
            if name in by_name
        ]

    def balance(self, book_id: str, account: str) -> list[models.Amount]:
        """The account's balance, pending transactions included, one amount per currency.

        Plain SQL over each posting's stored amount, so it's fast at any book size. If any of the
        account's amounts could only be worked out by full booking (rare: lots, prices, mixed
        currencies), the whole balance comes from Beancount instead.
        """
        totals: dict[str, Decimal] = {}
        for row in self.store.account_entries(book_id, account):
            for piece in row["amounts"].split(";"):
                if piece == "?":
                    return self._booked_balance(book_id, account)
                number, currency = piece.split(" ")
                totals[currency] = totals.get(currency, Decimal(0)) + Decimal(number)
        return [models.Amount(number=engine.decimal_text(n), currency=c) for c, n in sorted(totals.items())]

    def _booked_balance(self, book_id: str, account: str) -> list[models.Amount]:
        pattern = f"^{account}(:|$)"  # account names are letters, digits, dashes and colons
        _, rows = self.query(book_id, f"SELECT sum(units(position)) AS total WHERE account ~ '{pattern}'")
        positions = rows[0][0] if rows and rows[0][0] else []
        return [models.Amount(number=n, currency=c) for n, c in (p.split(" ")[:2] for p in positions)]

    def account_ledger(
        self, book_id: str, account: str, *, cursor: str | None = None, limit: int = 200
    ) -> models.LedgerPage:
        """One account's ledger: its transactions newest first, with running balances.

        Pages are keyset pages: `cursor` names the last row of the previous page (its date and
        ordinal), so pages stay stable as transactions are added. Running balances accumulate
        from the oldest transaction, pending ones included; after an amount only booking could
        work out, they're unknown (None).
        """
        rows = []
        totals: dict[str, Decimal] | None = {}
        for entry in self.store.account_entries(book_id, account):
            pieces = entry["amounts"].split(";")
            amount = None
            net: dict[str, Decimal] | None = None
            if "?" not in pieces:
                net = {}
                for number, currency in (piece.split(" ") for piece in pieces):
                    net[currency] = net.get(currency, Decimal(0)) + Decimal(number)
                net = {c: n for c, n in net.items() if n != 0} or net  # a transfer within the subtree nets to 0
                if len(net) == 1:
                    [(currency, number)] = net.items()
                    amount = (number, currency)
            if totals is not None and net is not None:
                for currency, number in net.items():
                    totals[currency] = totals.get(currency, Decimal(0)) + number
            else:
                totals = None
            others = entry["others"].split(",") if entry["others"] else []
            rows.append(
                (
                    (entry["date"], entry["ordinal"]),
                    models.LedgerRow(
                        id=entry["id"],
                        date=datetime.date.fromisoformat(entry["date"]),
                        flag=entry["flag"],
                        payee=entry["payee"],
                        narration=entry["narration"],
                        amount=_amount(amount),
                        balance=_amount((totals[amount[1]], amount[1])) if totals is not None and amount else None,
                        amounts=[_amount((n, c)) for c, n in sorted((net or {}).items())],
                        balances=[_amount((n, c)) for c, n in sorted((totals or {}).items()) if n != 0],
                        counterpart=others[0] if entry["splits"] == 2 and len(others) == 1 else None,
                        splits=entry["splits"],
                        updated_at=entry["updated_at"],
                    ),
                )
            )
        rows.reverse()
        if cursor:
            date, _, ordinal = cursor.partition("~")
            rows = [r for r in rows if r[0] < (date, int(ordinal))]
        page = rows[:limit]
        more = len(rows) > limit
        return models.LedgerPage(
            rows=[r[1] for r in page],
            next_cursor=f"{page[-1][0][0]}~{page[-1][0][1]}" if more and page else None,
        )

    def create_transactions(self, book_id: str, batch: list[models.TransactionIn]) -> list[engine.Directive]:
        """Create many transactions in one atomic write: all of them, or none."""
        self._header(book_id)
        kinds = self._kinds(book_id)
        directives = [self._postable(book_id, engine.transaction_directive(t), kinds) for t in batch]
        with self.store.transaction():
            self._write(book_id, directives)
        return directives

    def apply_changes(self, book_id: str, changes: models.TransactionChanges) -> list[engine.Directive]:
        """Create and delete transactions in one atomic write: all of it, or none. A deletion
        whose version has moved on refuses the whole write (StaleVersion)."""
        self._header(book_id)
        kinds = self._kinds(book_id)
        created = [self._postable(book_id, engine.transaction_directive(t), kinds) for t in changes.create]
        with self.store.transaction():
            for d in changes.delete:
                row = self.store.get(book_id, d.id)
                if row is None or row.deleted or row.kind != "transaction":
                    raise NotFound(d.id)
                self.store.check_version(book_id, d.id, d.updated_at)
            self._write(book_id, created)
            self.store.delete(book_id, [d.id for d in changes.delete])
        return created

    def _default_open(self, book_id: str, parent: models.Account, tree: dict[str, models.Account]) -> datetime.date:
        """Early enough for the account to take any of the book's transactions."""
        if parent.open:
            return parent.open
        under = [x.open for x in tree.values() if x.open and x.name.startswith(parent.name + ":")]
        if under:
            return min(under)
        first = self.store.find(book_id, limit=1)
        return datetime.date.fromisoformat(first[0].date) if first else datetime.date.today()

    def _insert(self, book_id: str, directive: engine.Directive) -> engine.Directive:
        self._header(book_id)
        with self.store.transaction():
            if self.store.get(book_id, directive.id) is not None:
                raise ValueError(f"directive {directive.id} already exists")
            self._write(book_id, [directive])
        return directive

    def _put(self, book_id: str, directive: engine.Directive, expected: str | None = None) -> engine.Directive:
        with self.store.transaction():
            if expected is not None:
                self.store.check_version(book_id, directive.id, expected)
            self._write(book_id, [directive])
        return directive

    def _write(self, book_id: str, directives: list[engine.Directive]) -> None:
        """Put directives, then make sure every account they post to opens by its first posting.

        An account's open date is incidental here: it's whenever its history starts. So a posting
        dated before it (an opening balance moved back, or an old import categorized into a new
        account) moves the open back to meet it, rather than leaving the book invalid.
        """
        self.store.put(book_id, directives)
        accounts = {p.account for d in directives for p in d.postings}
        if not accounts:
            return
        earliest = {
            account: datetime.date.fromisoformat(date)
            for account, date in self.store.first_postings(book_id, accounts).items()
        }
        opens = [r.text for r in self.store.find(book_id, kind="open", limit=None)]
        moved = engine.moved_opens(opens, earliest)
        if moved:
            self.store.put(book_id, moved)

    # The engine

    def load(self, book_id: str) -> engine.Loaded:
        """The booked, validated book, cached until the book next changes."""
        header = self._header(book_id)
        with self._load_lock:
            seq = self.store.book_seq(book_id)
            cached = self._loaded.get(book_id)
            if cached is not None and cached[0] == seq:
                return cached[1]
            loaded = engine.load(header, [r.text for r in self.store.live(book_id)])
            self._loaded[book_id] = (seq, loaded)
            return loaded

    def problems(self, book_id: str) -> list[engine.Problem]:
        return self.load(book_id).problems

    def query(self, book_id: str, bql: str) -> tuple[list[str], list[list]]:
        return engine.query(self.load(book_id), bql)


def _amount(value: tuple[Decimal, str] | None) -> models.Amount | None:
    return None if value is None else models.Amount(number=engine.decimal_text(value[0]), currency=value[1])

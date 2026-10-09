"""The ledger service's operations: books, writes, the engine, import/export and backups.

Import and restore are the same operation: apply Beancount text containing directives (upserted
by `id` metadata) and tombstones (deleted by ID). A backup chunk is just such text, so restoring
a backup means applying its chunks in cursor order.
"""

from __future__ import annotations

import datetime
import threading
from dataclasses import dataclass

from . import engine, models
from .store import Row, Store

DEFAULT_HEADER = ['option "operating_currency" "USD"']


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

    def books(self) -> list[str]:
        return self.store.books()

    def create_book(self, book_id: str, header: list[str] | None = None) -> None:
        if self.store.header(book_id) is not None:
            raise ValueError(f"book {book_id} already exists")
        with self.store.transaction():
            self.store.put_book(book_id, header or DEFAULT_HEADER)

    def _header(self, book_id: str) -> list[str]:
        header = self.store.header(book_id)
        if header is None:
            raise NotFound(book_id)
        return header

    # Import, export, restore

    def apply_text(self, book_id: str, text: str) -> Applied:
        return self._apply(book_id, engine.parse_text(text))

    def apply_file(self, book_id: str, path: str) -> Applied:
        return self._apply(book_id, engine.parse_file(path))

    def _apply(self, book_id: str, parsed: engine.Parsed) -> Applied:
        """Apply parsed input atomically, creating the book if needed. Header lines are merged."""
        with self.store.transaction():
            current = self.store.header(book_id)
            merged = list(dict.fromkeys((current or []) + parsed.header)) or DEFAULT_HEADER
            if merged != current:
                self.store.put_book(book_id, merged)
            self.store.put(book_id, parsed.directives)
            deleted = self.store.delete(book_id, parsed.tombstones)
        return Applied(put=len(parsed.directives), deleted=len(deleted))

    def export(self, book_id: str) -> str:
        """The whole book as a self-contained Beancount ledger."""
        return engine.render(self._header(book_id), [r.text for r in self.store.live(book_id)])

    # Backups

    def backup(self, since: int = 0) -> Backup:
        """Everything changed after cursor `since`, as one Beancount chunk per changed book.

        Directives come out in ordinal order, so applying chunks in order reproduces the same
        within-day ordering: existing directives keep their ordinal, and new ones append, just as
        they did when they were created. Taken in one read transaction so the cursor and chunks
        agree.
        """
        with self.store.transaction():
            cursor = self.store.cursor()
            chunks = {}
            for book_id in self.store.books():
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

    def _postable(self, book_id: str, directive: engine.Directive) -> engine.Directive:
        """Refuse writes that post to node accounts. (Imports aren't refused; validation flags them.)"""
        if directive.postings:
            kinds = {a.name: a.kind for a in self.accounts(book_id)}
            nodes = sorted({p.account for p in directive.postings if kinds.get(p.account) == "node"})
            if nodes:
                raise engine.ParseFailure([engine.node_posting_message(name) for name in nodes])
        return directive

    def accounts(self, book_id: str) -> list[models.Account]:
        header = self._header(book_id)
        rows = [r for kind in ("open", "close") for r in self.store.find(book_id, kind=kind, limit=None)]
        return engine.accounts(header, [r.text for r in rows])

    def create_account(self, book_id: str, a: models.AccountIn) -> models.Account:
        """Open an account by its fully qualified name. Its root sets the type.

        Top-level accounts are built in, so a new account is always below one. Its nearest existing
        ancestor must be a node: leaves hold transactions, not sub-accounts. Levels in between that
        don't exist at all are opened as nodes along the way, in the same write. A name that's only
        implicit so far can be opened explicitly, but only as a node, since it already has
        accounts under it.
        """
        tree = {x.name: x for x in self.accounts(book_id)}
        roots = engine.root_types(self._header(book_id))
        segments = a.name.split(":")
        existing = tree.get(a.name)
        if segments[0] not in roots:
            raise engine.ParseFailure([f"account names start with one of {', '.join(roots)}"])
        if len(segments) == 1:
            raise engine.ParseFailure(["top-level accounts are built in; name an account under one"])
        if existing and not existing.implicit:
            raise ValueError(f"{a.name} already exists")
        if existing and a.kind == "leaf":
            raise engine.ParseFailure([f"{a.name} already has sub-accounts, so it can only be a node"])
        ancestor = next(
            tree[name] for i in range(len(segments) - 1, 0, -1) if (name := ":".join(segments[:i])) in tree
        )
        if ancestor.kind != "node":
            raise engine.ParseFailure([f"{ancestor.name} is a leaf account and can't have sub-accounts"])
        if ancestor.close:
            raise engine.ParseFailure([f"{ancestor.name} is closed"])

        opened = a.open or self._default_open(book_id, ancestor, tree)
        depth = ancestor.name.count(":") + 1
        en_route = [":".join(segments[:i]) for i in range(depth + 1, len(segments))]
        directives = [engine.open_directive(name, opened, "node") for name in en_route]
        directives.append(engine.open_directive(a.name, opened, a.kind))
        with self.store.transaction():
            self.store.put(book_id, directives)
        return next(x for x in self.accounts(book_id) if x.name == a.name)

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
            self.store.put(book_id, [directive])
        return directive

    def _put(self, book_id: str, directive: engine.Directive, expected: str | None = None) -> engine.Directive:
        with self.store.transaction():
            if expected is not None:
                self.store.check_version(book_id, directive.id, expected)
            self.store.put(book_id, [directive])
        return directive

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

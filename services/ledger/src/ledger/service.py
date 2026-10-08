"""The ledger service's operations: books, writes, the engine, import/export and backups.

Import and restore are the same operation: apply Beancount text containing directives (upserted
by `id` metadata) and tombstones (deleted by ID). A backup chunk is just such text, so restoring
a backup means applying its chunks in cursor order.
"""

from __future__ import annotations

import datetime
import os
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
    def __init__(self, store: Store, export_dir: str | None = None):
        self.store = store
        self.export_dir = export_dir
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

    def write_export(self, book_id: str) -> str:
        """Write the book's export where Fava reads it. Writes a temp file then renames it, so Fava
        never sees a half-written ledger."""
        assert self.export_dir, "no export directory configured"
        path = os.path.join(self.export_dir, f"{book_id}.beancount")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(self.export(book_id))
        os.replace(tmp, path)
        return path

    def write_changed_exports(self, written: dict[str, int]) -> list[str]:
        """Rewrite the export of every book that changed since it was last written.

        `written` maps book ID to the book's seq at its last export, and is updated in place.
        Called on a short interval, this batches a burst of writes into one export.
        """
        changed = []
        for book_id in self.store.books():
            seq = self.store.book_seq(book_id)
            if written.get(book_id) != seq:
                self.write_export(book_id)
                written[book_id] = seq
                changed.append(book_id)
        return changed

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
        return self._insert(book_id, engine.parse_one(text))

    def update(self, book_id: str, directive_id: str, text: str) -> engine.Directive:
        self.get(book_id, directive_id)
        return self._put(book_id, engine.parse_one(text, directive_id))

    def create_transaction(self, book_id: str, t: models.TransactionIn) -> engine.Directive:
        return self._insert(book_id, engine.transaction_directive(t))

    def update_transaction(self, book_id: str, directive_id: str, t: models.TransactionIn) -> engine.Directive:
        if self.get(book_id, directive_id).kind != "transaction":
            raise ValueError(f"directive {directive_id} is not a transaction")
        return self._put(book_id, engine.transaction_directive(t, directive_id))

    def transaction(self, book_id: str, directive_id: str) -> models.Transaction:
        row = self.get(book_id, directive_id)
        found = engine.transactions([row.text])
        if not found:
            raise NotFound(directive_id)
        return found[0]

    def transactions(self, book_id: str, **filters) -> list[models.Transaction]:
        """Transactions matching `Store.find` filters, structured, in ledger order."""
        self._header(book_id)
        return engine.transactions([r.text for r in self.store.find(book_id, kind="transaction", **filters)])

    def accounts(self, book_id: str) -> list[models.Account]:
        self._header(book_id)
        rows = [r for kind in ("open", "close") for r in self.store.find(book_id, kind=kind, limit=None)]
        return engine.accounts([r.text for r in rows])

    def _insert(self, book_id: str, directive: engine.Directive) -> engine.Directive:
        self._header(book_id)
        with self.store.transaction():
            if self.store.get(book_id, directive.id) is not None:
                raise ValueError(f"directive {directive.id} already exists")
            self.store.put(book_id, [directive])
        return directive

    def _put(self, book_id: str, directive: engine.Directive) -> engine.Directive:
        with self.store.transaction():
            self.store.put(book_id, [directive])
        return directive

    def set_flag(self, book_id: str, directive_id: str, flag: str) -> engine.Directive:
        """Confirm (`*`) or re-stage (`!`) a transaction."""
        return self._put(book_id, engine.with_flag(self.get(book_id, directive_id).text, flag))

    def delete(self, book_id: str, directive_id: str) -> None:
        self.get(book_id, directive_id)
        with self.store.transaction():
            self.store.delete(book_id, [directive_id])

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

"""The ledger database: the system of record for every book.

A directive row holds the directive's canonical Beancount text, which is the source of truth,
plus columns derived from that text for SQL reads. Deleted directives stay behind as tombstone
rows so incremental backups can carry deletions.

Every change appends to `change`, whose autoincrementing `seq` is the global, monotonic cursor
for backups.

Every row has `created_at` and `updated_at` (see `migrations`). A directive's `updated_at` is also
its version: edits name the version they read, and a write against any other version is refused
(`StaleVersion`), so two clients can't silently overwrite each other.
"""

from __future__ import annotations

import datetime
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from .engine import Directive
from .migrations import after, migrate, now

class StaleVersion(Exception):
    """A write named a version that's no longer current."""

    def __init__(self, directive_id: str, current: str):
        super().__init__(f"{directive_id} has changed since it was read (now at {current})")
        self.directive_id = directive_id
        self.current = current


@dataclass(frozen=True)
class Row:
    id: str
    date: str
    kind: str
    flag: str | None
    ordinal: int
    text: str | None
    deleted: bool
    seq: int
    created_at: str
    updated_at: str


class Store:
    """One SQLite connection per thread: the API serves requests on a thread pool, and a sqlite3
    connection must not run statements from several threads at once. WAL lets readers proceed
    while a write is in progress; the lock serializes this process's writers, and the busy
    timeout covers anything else holding the write lock."""

    def __init__(self, path: str):
        self._path = path
        self._local = threading.local()
        self._lock = threading.RLock()
        with self._lock:
            migrate(self._conn)

    @property
    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._path, isolation_level=None)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA busy_timeout = 10000")
            self._local.conn = conn
        return conn

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """One atomic write. Also serializes writers, since this service is the only one."""
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")

    # Books

    def books(self) -> list[str]:
        return [r["id"] for r in self._conn.execute("SELECT id FROM book ORDER BY id")]

    def header(self, book_id: str) -> list[str] | None:
        row = self._conn.execute("SELECT header FROM book WHERE id = ?", (book_id,)).fetchone()
        return None if row is None else [line for line in row["header"].split("\n") if line]

    def put_book(self, book_id: str, header: list[str]) -> None:
        seq = self._change(book_id, None, "book")
        previous = self._conn.execute("SELECT updated_at FROM book WHERE id = ?", (book_id,)).fetchone()
        stamp = after(previous["updated_at"] if previous else None)
        self._conn.execute(
            "INSERT INTO book (id, header, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT (id) DO UPDATE SET header = excluded.header, seq = excluded.seq,"
            " updated_at = excluded.updated_at",
            (book_id, "\n".join(header), seq, stamp, stamp),
        )

    def book_seq(self, book_id: str) -> int:
        """The latest change to anything in the book. Equal values mean an unchanged book."""
        row = self._conn.execute(
            "SELECT MAX(seq) AS seq FROM change WHERE book_id = ?", (book_id,)
        ).fetchone()
        return row["seq"] or 0

    def cursor(self) -> int:
        return self._conn.execute("SELECT COALESCE(MAX(seq), 0) FROM change").fetchone()[0]

    # Directives

    def put(self, book_id: str, directives: list[Directive]) -> None:
        """Insert or replace directives. A replaced directive keeps its ordinal; new ones append."""
        next_ordinal = self._conn.execute(
            "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM directive WHERE book_id = ?", (book_id,)
        ).fetchone()[0]
        for d in directives:
            existing = self._conn.execute(
                "SELECT book_id, ordinal, updated_at FROM directive WHERE id = ?", (d.id,)
            ).fetchone()
            if existing is not None and existing["book_id"] != book_id:
                raise KeyError(f"directive {d.id} belongs to book {existing['book_id']}")
            if existing is None:
                ordinal, next_ordinal = next_ordinal, next_ordinal + 1
            else:
                ordinal = existing["ordinal"]
            seq = self._change(book_id, d.id, "put")
            stamp = after(existing["updated_at"] if existing else None)
            self._conn.execute(
                "INSERT INTO directive"
                " (id, book_id, date, kind, flag, ordinal, text, deleted, seq, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
                " ON CONFLICT (id) DO UPDATE SET date = excluded.date, kind = excluded.kind,"
                " flag = excluded.flag, text = excluded.text, deleted = 0, seq = excluded.seq,"
                " updated_at = excluded.updated_at",
                (d.id, book_id, d.date.isoformat(), d.kind, d.flag, ordinal, d.text, seq, stamp, stamp),
            )
            self._conn.execute("DELETE FROM posting WHERE directive_id = ?", (d.id,))
            self._conn.executemany(
                "INSERT INTO posting (directive_id, idx, account, number, currency, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (d.id, i, p.account, None if p.number is None else str(p.number), p.currency, stamp, stamp)
                    for i, p in enumerate(d.postings)
                ],
            )

    def delete(self, book_id: str, directive_ids: list[str]) -> list[str]:
        """Tombstone directives. Returns the IDs that were live in this book."""
        deleted = []
        for directive_id in directive_ids:
            row = self._conn.execute(
                "SELECT updated_at FROM directive WHERE id = ? AND book_id = ? AND deleted = 0",
                (directive_id, book_id),
            ).fetchone()
            if row is None:
                continue
            seq = self._change(book_id, directive_id, "delete")
            self._conn.execute(
                "UPDATE directive SET text = NULL, deleted = 1, seq = ?, updated_at = ? WHERE id = ?",
                (seq, after(row["updated_at"]), directive_id),
            )
            self._conn.execute("DELETE FROM posting WHERE directive_id = ?", (directive_id,))
            deleted.append(directive_id)
        return deleted

    def check_version(self, book_id: str, directive_id: str, expected: str) -> None:
        """Refuse a write that read an older version. Call inside the write's transaction."""
        row = self.get(book_id, directive_id)
        if row is not None and row.updated_at != expected:
            raise StaleVersion(directive_id, row.updated_at)

    def get(self, book_id: str, directive_id: str) -> Row | None:
        row = self._conn.execute(
            "SELECT * FROM directive WHERE id = ? AND book_id = ?", (directive_id, book_id)
        ).fetchone()
        return None if row is None else _row(row)

    def live(self, book_id: str) -> list[Row]:
        """Every live directive in ledger order."""
        rows = self._conn.execute(
            "SELECT * FROM directive WHERE book_id = ? AND deleted = 0 ORDER BY date, ordinal",
            (book_id,),
        )
        return [_row(r) for r in rows]

    def changed_since(self, book_id: str, seq: int) -> list[Row]:
        """Directives changed after `seq`, live or deleted, in ordinal order (see backup)."""
        rows = self._conn.execute(
            "SELECT * FROM directive WHERE book_id = ? AND seq > ? ORDER BY ordinal",
            (book_id, seq),
        )
        return [_row(r) for r in rows]

    def book_changed_since(self, book_id: str, seq: int) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM change WHERE book_id = ? AND seq > ? LIMIT 1", (book_id, seq)
        ).fetchone()
        return row is not None

    def find(
        self,
        book_id: str,
        *,
        kind: str | None = None,
        account: str | None = None,
        flag: str | None = None,
        date_from: datetime.date | None = None,
        date_to: datetime.date | None = None,
        limit: int | None = 500,
    ) -> list[Row]:
        """The app's read path: plain SQL over the derived columns, no Beancount involved."""
        sql = ["SELECT DISTINCT d.* FROM directive d"]
        where, args = ["d.book_id = ?", "d.deleted = 0"], [book_id]
        if account is not None:
            sql.append("JOIN posting p ON p.directive_id = d.id")
            where.append("(p.account = ? OR p.account LIKE ?)")
            args += [account, account + ":%"]
        if kind is not None:
            where.append("d.kind = ?")
            args.append(kind)
        if flag is not None:
            where.append("d.flag = ?")
            args.append(flag)
        if date_from is not None:
            where.append("d.date >= ?")
            args.append(date_from.isoformat())
        if date_to is not None:
            where.append("d.date <= ?")
            args.append(date_to.isoformat())
        sql.append("WHERE " + " AND ".join(where) + " ORDER BY d.date, d.ordinal LIMIT ?")
        args.append(-1 if limit is None else limit)
        return [_row(r) for r in self._conn.execute(" ".join(sql), args)]

    def _change(self, book_id: str, directive_id: str | None, op: str) -> int:
        stamp = now()
        cur = self._conn.execute(
            "INSERT INTO change (book_id, directive_id, op, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (book_id, directive_id, op, stamp, stamp),
        )
        return cur.lastrowid


def _row(r: sqlite3.Row) -> Row:
    return Row(
        id=r["id"],
        date=r["date"],
        kind=r["kind"],
        flag=r["flag"],
        ordinal=r["ordinal"],
        text=r["text"],
        deleted=bool(r["deleted"]),
        seq=r["seq"],
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )

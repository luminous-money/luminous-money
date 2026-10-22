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
import hashlib
import json
import os
import sqlite3
import threading
import uuid
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
        # Attachments' bytes (M16), beside the database on the data volume.
        self._files = os.path.join(os.path.dirname(os.path.abspath(path)), "attachments")
        self._local = threading.local()
        self._lock = threading.RLock()
        with self._lock:
            migrate(self._conn)

    def schema_version(self) -> int:
        """The database's schema (its migrations applied): a read, so it also says it's readable."""
        return self._conn.execute("PRAGMA user_version").fetchone()[0]

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

    def books(self, owner_id: str | None = None, *, deleted: bool = False) -> list[str]:
        """Every book's ID, or just those `owner_id` owns; deleted ones too with `deleted`."""
        live = "" if deleted else " AND deleted = 0"
        if owner_id is None:
            return [r["id"] for r in self._conn.execute(f"SELECT id FROM book WHERE 1{live} ORDER BY id")]
        rows = self._conn.execute(
            f"SELECT id FROM book WHERE owner_id = ?{live} ORDER BY created_at, id", (owner_id,)
        )
        return [r["id"] for r in rows]

    def books_for(self, user_id: str) -> list[str]:
        """The live books `user_id` owns or is a member of, oldest first."""
        rows = self._conn.execute(
            "SELECT id FROM book WHERE deleted = 0 AND (owner_id = ?"
            " OR id IN (SELECT book_id FROM book_member WHERE user_id = ?)) ORDER BY created_at, id",
            (user_id, user_id),
        )
        return [r["id"] for r in rows]

    # Members (M13)

    def member(self, book_id: str, user_id: str) -> sqlite3.Row | None:
        """A member's row: user_id, role, updated_at."""
        return self._conn.execute(
            "SELECT user_id, role, updated_at FROM book_member WHERE book_id = ? AND user_id = ?",
            (book_id, user_id),
        ).fetchone()

    def members(self, book_id: str) -> list[sqlite3.Row]:
        """The book's members (not its owner), in the order they joined."""
        return self._conn.execute(
            "SELECT user_id, role, updated_at FROM book_member WHERE book_id = ? ORDER BY created_at, user_id",
            (book_id,),
        ).fetchall()

    def put_member(self, book_id: str, user_id: str, role: str, expected: str | None = None) -> None:
        """Add a member, or change their role against the version read (`expected`)."""
        current = self.member(book_id, user_id)
        if current is not None and expected is not None and current["updated_at"] != expected:
            raise StaleVersion(f"{book_id}/{user_id}", current["updated_at"])
        stamp = after(current["updated_at"] if current else None)
        self._conn.execute(
            "INSERT INTO book_member (book_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT (book_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at",
            (book_id, user_id, role, stamp, stamp),
        )

    def remove_member(self, book_id: str, user_id: str) -> bool:
        return self._conn.execute(
            "DELETE FROM book_member WHERE book_id = ? AND user_id = ?", (book_id, user_id)
        ).rowcount > 0

    def book(self, book_id: str) -> sqlite3.Row | None:
        """The book's row: id, header, owner_id, deleted, created_at, updated_at. Deleted books
        have one too: check `deleted`."""
        return self._conn.execute("SELECT * FROM book WHERE id = ?", (book_id,)).fetchone()

    def delete_book(self, book_id: str) -> None:
        """Tombstone every directive in the book, then mark the book deleted."""
        live = [r["id"] for r in self._conn.execute(
            "SELECT id FROM directive WHERE book_id = ? AND deleted = 0", (book_id,)
        )]
        self.delete(book_id, live)
        seq = self._change(book_id, None, "delete-book")
        row = self.book(book_id)
        self._conn.execute(
            "UPDATE book SET deleted = 1, seq = ?, updated_at = ? WHERE id = ?",
            (seq, after(row["updated_at"]), book_id),
        )

    def books_deleted_since(self, seq: int, books: list[str]) -> list[str]:
        """Of `books`, those deleted after cursor `seq`."""
        rows = self._conn.execute(
            "SELECT DISTINCT book_id FROM change WHERE op = 'delete-book' AND seq > ?", (seq,)
        )
        return sorted({r["book_id"] for r in rows} & set(books))

    def header(self, book_id: str) -> list[str] | None:
        row = self._conn.execute("SELECT header FROM book WHERE id = ?", (book_id,)).fetchone()
        return None if row is None else [line for line in row["header"].split("\n") if line]

    def put_book(self, book_id: str, header: list[str], owner_id: str | None = None) -> None:
        """Create or update a book. The owner is set when the book is created and never changes here."""
        seq = self._change(book_id, None, "book")
        previous = self._conn.execute("SELECT updated_at FROM book WHERE id = ?", (book_id,)).fetchone()
        stamp = after(previous["updated_at"] if previous else None)
        self._conn.execute(
            "INSERT INTO book (id, header, seq, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
            " ON CONFLICT (id) DO UPDATE SET header = excluded.header, seq = excluded.seq,"
            " updated_at = excluded.updated_at",
            (book_id, "\n".join(header), seq, owner_id, stamp, stamp),
        )

    def check_book_version(self, book_id: str, expected: str) -> None:
        row = self.book(book_id)
        if row is not None and row["updated_at"] != expected:
            raise StaleVersion(book_id, row["updated_at"])

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
                " (id, book_id, date, kind, flag, ordinal, text, deleted, seq, payee, narration, budgeted,"
                " created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (id) DO UPDATE SET date = excluded.date, kind = excluded.kind,"
                " flag = excluded.flag, text = excluded.text, deleted = 0, seq = excluded.seq,"
                " payee = excluded.payee, narration = excluded.narration, budgeted = excluded.budgeted,"
                " updated_at = excluded.updated_at",
                (
                    d.id,
                    book_id,
                    d.date.isoformat(),
                    d.kind,
                    d.flag,
                    ordinal,
                    d.text,
                    seq,
                    d.payee,
                    d.narration,
                    int(d.budgeted),
                    stamp,
                    stamp,
                ),
            )
            self._conn.execute("DELETE FROM posting WHERE directive_id = ?", (d.id,))
            self._conn.executemany(
                "INSERT INTO posting"
                " (directive_id, idx, account, number, currency, amount, amount_currency, reconciled,"
                " flag, memo, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        d.id,
                        i,
                        p.account,
                        None if p.number is None else str(p.number),
                        p.currency,
                        None if p.amount is None else str(p.amount),
                        p.amount_currency,
                        p.reconciled.isoformat() if p.reconciled else None,
                        p.flag,
                        p.memo,
                        stamp,
                        stamp,
                    )
                    for i, p in enumerate(d.postings)
                ],
            )
            self._conn.execute("DELETE FROM price WHERE directive_id = ?", (d.id,))
            if d.price is not None:
                commodity, number, currency = d.price
                self._conn.execute(
                    "INSERT INTO price (directive_id, book_id, date, commodity, number, currency, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (d.id, book_id, d.date.isoformat(), commodity, str(number), currency, stamp, stamp),
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
            self._conn.execute("DELETE FROM price WHERE directive_id = ?", (directive_id,))
            for attachment in self.attachments_of(book_id, [directive_id]):
                self.delete_attachment(book_id, attachment["id"])
            deleted.append(directive_id)
        return deleted

    # Attachments (M16)

    def _file(self, book_id: str, attachment_id: str) -> str:
        return os.path.join(self._files, book_id, attachment_id)

    def add_attachment(self, book_id: str, directive_id: str, filename: str, content_type: str, data: bytes) -> sqlite3.Row:
        """Keep a file for a transaction: its bytes on the volume, what's known of it here."""
        attachment_id = uuid.uuid4().hex
        path = self._file(book_id, attachment_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        stamp = now()
        self._conn.execute(
            "INSERT INTO attachment (id, book_id, directive_id, filename, content_type, size, sha256, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (attachment_id, book_id, directive_id, filename, content_type, len(data), hashlib.sha256(data).hexdigest(), stamp, stamp),
        )
        return self.attachment(book_id, attachment_id)

    def attachment(self, book_id: str, attachment_id: str) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM attachment WHERE book_id = ? AND id = ?", (book_id, attachment_id)
        ).fetchone()

    def attachment_bytes(self, book_id: str, attachment_id: str) -> bytes:
        with open(self._file(book_id, attachment_id), "rb") as f:
            return f.read()

    def attachments_of(self, book_id: str, directive_ids: list[str]) -> list[sqlite3.Row]:
        """These transactions' attachments, oldest first."""
        marks = ",".join("?" * len(directive_ids))
        return self._conn.execute(
            f"SELECT * FROM attachment WHERE book_id = ? AND directive_id IN ({marks}) ORDER BY created_at, id",
            (book_id, *directive_ids),
        ).fetchall() if directive_ids else []

    def delete_attachment(self, book_id: str, attachment_id: str) -> bool:
        gone = self._conn.execute(
            "DELETE FROM attachment WHERE book_id = ? AND id = ?", (book_id, attachment_id)
        ).rowcount > 0
        try:
            os.remove(self._file(book_id, attachment_id))
        except FileNotFoundError:
            pass
        return gone

    def check_version(self, book_id: str, directive_id: str, expected: str) -> None:
        """Refuse a write that read an older version. Call inside the write's transaction."""
        row = self.get(book_id, directive_id)
        if row is not None and row.updated_at != expected:
            raise StaleVersion(directive_id, row.updated_at)

    def book_of(self, directive_id: str) -> str | None:
        row = self._conn.execute("SELECT book_id FROM directive WHERE id = ?", (directive_id,)).fetchone()
        return row["book_id"] if row else None

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

    def account_entries(self, book_id: str, account: str) -> list[sqlite3.Row]:
        """Every live transaction posting to `account` or an account under it, oldest first: what
        its ledger and balance are made of. Each row has the transaction's id, date, ordinal,
        flag, payee, narration, updated_at, its number of splits, the accounts outside the subtree
        it posts to (comma-separated), the subtree's amounts in it (`amounts`, as "number
        currency" pairs, with "?" for an amount only booking could say), and how many of the
        subtree's postings in it aren't reconciled (`unreconciled`) and the latest mark of those
        that are (`reconciled`), and each of those postings' account and amount (`parts`: "account
        number currency", or "account ?"). For a leaf, the subtree is just the account."""
        mine = "(%s.account = :account OR %s.account LIKE :under)"
        return self._conn.execute(
            f"""
            SELECT d.id, d.date, d.ordinal, d.flag, d.payee, d.narration, d.updated_at,
                   (SELECT COUNT(*) FROM posting n WHERE n.directive_id = d.id) AS splits,
                   (SELECT GROUP_CONCAT(DISTINCT o.account) FROM posting o
                     WHERE o.directive_id = d.id AND NOT {mine % ("o", "o")}) AS others,
                   (SELECT GROUP_CONCAT(COALESCE(a.amount || ' ' || a.amount_currency, '?'), ';') FROM posting a
                     WHERE a.directive_id = d.id AND {mine % ("a", "a")}) AS amounts,
                   (SELECT GROUP_CONCAT(a.account || ' ' || COALESCE(a.amount || ' ' || a.amount_currency, '?'), ';')
                     FROM posting a WHERE a.directive_id = d.id AND {mine % ("a", "a")}) AS parts,
                   (SELECT COUNT(*) FROM posting r WHERE r.directive_id = d.id AND {mine % ("r", "r")}
                     AND r.reconciled IS NULL) AS unreconciled,
                   (SELECT MAX(r.reconciled) FROM posting r WHERE r.directive_id = d.id
                     AND {mine % ("r", "r")}) AS reconciled
            FROM directive d
            WHERE d.book_id = :book AND d.deleted = 0 AND d.kind = 'transaction'
              AND d.id IN (SELECT directive_id FROM posting p WHERE {mine % ("p", "p")})
            ORDER BY d.date, d.ordinal
            """,
            {"book": book_id, "account": account, "under": f"{account}:%"},
        ).fetchall()

    def first_postings(self, book_id: str, accounts: set[str]) -> dict[str, str]:
        """For each of `accounts`, the date of its first live posting."""
        rows = self._conn.execute(
            """
            SELECT p.account, MIN(d.date) FROM directive d JOIN posting p ON p.directive_id = d.id
            WHERE d.book_id = ? AND d.deleted = 0 AND p.account IN (SELECT value FROM json_each(?))
            GROUP BY p.account
            """,
            (book_id, json.dumps(sorted(accounts))),
        ).fetchall()
        return {account: date for account, date in rows}

    def compact(self, book_id: str, date_from: str) -> list[sqlite3.Row]:
        """Every live transaction dated `date_from` or later, oldest first, one row per posting:
        the directive's id, date, flag, payee, narration and `budgeted`, and the posting's account,
        amount (NULL where only booking could say), mark, flag and memo. For resolvers' context and
        reports: plain SQL, no parsing."""
        return self._conn.execute(
            """
            SELECT d.id, d.date, d.flag, d.payee, d.narration, d.budgeted, p.idx, p.account, p.amount,
                   p.amount_currency, p.reconciled, p.flag AS posting_flag, p.memo
            FROM directive d JOIN posting p ON p.directive_id = d.id
            WHERE d.book_id = ? AND d.deleted = 0 AND d.kind = 'transaction' AND d.date >= ?
            ORDER BY d.date, d.ordinal, p.idx
            """,
            (book_id, date_from),
        ).fetchall()

    def latest_prices(self, book_id: str, on: str) -> list[sqlite3.Row]:
        """For each commodity and quote currency, its latest price dated `on` or earlier: commodity,
        currency, date, number. The last written wins a tie on date."""
        return self._conn.execute(
            """
            SELECT commodity, currency, date, number FROM (
                SELECT commodity, currency, date, number,
                       ROW_NUMBER() OVER (PARTITION BY commodity, currency ORDER BY date DESC, rowid DESC) AS n
                FROM price WHERE book_id = ? AND date <= ?
            ) WHERE n = 1
            """,
            (book_id, on),
        ).fetchall()

    def price_history(self, book_id: str, commodity: str, limit: int = 400) -> list[sqlite3.Row]:
        """A commodity's prices, newest first: directive_id, date, number, currency."""
        return self._conn.execute(
            "SELECT directive_id, date, number, currency FROM price WHERE book_id = ? AND commodity = ?"
            " ORDER BY date DESC, rowid DESC LIMIT ?",
            (book_id, commodity, limit),
        ).fetchall()

    def account_amounts(self, book_id: str) -> list[sqlite3.Row]:
        """Every live transaction posting's account, currency and change (`amount`, None where
        only booking could say), for rolling balances up the tree in one read."""
        return self._conn.execute(
            """
            SELECT p.account, p.amount_currency AS currency, p.amount FROM posting p
            JOIN directive d ON d.id = p.directive_id
            WHERE d.book_id = ? AND d.deleted = 0 AND d.kind = 'transaction'
            """,
            (book_id,),
        ).fetchall()

    def journal(
        self,
        book_id: str,
        *,
        older_than: tuple[str, int] | None = None,
        newer_than: tuple[str, int] | None = None,
        through: str | None = None,
        reconciled: tuple[bool, list[str]] | None = None,
        limit: int,
    ) -> list[sqlite3.Row]:
        """Live transactions, a keyset page: newest first, older than a row's key (date,
        ordinal) and dated `through` or earlier if given; or, `newer_than` a key, the closest
        newer ones first (oldest first). With `reconciled` (wanted, and the roots whose postings
        reconcile), only those whose postings under the roots are all reconciled, or those with
        one that isn't."""
        where, args = ["book_id = ?", "deleted = 0", "kind = 'transaction'"], [book_id]
        if reconciled is not None:
            wanted, roots = reconciled
            under = " OR ".join(["p.account LIKE ?"] * len(roots)) or "0"
            open_ = f"EXISTS (SELECT 1 FROM posting p WHERE p.directive_id = directive.id AND ({under}) AND p.reconciled IS NULL)"
            if wanted:
                any_ = f"EXISTS (SELECT 1 FROM posting p WHERE p.directive_id = directive.id AND ({under}))"
                where.append(f"{any_} AND NOT {open_}")
                args += [f"{r}:%" for r in roots] * 2
            else:
                where.append(open_)
                args += [f"{r}:%" for r in roots]
        for key, op in ((older_than, "<"), (newer_than, ">")):
            if key is not None:
                where.append(f"(date {op} ? OR (date = ? AND ordinal {op} ?))")
                args += [key[0], key[0], key[1]]
        if through is not None:
            where.append("date <= ?")
            args.append(through)
        order = "ASC" if newer_than is not None else "DESC"
        return self._conn.execute(
            "SELECT id, date, ordinal, flag, payee, narration, budgeted, updated_at FROM directive"
            f" WHERE {' AND '.join(where)} ORDER BY date {order}, ordinal {order} LIMIT ?",
            (*args, limit),
        ).fetchall()

    def postings_of(self, directive_ids: list[str]) -> list[sqlite3.Row]:
        """The postings of these directives, in order: directive_id, account, amount, currency,
        reconciled."""
        marks = ",".join("?" * len(directive_ids))
        return self._conn.execute(
            f"SELECT directive_id, account, amount, amount_currency, reconciled FROM posting"
            f" WHERE directive_id IN ({marks}) ORDER BY directive_id, idx",
            directive_ids,
        ).fetchall()

    def flow(self, book_id: str, account: str, date_from: str, date_to: str) -> list[sqlite3.Row]:
        """Every live transaction posting to `account` or under it dated in [from, to), but those
        kept out of budgets: its transaction's flag, and its currency and change (`amount`, None
        where only booking could say). Budgets (M11) sum them."""
        return self._conn.execute(
            """
            SELECT d.flag, p.amount_currency AS currency, p.amount FROM posting p
            JOIN directive d ON d.id = p.directive_id
            WHERE d.book_id = ? AND d.deleted = 0 AND d.kind = 'transaction' AND d.budgeted = 1
              AND d.date >= ? AND d.date < ? AND (p.account = ? OR p.account LIKE ?)
            """,
            (book_id, date_from, date_to, account, account + ":%"),
        ).fetchall()

    def scope_postings(self, book_id: str, account: str) -> list[sqlite3.Row]:
        """Every posting of every live transaction that posts to `account` or under it, oldest
        first (by transaction, then posting): the transaction's id, date, ordinal, flag, payee,
        narration and updated_at; the posting's idx, account, amount, currency and reconciled
        mark. What reconciling an account works from (M14)."""
        return self._conn.execute(
            """
            SELECT d.id, d.date, d.ordinal, d.flag, d.payee, d.narration, d.updated_at,
                   p.idx, p.account, p.amount, p.amount_currency, p.reconciled
            FROM directive d JOIN posting p ON p.directive_id = d.id
            WHERE d.book_id = :book AND d.deleted = 0 AND d.kind = 'transaction'
              AND d.id IN (SELECT directive_id FROM posting WHERE account = :account OR account LIKE :under)
            ORDER BY d.date, d.ordinal, p.idx
            """,
            {"book": book_id, "account": account, "under": f"{account}:%"},
        ).fetchall()

    def mentioning(self, book_id: str, account: str) -> list[Row]:
        """Live directives whose text names `account` or an account under it (a superset: the
        caller parses each to be sure)."""
        pattern = account.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = self._conn.execute(
            "SELECT * FROM directive WHERE book_id = ? AND deleted = 0 AND text LIKE ? ESCAPE '\\'"
            " ORDER BY date, ordinal",
            (book_id, f"%{pattern}%"),
        )
        return [_row(r) for r in rows]

    def last_posting(self, book_id: str, account: str) -> str | None:
        """The date of the latest live transaction posting to `account` or under it."""
        row = self._conn.execute(
            """
            SELECT MAX(d.date) FROM directive d JOIN posting p ON p.directive_id = d.id
            WHERE d.book_id = ? AND d.deleted = 0 AND (p.account = ? OR p.account LIKE ?)
            """,
            (book_id, account, account + ":%"),
        ).fetchone()
        return row[0]

    def opening_dates(self, book_id: str, equity: str) -> dict[str, str]:
        """For each account, the date of its first live transaction against `equity`: its opening
        balance."""
        return self.dates_with(book_id, equity)

    def dates_with(self, book_id: str, other: str, latest: bool = False) -> dict[str, str]:
        """For each account, the date of its first (or `latest`) live transaction that also posts
        to `other`."""
        which = "MAX" if latest else "MIN"
        rows = self._conn.execute(
            f"""
            SELECT p.account, {which}(d.date) FROM directive d JOIN posting p ON p.directive_id = d.id
            WHERE d.book_id = :book AND d.deleted = 0 AND d.kind = 'transaction' AND p.account <> :equity
              AND d.id IN (SELECT directive_id FROM posting WHERE account = :equity)
            GROUP BY p.account
            """,
            {"book": book_id, "equity": other},
        ).fetchall()
        return {account: date for account, date in rows}

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

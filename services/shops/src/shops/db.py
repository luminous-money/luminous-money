"""shops.sqlite: each book's Amazon connection, and the charges and orders read from Amazon.

Every table is created with `create_table`, which adds `created_at` and `updated_at`; a row's
`updated_at` is its version, and an edit naming another is refused (StaleVersion).
"""

import datetime
import json
import os
import sqlite3
import threading
from typing import Any

TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def create_table(name: str, columns: list[str], constraints: list[str] | None = None) -> str:
    """CREATE TABLE with the required timestamp columns. Table constraints (composite keys and
    the like) go in `constraints`, since SQL wants them after every column."""
    parts = [*columns, "created_at TEXT NOT NULL", "updated_at TEXT NOT NULL", *(constraints or [])]
    return f"CREATE TABLE {name} (\n    " + ",\n    ".join(parts) + "\n)"


def now() -> str:
    return datetime.datetime.now(datetime.UTC).strftime(TIMESTAMP_FORMAT)


def after(previous: str | None) -> str:
    """A timestamp strictly later than `previous` (a row's next version)."""
    stamp = now()
    if previous is not None and stamp <= previous:
        later = datetime.datetime.strptime(previous, TIMESTAMP_FORMAT) + datetime.timedelta(microseconds=1)
        stamp = later.strftime(TIMESTAMP_FORMAT)
    return stamp


MIGRATIONS: list[list[str]] = [
    [
        create_table(
            "amazon_connection",
            [
                "book_id TEXT PRIMARY KEY",
                "email TEXT NOT NULL DEFAULT ''",
                "password TEXT",  # sealed
                "otp_secret TEXT",  # sealed: the authenticator app's setup key
                "sync_from TEXT",  # ISO date: how far back a sync reads
                "other_payments TEXT NOT NULL DEFAULT 'Income:Uncategorized'",
                "rewards TEXT",  # null: as other_payments
                "status TEXT NOT NULL DEFAULT 'new'",  # new, ok, login, failed
                "status_detail TEXT",
                "last_sync_at TEXT",
            ],
        ),
        create_table(
            "amazon_charge",
            [
                "book_id TEXT NOT NULL",
                "id TEXT NOT NULL",
                "date TEXT NOT NULL",
                "amount TEXT NOT NULL",  # Amazon's sign: negative a charge, positive a refund
                "payment_method TEXT",
                "last4 TEXT",
                "order_number TEXT",
                "seller TEXT",
                "order_link TEXT",
            ],
            ["PRIMARY KEY (book_id, id)"],
        ),
        create_table(
            "amazon_order",
            [
                "book_id TEXT NOT NULL",
                "order_number TEXT NOT NULL",
                "placed TEXT",
                "data TEXT NOT NULL",  # JSON: its items, totals and payment
            ],
            ["PRIMARY KEY (book_id, order_number)"],
        ),
    ],
    # Which charges are the book's, by card (Kael, 2026-11-07): the cards included and excluded
    # (JSON lists of last fours), and every card Amazon's charges were seen on, to choose from.
    [
        "ALTER TABLE amazon_connection ADD COLUMN include_cards TEXT",
        "ALTER TABLE amazon_connection ADD COLUMN exclude_cards TEXT",
        create_table(
            "amazon_card",
            [
                "book_id TEXT NOT NULL",
                "last4 TEXT NOT NULL",
                "label TEXT",  # Amazon's, like "Visa ****1234"
                "charges INTEGER NOT NULL DEFAULT 0",  # in the last sync's window
                "last_seen TEXT",  # the latest charge's date
            ],
            ["PRIMARY KEY (book_id, last4)"],
        ),
    ],
    # How far back a sync has read (Kael, 2026-11-07): after the first, a sync reads back only
    # 15 days before the last. Null when a full read back to `sync_from` is owed (none yet, or
    # the date, the cards or the account changed).
    ["ALTER TABLE amazon_connection ADD COLUMN read_back_to TEXT"],
]


class StaleVersion(Exception):
    def __init__(self, current: str | None):
        super().__init__("it changed since it was read")
        self.current = current


class Db:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.lock = threading.Lock()
        self._migrate()

    def _migrate(self) -> None:
        with self.lock:
            version = self.conn.execute("PRAGMA user_version").fetchone()[0]
            for number, statements in enumerate(MIGRATIONS[version:], start=version + 1):
                self.conn.execute("BEGIN")
                for statement in statements:
                    self.conn.execute(statement)
                self.conn.execute(f"PRAGMA user_version = {number}")
                self.conn.execute("COMMIT")

    def schema(self) -> int:
        return self.conn.execute("PRAGMA user_version").fetchone()[0]

    # The connection

    def connection(self, book: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM amazon_connection WHERE book_id = ?", (book,)).fetchone()
        return dict(row) if row else None

    def set_connection(self, book: str, changes: dict[str, Any], expected: str | None) -> dict[str, Any]:
        """Create or change a book's connection, against the version read (None: not made yet)."""
        with self.lock:
            current = self.connection(book)
            if (current["updated_at"] if current else None) != expected:
                raise StaleVersion(current["updated_at"] if current else None)
            stamp = after(current["updated_at"] if current else None)
            if current is None:
                self.conn.execute(
                    "INSERT INTO amazon_connection (book_id, created_at, updated_at) VALUES (?, ?, ?)",
                    (book, stamp, stamp),
                )
            if changes:
                columns = ", ".join(f"{k} = ?" for k in changes)
                self.conn.execute(
                    f"UPDATE amazon_connection SET {columns}, updated_at = ? WHERE book_id = ?",
                    (*changes.values(), stamp, book),
                )
            else:
                self.conn.execute("UPDATE amazon_connection SET updated_at = ? WHERE book_id = ?", (stamp, book))
        return self.connection(book)  # type: ignore[return-value]

    def set_status(self, book: str, status: str, detail: str | None, synced: bool = False) -> None:
        """A sync's outcome. Not an edit of the settings, so it doesn't move their version."""
        with self.lock:
            self.conn.execute(
                "UPDATE amazon_connection SET status = ?, status_detail = ?"
                + (", last_sync_at = ?" if synced else "")
                + " WHERE book_id = ?",
                (status, detail, *([now()] if synced else []), book),
            )

    def set_read_back(self, book: str, date: str) -> None:
        """A sync read back to `date`. Not an edit, so it doesn't move the settings' version."""
        with self.lock:
            self.conn.execute("UPDATE amazon_connection SET read_back_to = ? WHERE book_id = ?", (date, book))

    def forget(self, book: str, expected: str) -> None:
        with self.lock:
            current = self.connection(book)
            if current is None or current["updated_at"] != expected:
                raise StaleVersion(current["updated_at"] if current else None)
            self.conn.execute("BEGIN")
            for table in ("amazon_connection", "amazon_charge", "amazon_order", "amazon_card"):
                self.conn.execute(f"DELETE FROM {table} WHERE book_id = ?", (book,))
            self.conn.execute("COMMIT")

    # What was read

    def put_charges(self, book: str, charges: list[dict[str, Any]]) -> int:
        """Upsert charges by their ID; returns how many were new."""
        new = 0
        with self.lock:
            self.conn.execute("BEGIN")
            for c in charges:
                stamp = now()
                found = self.conn.execute(
                    "SELECT 1 FROM amazon_charge WHERE book_id = ? AND id = ?", (book, c["id"])
                ).fetchone()
                if found:
                    self.conn.execute(
                        "UPDATE amazon_charge SET date = ?, amount = ?, payment_method = ?, last4 = ?, "
                        "order_number = ?, seller = ?, order_link = ?, updated_at = ? WHERE book_id = ? AND id = ?",
                        (c["date"], c["amount"], c["payment_method"], c["last4"], c["order_number"],
                         c["seller"], c["order_link"], stamp, book, c["id"]),
                    )
                else:
                    new += 1
                    self.conn.execute(
                        "INSERT INTO amazon_charge (book_id, id, date, amount, payment_method, last4, "
                        "order_number, seller, order_link, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (book, c["id"], c["date"], c["amount"], c["payment_method"], c["last4"],
                         c["order_number"], c["seller"], c["order_link"], stamp, stamp),
                    )
            self.conn.execute("COMMIT")
        return new

    def put_cards(self, book: str, charges: list[dict[str, Any]]) -> None:
        """The cards a sync's charges were on, with how many and the latest's date."""
        seen: dict[str, dict[str, Any]] = {}
        for c in charges:
            if not c["last4"]:
                continue
            card = seen.setdefault(c["last4"], {"label": c["payment_method"], "charges": 0, "last_seen": c["date"]})
            card["charges"] += 1
            card["last_seen"] = max(card["last_seen"], c["date"])
        stamp = now()
        with self.lock:
            for last4, card in seen.items():
                self.conn.execute(
                    "INSERT INTO amazon_card (book_id, last4, label, charges, last_seen, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (book_id, last4) DO UPDATE SET label = excluded.label, "
                    "charges = excluded.charges, last_seen = MAX(COALESCE(last_seen, ''), excluded.last_seen), "
                    "updated_at = excluded.updated_at",
                    (book, last4, card["label"], card["charges"], card["last_seen"], stamp, stamp),
                )

    def cards(self, book: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT last4, label, charges, last_seen FROM amazon_card WHERE book_id = ? ORDER BY last_seen DESC",
            (book,),
        ).fetchall()
        return [dict(r) for r in rows]

    def prune(self, book: str, keep: Any) -> int:
        """Forget charges no longer the book's (`keep(last4)` says), and orders only they had."""
        with self.lock:
            rows = self.conn.execute("SELECT id, last4 FROM amazon_charge WHERE book_id = ?", (book,)).fetchall()
            gone = [r["id"] for r in rows if not keep(r["last4"])]
            self.conn.execute("BEGIN")
            for id in gone:
                self.conn.execute("DELETE FROM amazon_charge WHERE book_id = ? AND id = ?", (book, id))
            self.conn.execute(
                "DELETE FROM amazon_order WHERE book_id = ? AND order_number NOT IN "
                "(SELECT order_number FROM amazon_charge WHERE book_id = ? AND order_number IS NOT NULL)",
                (book, book),
            )
            self.conn.execute("COMMIT")
        return len(gone)

    def order_numbers(self, book: str) -> set[str]:
        rows = self.conn.execute("SELECT order_number FROM amazon_order WHERE book_id = ?", (book,)).fetchall()
        return {r["order_number"] for r in rows}

    def put_order(self, book: str, order_number: str, placed: str | None, data: dict[str, Any]) -> None:
        stamp = now()
        with self.lock:
            self.conn.execute(
                "INSERT INTO amazon_order (book_id, order_number, placed, data, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (book_id, order_number) DO UPDATE SET "
                "placed = excluded.placed, data = excluded.data, updated_at = excluded.updated_at",
                (book, order_number, placed, json.dumps(data), stamp, stamp),
            )

    def charges(self, book: str, limit: int = 500) -> list[dict[str, Any]]:
        """Charges newest first, each with its order (when read)."""
        rows = self.conn.execute(
            "SELECT c.*, o.data AS order_data FROM amazon_charge c LEFT JOIN amazon_order o "
            "ON o.book_id = c.book_id AND o.order_number = c.order_number "
            "WHERE c.book_id = ? ORDER BY c.date DESC, c.id LIMIT ?",
            (book, limit),
        ).fetchall()
        out = []
        for r in rows:
            row = dict(r)
            data = row.pop("order_data")
            row.pop("book_id")
            row["order"] = json.loads(data) if data else None
            out.append(row)
        return out

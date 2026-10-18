"""Schema migrations for the ledger database, applied in order and tracked by SQLite's
`user_version`.

Every table is created through `create_table`, which adds the columns every table must have:
`created_at` and `updated_at`. They're non-null with no defaults, so a write that forgets to set
them fails loudly instead of silently recording nothing. `tests/test_lint.py` fails the build if
`CREATE TABLE` appears anywhere but here.

To change the schema, append a migration; never edit one that has shipped.
"""

from __future__ import annotations

import datetime
import sqlite3
from collections.abc import Callable

TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def create_table(name: str, columns: list[str], constraints: list[str] | None = None) -> str:
    """CREATE TABLE with the required timestamp columns. Table constraints (composite keys and
    the like) go in `constraints`, since SQL wants them after every column."""
    parts = [*columns, "created_at TEXT NOT NULL", "updated_at TEXT NOT NULL", *(constraints or [])]
    return f"CREATE TABLE {name} (\n    " + ",\n    ".join(parts) + "\n)"


def now() -> str:
    """A timestamp: ISO 8601, UTC, microseconds, fixed width, so text order is time order."""
    return datetime.datetime.now(datetime.UTC).strftime(TIMESTAMP_FORMAT)


def after(previous: str | None) -> str:
    """A timestamp strictly later than `previous`.

    `updated_at` is a row's version, so it must change on every write even if the clock hasn't
    moved, or has gone backwards (a Pi has no hardware clock and can jump at boot).
    """
    stamp = now()
    if previous is not None and stamp <= previous:
        later = datetime.datetime.strptime(previous, TIMESTAMP_FORMAT) + datetime.timedelta(microseconds=1)
        stamp = later.strftime(TIMESTAMP_FORMAT)
    return stamp


def _backfill_derived_columns(conn: sqlite3.Connection) -> None:
    """Fill in migration 3's columns for directives written before it."""
    from . import engine  # here, not at the top: engine is only needed for this backfill

    for row in conn.execute("SELECT id, text FROM directive WHERE deleted = 0 AND kind = 'transaction'").fetchall():
        directive = engine.parse_one(row[1], row[0])
        conn.execute("UPDATE directive SET payee = ?, narration = ? WHERE id = ?", (directive.payee, directive.narration, row[0]))
        for idx, p in enumerate(directive.postings):
            conn.execute(
                "UPDATE posting SET amount = ?, amount_currency = ? WHERE directive_id = ? AND idx = ?",
                (None if p.amount is None else str(p.amount), p.amount_currency, row[0], idx),
            )


def _backfill_budgeted(conn: sqlite3.Connection) -> None:
    """Fill in migration 7's column for transactions written before it."""
    from . import engine

    rows = conn.execute(
        "SELECT id, text FROM directive WHERE deleted = 0 AND kind = 'transaction' AND text LIKE '%budget:%'"
    ).fetchall()
    for row in rows:
        directive = engine.parse_one(row[1], row[0])
        conn.execute("UPDATE directive SET budgeted = ? WHERE id = ?", (int(directive.budgeted), row[0]))


def _backfill_reconciled(conn: sqlite3.Connection) -> None:
    """Fill in migration 9's column for postings written before it."""
    from . import engine

    rows = conn.execute(
        "SELECT id, text FROM directive WHERE deleted = 0 AND kind = 'transaction' AND text LIKE '%reconciled:%'"
    ).fetchall()
    for row in rows:
        for idx, p in enumerate(engine.parse_one(row[1], row[0]).postings):
            if p.reconciled:
                conn.execute(
                    "UPDATE posting SET reconciled = ? WHERE directive_id = ? AND idx = ?",
                    (p.reconciled.isoformat(), row[0], idx),
                )


def _backfill_prices(conn: sqlite3.Connection) -> None:
    """Fill in migration 4's price table from the price directives written before it."""
    from . import engine

    for row in conn.execute("SELECT id, book_id, text FROM directive WHERE deleted = 0 AND kind = 'price'").fetchall():
        directive = engine.parse_one(row[2], row[0])
        commodity, number, currency = directive.price
        stamp = now()
        conn.execute(
            "INSERT INTO price (directive_id, book_id, date, commodity, number, currency, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (row[0], row[1], directive.date.isoformat(), commodity, str(number), currency, stamp, stamp),
        )


MIGRATIONS: list[list[str | Callable[[sqlite3.Connection], None]]] = [
    # 1: the baseline.
    [
        create_table(
            "book",
            [
                "id TEXT PRIMARY KEY",
                "header TEXT NOT NULL",  # option/plugin lines, newline-separated
                "seq INTEGER NOT NULL",
            ],
        ),
        create_table(
            "change",
            [
                "seq INTEGER PRIMARY KEY AUTOINCREMENT",  # the backup cursor
                "book_id TEXT NOT NULL",
                "directive_id TEXT",  # NULL for book-level changes
                "op TEXT NOT NULL",  # 'book' | 'put' | 'delete'
            ],
        ),
        create_table(
            "directive",
            [
                "id TEXT PRIMARY KEY",
                "book_id TEXT NOT NULL REFERENCES book(id)",
                "date TEXT NOT NULL",
                "kind TEXT NOT NULL",
                "flag TEXT",
                "ordinal INTEGER NOT NULL",  # tie-breaker within a date, preserving entry order
                "text TEXT",  # NULL once deleted
                "deleted INTEGER NOT NULL DEFAULT 0",
                "seq INTEGER NOT NULL",
            ],
        ),
        "CREATE INDEX directive_live ON directive(book_id, deleted, date, ordinal)",
        "CREATE INDEX directive_seq ON directive(book_id, seq)",
        create_table(
            "posting",
            [
                "directive_id TEXT NOT NULL REFERENCES directive(id) ON DELETE CASCADE",
                "idx INTEGER NOT NULL",
                "account TEXT NOT NULL",
                "number TEXT",  # decimal string; NULL when elided
                "currency TEXT",
            ],
            constraints=["PRIMARY KEY (directive_id, idx)"],
        ),
        "CREATE INDEX posting_account ON posting(account)",
    ],
    # 2: books belong to users (M1). The name lives in the book's own `option "title"`.
    [
        "ALTER TABLE book ADD COLUMN owner_id TEXT",
        "CREATE INDEX book_owner ON book(owner_id)",
    ],
    # 3: what balances and ledgers read with plain SQL (M1): each posting's change to its account
    # (elided amounts filled in where unambiguous), and each transaction's payee and narration.
    [
        "ALTER TABLE posting ADD COLUMN amount TEXT",
        "ALTER TABLE posting ADD COLUMN amount_currency TEXT",
        "ALTER TABLE directive ADD COLUMN payee TEXT",
        "ALTER TABLE directive ADD COLUMN narration TEXT",
        "CREATE INDEX posting_account_directive ON posting(account, directive_id)",
        _backfill_derived_columns,
    ],
    # 4: prices, read with SQL (M5): each price directive's commodity, number and currency, so
    # "the latest price of X" is one indexed query.
    [
        create_table(
            "price",
            [
                "directive_id TEXT PRIMARY KEY REFERENCES directive(id) ON DELETE CASCADE",
                "book_id TEXT NOT NULL",
                "date TEXT NOT NULL",
                "commodity TEXT NOT NULL",
                "number TEXT NOT NULL",
                "currency TEXT NOT NULL",
            ],
        ),
        "CREATE INDEX price_latest ON price(book_id, commodity, currency, date)",
        _backfill_prices,
    ],
    # 5: posting amounts again (M5): an elided amount is now filled in when the others are lots
    # at a known cost or priced (a buy's cash side), as booking would weigh them.
    [_backfill_derived_columns],
    # 6: deleting books (M6). A deleted book keeps its row (and its directives' tombstones), so
    # incremental backups can carry the deletion; nothing else sees it.
    ["ALTER TABLE book ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0"],
    # 7: budgets (M11). A transaction with `budget: FALSE` (a once-in-decades roof) still counts
    # everywhere but against budgets.
    ["ALTER TABLE directive ADD COLUMN budgeted INTEGER NOT NULL DEFAULT 1", _backfill_budgeted],
    # 8: sharing books (M13). Besides its owner, a book has members, each with a role: read,
    # write or manage.
    [
        create_table(
            "book_member",
            ["book_id TEXT NOT NULL REFERENCES book(id)", "user_id TEXT NOT NULL", "role TEXT NOT NULL"],
            ["PRIMARY KEY (book_id, user_id)"],
        ),
        "CREATE INDEX book_member_user ON book_member(user_id)",
    ],
    # 9: reconciliation (M14). Each posting's `reconciled:` mark, the statement date it was
    # reconciled with, so ledgers and reconciling read it with SQL.
    ["ALTER TABLE posting ADD COLUMN reconciled TEXT", _backfill_reconciled],
    # 10: attachments (M16): files a transaction holds (a receipt's photo, say). The bytes are on
    # the data volume beside the database (`attachments/<book>/<id>`); this is what's known of
    # each.
    [
        create_table(
            "attachment",
            [
                "id TEXT PRIMARY KEY",
                "book_id TEXT NOT NULL",
                "directive_id TEXT NOT NULL",
                "filename TEXT NOT NULL",
                "content_type TEXT NOT NULL",
                "size INTEGER NOT NULL",
                "sha256 TEXT NOT NULL",
            ],
        ),
        "CREATE INDEX attachment_directive ON attachment(book_id, directive_id)",
    ],
]


class MigrationError(RuntimeError):
    pass


def migrate(conn: sqlite3.Connection) -> int:
    """Bring the database up to date. Returns the schema version."""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version == 0 and conn.execute("SELECT count(*) FROM sqlite_master WHERE type = 'table'").fetchone()[0]:
        raise MigrationError(
            "this database predates schema migrations. Nothing real was stored before hydration, so recreate it."
        )
    if version > len(MIGRATIONS):
        raise MigrationError(f"this database is at schema {version}, newer than this ledger ({len(MIGRATIONS)})")
    for number, statements in enumerate(MIGRATIONS[version:], start=version + 1):
        conn.execute("BEGIN IMMEDIATE")
        try:
            for statement in statements:
                if callable(statement):
                    statement(conn)
                else:
                    conn.execute(statement)
            conn.execute(f"PRAGMA user_version = {number}")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
    return len(MIGRATIONS)

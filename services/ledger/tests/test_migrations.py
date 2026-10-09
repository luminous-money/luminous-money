import sqlite3

import pytest

from ledger import migrations
from ledger.store import Store


def test_every_table_has_non_null_timestamps(tmp_path):
    store = Store(str(tmp_path / "ledger.sqlite"))
    conn = store._conn
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]

    assert set(tables) >= {"book", "change", "directive", "posting"}
    for table in tables:
        columns = {r["name"]: r for r in conn.execute(f"PRAGMA table_info({table})")}
        for column in ("created_at", "updated_at"):
            assert columns[column]["notnull"] == 1, (table, column)
            assert columns[column]["dflt_value"] is None, (table, column)


def test_migrating_is_idempotent_and_recorded(tmp_path):
    path = str(tmp_path / "ledger.sqlite")
    Store(path)
    Store(path)

    assert sqlite3.connect(path).execute("PRAGMA user_version").fetchone()[0] == len(migrations.MIGRATIONS)


def test_a_database_from_before_migrations_is_refused(tmp_path):
    path = str(tmp_path / "old.sqlite")
    sqlite3.connect(path).execute("CREATE TABLE book (id TEXT)")

    with pytest.raises(migrations.MigrationError, match="predates"):
        Store(path)


def test_versions_always_move_forward_even_if_the_clock_does_not():
    future = "2999-01-01T00:00:00.000000Z"

    assert migrations.after(future) == "2999-01-01T00:00:00.000001Z"
    assert migrations.after(None) < future

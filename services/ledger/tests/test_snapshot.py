"""Whole-system backups: every database and the attachments, copied while open, and restored."""

import io
import json
import os
import sqlite3
import tarfile

import pytest

from ledger import snapshot
from ledger.store import Store


def test_a_backup_holds_every_database_and_the_attachments_and_restores_them(tmp_path):
    data = tmp_path / "data"
    (data / "attachments" / "book").mkdir(parents=True)
    store = Store(str(data / "ledger.sqlite"))  # open, as the running ledger's is
    other = sqlite3.connect(data / "app.sqlite")
    other.execute("CREATE TABLE star (account TEXT)")
    other.execute("INSERT INTO star VALUES ('Assets:Bank:Checking')")
    other.execute("PRAGMA user_version = 3")
    other.commit()
    (data / "attachments" / "book" / "a1").write_bytes(b"a receipt")

    out = io.BytesIO()
    manifest = snapshot.backup(out, str(data))

    assert manifest["databases"] == {"app.sqlite": 3, "ledger.sqlite": store.schema_version()}
    assert json.loads((data / "last-backup.json").read_text())["made_at"] == manifest["made_at"]
    names = tarfile.open(fileobj=io.BytesIO(out.getvalue())).getnames()
    assert names[0] == "manifest.json"
    assert {"data/ledger.sqlite", "data/app.sqlite", "data/attachments/book/a1"} <= set(names)

    # Things change, then the backup comes back.
    other.execute("DELETE FROM star")
    other.commit()
    other.close()
    (data / "attachments" / "book" / "a2").write_bytes(b"after")
    # The host adds its .env to the tar; restoring leaves it out of the volume.
    with_env = io.BytesIO(out.getvalue())
    restored = snapshot.restore(with_env, str(data))

    assert restored == manifest
    rows = sqlite3.connect(data / "app.sqlite").execute("SELECT account FROM star").fetchall()
    assert rows == [("Assets:Bank:Checking",)]
    assert sorted(os.listdir(data / "attachments" / "book")) == ["a1"]
    assert Store(str(data / "ledger.sqlite")).schema_version() == manifest["databases"]["ledger.sqlite"]


def test_restore_refuses_what_isnt_a_backup_before_touching_anything(tmp_path):
    (tmp_path / "app.sqlite").write_bytes(b"kept")
    junk = io.BytesIO()
    with tarfile.open(fileobj=junk, mode="w") as tar:
        info = tarfile.TarInfo("notes.txt")
        tar.addfile(info, io.BytesIO(b""))
    junk.seek(0)

    with pytest.raises(SystemExit, match="not a luminous-money backup"):
        snapshot.restore(junk, str(tmp_path))
    assert (tmp_path / "app.sqlite").read_bytes() == b"kept"

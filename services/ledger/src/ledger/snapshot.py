"""Whole-system backups: every database on the data volume and the attachments, while the
services run. The host's `fava-beans backup` and `restore` run these in a one-off container of
the ledger's image (it has Python's SQLite) on the data volume:

    python -m ledger.snapshot backup  > backup.tar     a tar on standard output
    python -m ledger.snapshot restore < backup.tar     the volume's data replaced by the tar's

- **Consistent, online:** each database (`*.sqlite`) is copied with SQLite's backup API, safe
  while the services read and write it. Attachments are written once and never changed, so
  copying them is enough. Each database is consistent in itself; they're copied one after another,
  which their references to each other (IDs) tolerate.
- **What's in it:** `manifest.json` first (when, which version, each database's schema), then
  `data/<name>.sqlite` and `data/attachments/…`. Anything else in the tar (the host adds its
  `.env`) is left alone by `restore`.
- **Restore** is for a stopped stack (the host's `restore` stops it): it reads the manifest, then
  removes the databases (with their WAL files) and attachments, and unpacks the backup's.
- **A marker:** a backup leaves `last-backup.json` on the volume (when, which version), for the
  system page.
"""

from __future__ import annotations

import datetime
import io
import json
import os
import shutil
import sqlite3
import sys
import tarfile
import tempfile

DATA = os.environ.get("LEDGER_DATA_DIR", "/data")
VERSION = os.environ.get("FAVA_BEANS_VERSION", "dev")
MANIFEST = "manifest.json"
MARKER = "last-backup.json"


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = int(datetime.datetime.now().timestamp())
    tar.addfile(info, io.BytesIO(data))


def backup(out, data: str = DATA) -> dict:
    """Write a backup of `data` to `out` (a binary stream) as a tar; returns its manifest."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    databases = sorted(name for name in os.listdir(data) if name.endswith(".sqlite"))
    with tempfile.TemporaryDirectory() as tmp:
        schemas = {}
        for name in databases:
            source = sqlite3.connect(os.path.join(data, name))
            copy = sqlite3.connect(os.path.join(tmp, name))
            try:
                source.backup(copy)
                schemas[name] = copy.execute("PRAGMA user_version").fetchone()[0]
            finally:
                copy.close()
                source.close()
        manifest = {"made_at": now, "version": VERSION, "databases": schemas}
        with tarfile.open(fileobj=out, mode="w|") as tar:
            _add_bytes(tar, MANIFEST, json.dumps(manifest, indent=2).encode())
            for name in databases:
                tar.add(os.path.join(tmp, name), arcname=f"data/{name}")
            attachments = os.path.join(data, "attachments")
            if os.path.isdir(attachments):
                tar.add(attachments, arcname="data/attachments")
    with open(os.path.join(data, MARKER), "w") as marker:
        json.dump({"made_at": now, "version": VERSION}, marker)
    return manifest


def restore(source, data: str = DATA) -> dict:
    """Replace `data`'s databases and attachments with a backup's, read as a tar from `source`
    (a binary stream). The services must be stopped. Returns the backup's manifest."""
    with tarfile.open(fileobj=source, mode="r|") as tar:
        members = iter(tar)
        first = next(members, None)
        if first is None or first.name != MANIFEST:
            raise SystemExit("not a fava-beans backup: it doesn't start with its manifest")
        manifest = json.load(tar.extractfile(first))
        for name in os.listdir(data):
            if name.endswith((".sqlite", ".sqlite-wal", ".sqlite-shm")) or name == MARKER:
                os.remove(os.path.join(data, name))
        shutil.rmtree(os.path.join(data, "attachments"), ignore_errors=True)
        for member in members:
            if not member.name.startswith("data/"):
                continue  # what the host added (its .env): not the volume's
            member.name = member.name.removeprefix("data/")
            tar.extract(member, data, filter="data")
    return manifest


def main(argv: list[str]) -> None:
    command = argv[1] if len(argv) > 1 else ""
    if command == "backup":
        manifest = backup(sys.stdout.buffer)
    elif command == "restore":
        manifest = restore(sys.stdin.buffer)
    else:
        raise SystemExit("usage: python -m ledger.snapshot backup > backup.tar | restore < backup.tar")
    print(json.dumps(manifest), file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv)

from conftest import FEATURES, STAGED

from ledger.service import Ledger
from ledger.store import Store


def restore(tmp_path, *backups) -> Ledger:
    restored = Ledger(Store(str(tmp_path / "restored.sqlite")))
    for backup in backups:
        for book_id, text in backup.chunks.items():
            restored.apply_text(book_id, text)
    return restored


def test_incremental_backups_restore_to_an_identical_book(ledger, tmp_path):
    ledger.apply_file("book", FEATURES)
    full = ledger.backup()

    staged = ledger.create("book", STAGED)
    doomed = ledger.create("book", STAGED.replace("Coffee", "Muffin"))
    ledger.set_flag("book", staged.id, "*")
    ledger.delete("book", doomed.id)
    first_food = next(r for r in ledger.store.live("book") if "Weekly groceries" in (r.text or ""))
    ledger.update("book", first_food.id, first_food.text.replace("123.45", "120.00").replace("! Assets", "  Assets"))
    increment = ledger.backup(full.cursor)

    restored = restore(tmp_path, full, increment)

    assert restored.export("book") == ledger.export("book")
    assert restored.problems("book") == ledger.problems("book")


def test_increments_carry_only_what_changed(ledger):
    ledger.apply_file("book", FEATURES)
    full = ledger.backup()

    created = ledger.create("book", STAGED)
    increment = ledger.backup(full.cursor)

    chunk = increment.chunks["book"]
    assert created.id in chunk
    assert chunk.count("\n2020-") == 0  # nothing from the original import
    assert increment.cursor > full.cursor


def test_an_unchanged_system_backs_up_nothing(ledger):
    ledger.apply_file("book", FEATURES)
    full = ledger.backup()

    assert ledger.backup(full.cursor).chunks == {}


def test_deletions_travel_as_tombstones(ledger, tmp_path):
    ledger.apply_file("book", FEATURES)
    created = ledger.create("book", STAGED)
    full = ledger.backup()
    ledger.delete("book", created.id)

    increment = ledger.backup(full.cursor)

    assert f'custom "luminous-money" "deleted" "{created.id}"' in increment.chunks["book"]
    assert created.id not in restore(tmp_path, full, increment).export("book")


def test_each_book_backs_up_separately(ledger):
    ledger.apply_file("personal", FEATURES)
    ledger.create_book("shared")

    chunks = ledger.backup().chunks

    assert set(chunks) == {"personal", "shared"}

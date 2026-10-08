"""The API serves requests on a thread pool; the store must be safe under concurrent use."""

from concurrent.futures import ThreadPoolExecutor

from conftest import STAGED

OPENING = 'option "operating_currency" "USD"\n2024-01-01 open Assets:Bank:Checking USD\n2024-01-01 open Expenses:Food\n'


def test_concurrent_books_and_writes_do_not_interfere(ledger):
    def scenario(i: int) -> None:
        book = f"book-{i}"
        ledger.apply_text(book, OPENING)
        created = ledger.create(book, STAGED)
        assert [r.id for r in ledger.store.find(book, flag="!")] == [created.id]
        ledger.set_flag(book, created.id, "*")
        assert ledger.store.find(book, flag="!") == []
        ledger.backup()

    with ThreadPoolExecutor(max_workers=16) as pool:
        for future in [pool.submit(scenario, i) for i in range(64)]:
            future.result()

    assert len(ledger.books()) == 64

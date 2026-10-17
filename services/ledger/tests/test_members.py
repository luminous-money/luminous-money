"""Sharing books (M13): members' roles, enforced on every route."""

from conftest import USER, http

OWNER, READER, WRITER, MANAGER, STRANGER = USER, "reader", "writer", "manager", "stranger"
TEXT = """option "operating_currency" "USD"
2026-01-01 open Assets:Bank USD
2026-01-01 open Expenses:Food
"""
SPEND = {
    "date": "2026-02-01",
    "flag": "*",
    "narration": "Lunch",
    "postings": [
        {"account": "Assets:Bank", "units": {"number": "-12.00", "currency": "USD"}},
        {"account": "Expenses:Food"},
    ],
}


def shared(ledger):
    book = ledger.create_book(name="Ours", owner_id=OWNER, text=TEXT).id
    owner = http(ledger, OWNER)
    for user, role in ((READER, "read"), (WRITER, "write"), (MANAGER, "manage")):
        assert owner.put(f"/api/ledger/v1/books/{book}/members/{user}", json={"role": role}).status_code == 200
    return book


def test_each_role_may_do_what_it_says(ledger):
    book = shared(ledger)
    url = f"/api/ledger/v1/books/{book}"

    as_ = {user: http(ledger, user) for user in (READER, WRITER, MANAGER, STRANGER)}
    assert as_[READER].get(f"{url}/accounts").status_code == 200
    assert as_[READER].post(f"{url}/transactions", json=SPEND).status_code == 403
    assert as_[WRITER].post(f"{url}/transactions", json=SPEND).status_code == 201
    assert as_[STRANGER].get(f"{url}/accounts").status_code == 404
    # Who has access, and the book's name, are a manager's; deleting it, the owner's.
    assert as_[WRITER].put(f"{url}/members/{STRANGER}", json={"role": "read"}).status_code == 403
    version = as_[MANAGER].get(url).json()["updated_at"]
    renamed = as_[MANAGER].patch(url, json={"name": "Our house", "updated_at": version})
    assert renamed.status_code == 200 and renamed.json()["role"] == "manage"
    assert as_[MANAGER].delete(url, params={"updated_at": renamed.json()["updated_at"]}).status_code == 403


def test_shared_books_list_with_the_callers_role(ledger):
    book = shared(ledger)
    ledger.create_book(name="Mine", owner_id=READER)

    listed = {b["name"]: b["role"] for b in http(ledger, READER).get("/api/ledger/v1/books").json()}

    assert listed == {"Ours": "read", "Mine": "owner"}
    assert http(ledger, OWNER).get(f"/api/ledger/v1/books/{book}").json()["role"] == "owner"


def test_members_change_roles_by_version_leave_and_are_removed(ledger):
    book = shared(ledger)
    url = f"/api/ledger/v1/books/{book}/members"
    manager = http(ledger, MANAGER)

    members = {m["user_id"]: m for m in manager.get(url).json()}
    assert [m["role"] for m in members.values()] == ["owner", "read", "write", "manage"]
    read = members[READER]["updated_at"]
    assert manager.put(f"{url}/{READER}", json={"role": "write", "updated_at": read}).status_code == 200
    assert manager.put(f"{url}/{READER}", json={"role": "manage", "updated_at": read}).status_code == 409
    assert manager.put(f"{url}/{OWNER}", json={"role": "read"}).status_code == 409  # the owner's is fixed

    assert http(ledger, WRITER).delete(f"{url}/{WRITER}").status_code == 204  # leaving
    assert manager.delete(f"{url}/{READER}").status_code == 204
    assert http(ledger, READER).get(f"/api/ledger/v1/books/{book}").status_code == 404
    assert http(ledger, OWNER).delete(f"{url}/{OWNER}").status_code == 409

"""Amazon sign-ins are people's (shared connections, 2026-11-24): a manager puts one of their own in
a book, its owner alone sees or changes it and can always take it out, it isn't used once they've
left the book, and a book's own from before becomes its owner's. Called as ASGI, since this
service's tests have no HTTP client."""

import asyncio
import base64
import json
import os
from typing import Any

import pytest

from shops import seal
from shops.api import create_app
from shops.db import Db


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("SHOPS_ENCRYPTION_KEY", base64.b64encode(b"k" * 32).decode())


class Stack:
    def __init__(self, tmp_path):
        self.db = Db(str(tmp_path / "shops.sqlite"))
        self.data = str(tmp_path / "shops")
        self.roles: dict[str, str] = {"kael": "owner", "jess": "manage", "reader": "read"}
        self.app = create_app(self.db, self.data, lambda user, book: self.roles.get(user))

    def call(self, user: str, method: str, path: str, body: Any = None) -> tuple[int, Any]:
        raw = json.dumps(body).encode() if body is not None else b""
        events = [{"type": "http.request", "body": raw, "more_body": False}]
        sent: list[dict] = []
        path, _, query = path.partition("?")

        async def receive():
            return events.pop(0) if events else {"type": "http.disconnect"}

        async def send(event):
            sent.append(event)

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "root_path": "",
            "headers": [(b"x-user-id", user.encode()), (b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())],
            "client": ("test", 1),
            "server": ("test", 80),
        }
        asyncio.run(self.app(scope, receive, send))
        status = sent[0]["status"]
        content = b"".join(e.get("body", b"") for e in sent[1:])
        return status, json.loads(content) if content else None

    def amazon(self, user: str, book: str = "b") -> dict[str, Any]:
        status, body = self.call(user, "GET", f"/api/shops/v1/books/{book}/amazon")
        assert status == 200, body
        return body

    def patch(self, user: str, changes: dict[str, Any], book: str = "b") -> tuple[int, Any]:
        current = self.db.connection(book)
        return self.call(
            user, "PATCH", f"/api/shops/v1/books/{book}/amazon", {"updated_at": current["updated_at"] if current else None, **changes}
        )

    def login(self, user: str, email: str = "kael@example.com") -> dict[str, Any]:
        status, body = self.call(user, "POST", "/api/shops/v1/amazon/logins", {"email": email, "password": "hunter2"})
        assert status == 201, body
        return body


def test_a_manager_puts_their_own_in_a_book_and_only_they_see_which_it_is(tmp_path) -> None:
    s = Stack(tmp_path)
    kaels = s.login("kael")
    assert kaels["books"] == [] and kaels["email"] == "kael@example.com" and kaels["has_password"]
    assert "hunter2" not in json.dumps(kaels)

    assert s.patch("jess", {"login_id": kaels["id"]})[0] == 422  # not hers to put anywhere
    status, saved = s.patch("kael", {"login_id": kaels["id"], "include_cards": ["1234"]})
    assert status == 200, saved
    assert saved["login"] == {"id": kaels["id"], "mine": True, "owner_id": "kael", "email": "kael@example.com", "has_password": True, "has_otp_secret": False}
    assert saved["has_password"] and saved["include_cards"] == ["1234"]

    jess_sees = s.amazon("jess")["login"]
    assert jess_sees["mine"] is False and jess_sees["owner_id"] == "kael" and jess_sees["email"] is None
    assert s.call("kael", "GET", "/api/shops/v1/amazon/logins")[1][0]["books"] == ["b"]
    assert s.call("jess", "GET", "/api/shops/v1/amazon/logins")[1] == []

    # Two books, one sign-in, each with its own cards.
    s.patch("kael", {"login_id": kaels["id"], "include_cards": ["9999"]}, book="personal")
    assert s.call("kael", "GET", "/api/shops/v1/amazon/logins")[1][0]["books"] == ["b", "personal"]
    assert s.amazon("kael", "personal")["include_cards"] == ["9999"]


def test_only_its_owner_changes_it_and_new_credentials_start_its_books_over(tmp_path) -> None:
    s = Stack(tmp_path)
    kaels = s.login("kael")
    s.patch("kael", {"login_id": kaels["id"]})
    s.db.set_status("b", "ok", "Synced.", synced=True)
    s.db.set_read_back("b", "2026-01-01")

    path = f"/api/shops/v1/amazon/logins/{kaels['id']}"
    assert s.call("jess", "PATCH", path, {"updated_at": kaels["updated_at"], "password": "x"})[0] == 404
    status, changed = s.call("kael", "PATCH", path, {"updated_at": kaels["updated_at"], "email": "new@example.com"})
    assert status == 200, changed
    assert s.call("kael", "PATCH", path, {"updated_at": kaels["updated_at"], "password": "y"})[0] == 409
    book = s.db.connection("b")
    assert (book["status"], book["read_back_to"]) == ("new", None)


def test_its_owner_can_always_take_it_out_and_deleting_it_keeps_what_was_read(tmp_path) -> None:
    s = Stack(tmp_path)
    kaels = s.login("kael")
    s.patch("kael", {"login_id": kaels["id"]})
    s.db.put_charges("b", [{"id": "c1", "date": "2026-03-01", "amount": "-5.00", "payment_method": None, "last4": None, "order_number": None, "seller": None, "order_link": None}])

    s.roles["kael"] = "read"  # only reads the book now, but the sign-in is still his
    assert s.patch("kael", {"include_cards": ["1"]})[0] == 403
    assert s.patch("kael", {"login_id": None})[0] == 200
    assert s.amazon("jess")["login"] is None

    s.roles["kael"] = "owner"
    s.patch("kael", {"login_id": kaels["id"]})
    current = s.db.login(kaels["id"])
    status, _ = s.call("kael", "DELETE", f"/api/shops/v1/amazon/logins/{kaels['id']}?updated_at={current['updated_at']}")
    assert status == 204
    assert s.amazon("jess")["login"] is None
    assert [c["id"] for c in s.db.charges("b")] == ["c1"]


def test_it_isnt_used_once_its_owner_has_left_the_book(tmp_path) -> None:
    s = Stack(tmp_path)
    hers = s.login("jess", "jess@example.com")
    s.patch("jess", {"login_id": hers["id"]})
    del s.roles["jess"]
    seen = s.amazon("kael")
    assert seen["login"] is None and not seen["has_password"]
    assert s.db.connection("b")["login_id"] is None


def test_a_books_own_from_before_becomes_its_owners_with_its_session(tmp_path) -> None:
    s = Stack(tmp_path)
    s.db.set_connection("b", {"email": "old@example.com", "password": seal.seal("hunter2"), "include_cards": json.dumps(["1234"])}, None)
    own = os.path.join(s.data, "amazon", "b")
    os.makedirs(os.path.join(own, "invoices"))
    with open(os.path.join(own, "cookies.json"), "w") as f:
        f.write("{}")

    # Anyone else sees it as the book's, as before.
    assert s.amazon("jess")["login"] == {"id": None, "mine": False, "owner_id": None, "email": "old@example.com", "has_password": True, "has_otp_secret": False}
    # Its owner takes it, and its session goes with it; the book's invoices stay.
    seen = s.amazon("kael")
    login = seen["login"]
    assert login["mine"] and login["email"] == "old@example.com" and seen["include_cards"] == ["1234"]
    assert os.path.exists(os.path.join(s.data, "amazon", "logins", login["id"], "cookies.json"))
    assert not os.path.exists(os.path.join(own, "cookies.json"))
    assert os.path.isdir(os.path.join(own, "invoices"))
    row = s.db.connection("b")
    assert (row["email"], row["password"]) == ("", None)
    assert seal.unseal(s.db.login(login["id"])["password"]) == "hunter2"


def test_theyre_forgotten_with_their_owners_account(tmp_path) -> None:
    s = Stack(tmp_path)
    kaels = s.login("kael")
    s.patch("kael", {"login_id": kaels["id"]})
    os.makedirs(os.path.join(s.data, "amazon", "logins", kaels["id"]))
    assert s.call("kael", "DELETE", "/api/shops/v1/me")[0] == 204
    assert s.call("kael", "GET", "/api/shops/v1/amazon/logins")[1] == []
    assert s.amazon("jess")["login"] is None
    assert not os.path.exists(os.path.join(s.data, "amazon", "logins", kaels["id"]))

"""Books belong to users: each user sees and touches only their own."""

from conftest import FEATURES, USER, http

from ledger import engine

OTHER = "user-2"


def test_a_named_book_gets_a_generated_id_and_its_name_as_its_title(ledger):
    client = http(ledger)

    created = client.post("/api/ledger/v1/books", json={"name": 'Kael & Jess "Shared"'})

    book = created.json()
    assert created.status_code == 201
    assert book["name"] == 'Kael & Jess "Shared"'
    assert len(book["id"]) == 32
    assert 'option "title" "Kael & Jess \\"Shared\\""' in client.get(f"/api/ledger/v1/books/{book['id']}/export").text


def test_a_book_exports_as_a_beancount_file_named_for_it_that_restores_it(ledger):
    client = http(ledger)
    book = client.post("/api/ledger/v1/books", json={"name": 'Kael & Jess "Shared"'}).json()

    exported = client.get(f"/api/ledger/v1/books/{book['id']}/export")
    restored = client.post(
        "/api/ledger/v1/books/copy/import", content=exported.text, headers={"content-type": "text/plain"}
    )

    assert exported.headers["content-disposition"] == 'attachment; filename="Kael-Jess-Shared.beancount"'
    assert restored.status_code == 200
    assert client.get("/api/ledger/v1/books/copy").json()["name"] == 'Kael & Jess "Shared"'


def test_users_see_only_their_own_books(ledger):
    mine = http(ledger).post("/api/ledger/v1/books", json={"name": "Mine"}).json()
    theirs = http(ledger, OTHER).post("/api/ledger/v1/books", json={"name": "Theirs"}).json()

    assert [b["name"] for b in http(ledger).get("/api/ledger/v1/books").json()] == ["Mine"]
    assert [b["name"] for b in http(ledger, OTHER).get("/api/ledger/v1/books").json()] == ["Theirs"]
    assert http(ledger).get(f"/api/ledger/v1/books/{mine['id']}").status_code == 200


def test_someone_elses_book_answers_as_if_it_did_not_exist(ledger):
    theirs = http(ledger, OTHER).post("/api/ledger/v1/books", json={"name": "Theirs"}).json()["id"]
    me = http(ledger)

    for response in (
        me.get(f"/api/ledger/v1/books/{theirs}"),
        me.get(f"/api/ledger/v1/books/{theirs}/accounts"),
        me.get(f"/api/ledger/v1/books/{theirs}/transactions"),
        me.get(f"/api/ledger/v1/books/{theirs}/export"),
        me.post(f"/api/ledger/v1/books/{theirs}/import", content="; hello\n", headers={"content-type": "text/plain"}),
        me.patch(f"/api/ledger/v1/books/{theirs}", json={"name": "Mine now", "updated_at": "x"}),
    ):
        assert response.status_code == 404, response.request.url


def test_every_route_needs_a_user(ledger):
    anonymous = http(ledger, None)

    assert anonymous.get("/api/ledger/v1/books").status_code == 401
    assert anonymous.get("/api/ledger/v1/backup").status_code == 401


def test_renaming_is_versioned_and_changes_the_title(ledger):
    client = http(ledger)
    book = client.post("/api/ledger/v1/books", json={"name": "Kael"}).json()

    renamed = client.patch(f"/api/ledger/v1/books/{book['id']}", json={"name": "Kael Personal", "updated_at": book["updated_at"]})
    stale = client.patch(f"/api/ledger/v1/books/{book['id']}", json={"name": "Nope", "updated_at": book["updated_at"]})

    assert renamed.json()["name"] == "Kael Personal"
    assert renamed.json()["updated_at"] > book["updated_at"]
    assert stale.status_code == 409
    assert engine.book_title(ledger.store.header(book["id"])) == "Kael Personal"


def test_importing_into_a_new_book_makes_the_caller_its_owner(ledger):
    with open(FEATURES) as f:
        text = f.read().replace('include "features-prices.beancount"\n', "")

    http(ledger).post("/api/ledger/v1/books/imported/import", content=text, headers={"content-type": "text/plain"})

    assert ledger.owns("imported", USER)
    assert [b["name"] for b in http(ledger).get("/api/ledger/v1/books").json()] == ["Feature fixture"]


def test_backups_carry_only_the_callers_books(ledger):
    http(ledger).post("/api/ledger/v1/books", json={"name": "Mine"})
    http(ledger, OTHER).post("/api/ledger/v1/books", json={"name": "Theirs"})

    chunks = http(ledger).get("/api/ledger/v1/backup").json()["chunks"]

    assert len(chunks) == 1
    assert '"Mine"' in next(iter(chunks.values()))


def test_book_names_are_unique_per_user_ignoring_case(ledger):
    me = http(ledger)
    first = me.post("/api/ledger/v1/books", json={"name": "Household"}).json()
    other = me.post("/api/ledger/v1/books", json={"name": "Personal"}).json()

    assert me.post("/api/ledger/v1/books", json={"name": "household"}).status_code == 422
    assert me.patch(f"/api/ledger/v1/books/{other['id']}", json={"name": "HOUSEHOLD", "updated_at": other["updated_at"]}).status_code == 422
    assert me.patch(f"/api/ledger/v1/books/{first['id']}", json={"name": "household", "updated_at": first["updated_at"]}).status_code == 200
    assert http(ledger, OTHER).post("/api/ledger/v1/books", json={"name": "Household"}).status_code == 201


def _features_text() -> str:
    with open(FEATURES) as f:
        return f.read().replace('include "features-prices.beancount"\n', "")


def test_a_book_created_from_an_export_is_a_copy_under_the_new_name(ledger):
    me = http(ledger)
    me.post("/api/ledger/v1/books/original/import", content=_features_text(), headers={"content-type": "text/plain"})
    exported = me.get("/api/ledger/v1/books/original/export").text

    created = me.post("/api/ledger/v1/books", json={"name": "Restored", "text": exported})

    copy = created.json()["id"]
    assert created.status_code == 201
    assert created.json()["name"] == "Restored"
    original_ids = {r.id for r in ledger.store.live("original")}
    copy_ids = {r.id for r in ledger.store.live(copy)}
    assert len(copy_ids) == len(original_ids) and not copy_ids & original_ids
    assert ledger.problems(copy) == ledger.problems("original")
    assert [b["name"] for b in me.get("/api/ledger/v1/books").json()] == ["Feature fixture", "Restored"]


def test_text_that_does_not_parse_creates_no_book(ledger):
    me = http(ledger)

    created = me.post("/api/ledger/v1/books", json={"name": "Broken", "text": "2024-01-01 open\n"})

    assert created.status_code == 422
    assert me.get("/api/ledger/v1/books").json() == []


def test_deleting_a_book_is_versioned_and_leaves_nothing_behind_but_tombstones(ledger):
    me = http(ledger)
    me.post("/api/ledger/v1/books/doomed/import", content=_features_text(), headers={"content-type": "text/plain"})
    book = me.get("/api/ledger/v1/books/doomed").json()
    full = me.get("/api/ledger/v1/backup").json()
    directives = len(ledger.store.live("doomed"))

    assert me.delete("/api/ledger/v1/books/doomed", params={"updated_at": "stale"}).status_code == 409
    assert http(ledger, OTHER).delete("/api/ledger/v1/books/doomed", params={"updated_at": book["updated_at"]}).status_code == 404
    assert me.delete("/api/ledger/v1/books/doomed", params={"updated_at": book["updated_at"]}).status_code == 204

    assert me.get("/api/ledger/v1/books").json() == []
    assert me.get("/api/ledger/v1/books/doomed").status_code == 404
    assert me.get("/api/ledger/v1/books/doomed/accounts").status_code == 404
    assert me.post("/api/ledger/v1/books/doomed/import", content="; hi\n", headers={"content-type": "text/plain"}).status_code == 404
    assert ledger.store.live("doomed") == []
    assert ledger.store._conn.execute("SELECT count(*) FROM posting p JOIN directive d ON d.id = p.directive_id WHERE d.book_id = 'doomed'").fetchone()[0] == 0
    increment = me.get("/api/ledger/v1/backup", params={"since": full["cursor"]}).json()
    assert increment["deleted_books"] == ["doomed"]
    assert increment["chunks"]["doomed"].count('custom "luminous-money" "deleted"') == directives
    assert me.post("/api/ledger/v1/books", json={"name": "Feature fixture"}).status_code == 201

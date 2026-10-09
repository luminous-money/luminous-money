import pytest
from fastapi.testclient import TestClient

from ledger.api import create_app

LEDGER = """\
option "operating_currency" "USD"
2024-01-01 open Assets:Bank:Checking USD
2024-01-01 open Expenses:Food
"""

STAGED = '2024-03-01 ! "Corner Cafe" "Coffee"\n  Expenses:Food   4.50 USD\n  Assets:Bank:Checking\n'
TEXT = {"content-type": "text/plain"}


@pytest.fixture
def client(ledger):
    return TestClient(create_app(ledger))


def test_review_flow_over_http(client):
    assert client.post("/api/ledger/v1/books/kael/import", content=LEDGER, headers=TEXT).json() == {"put": 2, "deleted": 0}

    created = client.post("/api/ledger/v1/books/kael/directives", content=STAGED, headers=TEXT)
    assert created.status_code == 201
    directive_id = created.json()["id"]

    queue = client.get("/api/ledger/v1/books/kael/directives", params={"flag": "!"}).json()
    assert [d["id"] for d in queue] == [directive_id]

    version = queue[0]["updatedAt"]
    confirmed = client.patch(
        f"/api/ledger/v1/books/kael/transactions/{directive_id}", json={"flag": "*", "updatedAt": version}
    ).json()
    assert confirmed["flag"] == "*"
    assert client.get("/api/ledger/v1/books/kael/problems").json() == []

    result = client.post("/api/ledger/v1/books/kael/query", content="SELECT sum(position) WHERE account ~ 'Food'", headers=TEXT)
    assert result.json()["rows"] == [[["4.50 USD"]]]


def test_errors_map_to_http_statuses(client):
    client.put("/api/ledger/v1/books/kael")

    assert client.get("/api/ledger/v1/books/nobody/export").status_code == 404
    assert client.get("/api/ledger/v1/books/kael/directives/missing").status_code == 404
    assert client.post("/api/ledger/v1/books/kael/directives", content="nonsense", headers=TEXT).status_code == 422
    assert client.put("/api/ledger/v1/books/kael").status_code == 409


def test_backup_endpoint_returns_a_cursor_and_chunks(client):
    client.post("/api/ledger/v1/books/kael/import", content=LEDGER, headers=TEXT)

    full = client.get("/api/ledger/v1/backup").json()
    empty = client.get("/api/ledger/v1/backup", params={"since": full["cursor"]}).json()

    assert set(full["chunks"]) == {"kael"}
    assert empty["chunks"] == {}

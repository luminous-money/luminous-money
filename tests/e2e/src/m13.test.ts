import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

const TEXT = `option "operating_currency" "USD"
2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Expenses:Food
`;
const LUNCH = {
  date: "2026-02-01",
  flag: "*",
  narration: "Lunch",
  postings: [
    { account: "Assets:Bank:Checking", units: { number: "-12.00", currency: "USD" } },
    { account: "Expenses:Food" },
  ],
};

type User = Awaited<ReturnType<typeof newUser>>;
const json = (user: User, path: string, method = "GET", body?: unknown) =>
  user.app(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const spend = (user: User, book: string) =>
  fetch(`${BASE_URL}/api/ledger/v1/books/${book}/transactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
    body: JSON.stringify(LUNCH),
  });

describe("M13: sharing books", () => {
  before(stackIsUp);

  it("shares a book by link, with the role it gives, until they leave", async () => {
    const owner = await newUser();
    const partner = await newUser();
    const created = await json(owner, "/books", "POST", {
      name: "Ours",
      time_zone: "America/Chicago",
      text: TEXT,
    });
    const { id: book } = (await created.json()) as { id: string };
    assert.equal((await spend(partner, book)).status, 404); // not theirs yet

    const invite = (await (
      await json(owner, `/books/${book}/invites`, "POST", { role: "write", label: "Partner" })
    ).json()) as { token: string };
    const seen = (await (await json(partner, `/invites/${invite.token}`)).json()) as {
      book: { name: string };
      role: string;
      state: string;
    };
    assert.deepEqual([seen.book.name, seen.role, seen.state], ["Ours", "write", "open"]);
    assert.equal((await json(partner, `/invites/${invite.token}/accept`, "POST")).status, 200);

    const theirs = (await (await json(partner, "/books")).json()) as { id: string; role: string }[];
    assert.equal(theirs.find((b) => b.id === book)?.role, "write");
    assert.equal((await spend(partner, book)).status, 201);
    // Used once: nobody else gets in with it.
    const stranger = await newUser();
    assert.equal((await json(stranger, `/invites/${invite.token}/accept`, "POST")).status, 409);

    // The owner makes them a reader: they see, but can't change.
    const sharing = (await (await json(owner, `/books/${book}/members`)).json()) as {
      members: { user_id: string; role: string; updated_at: string; email: string | null }[];
    };
    assert.deepEqual(
      sharing.members.map((m) => m.role),
      ["owner", "write"]
    );
    const them = sharing.members[1]!;
    assert.ok(them.email);
    assert.equal(
      (
        await json(owner, `/books/${book}/members/${them.user_id}`, "PATCH", {
          role: "read",
          updated_at: them.updated_at,
        })
      ).status,
      200
    );
    assert.equal((await spend(partner, book)).status, 403);
    assert.equal((await json(partner, `/books/${book}/rules`, "POST", {})).status, 403);
    assert.equal((await json(partner, `/books/${book}/members`)).status, 200);
    assert.equal(
      (await json(partner, `/books/${book}/invites`, "POST", { role: "read" })).status,
      403
    );

    // They leave: the book is gone for them.
    assert.equal(
      (await json(partner, `/books/${book}/members/${them.user_id}`, "DELETE")).status,
      204
    );
    assert.equal((await json(partner, `/books/${book}/members`)).status, 404);
  });

  it("lets a manager invite and remove, but only the owner delete", async () => {
    const owner = await newUser();
    const manager = await newUser();
    const created = await json(owner, "/books", "POST", { name: "Ours", time_zone: "UTC" });
    const book = (await created.json()) as { id: string; updated_at: string };
    const invite = (await (
      await json(owner, `/books/${book.id}/invites`, "POST", { role: "manage" })
    ).json()) as { token: string };
    await json(manager, `/invites/${invite.token}/accept`, "POST");

    const next = (await (
      await json(manager, `/books/${book.id}/invites`, "POST", { role: "read" })
    ).json()) as {
      id: string;
    };
    assert.ok(next.id);
    assert.equal(
      (await json(manager, `/books/${book.id}/invites/${next.id}`, "DELETE")).status,
      204
    );
    assert.equal(
      (
        await json(
          manager,
          `/books/${book.id}?updated_at=${encodeURIComponent(book.updated_at)}`,
          "DELETE"
        )
      ).status,
      403
    );
  });
});

/** M16 through the real stack: a book's AI settings (its key kept secret), and receipts read by
 * the fake provider into unconfirmed transactions with the receipt attached, or made without AI. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

type User = Awaited<ReturnType<typeof newUser>>;
const CARD = "Liabilities:Amazon-Visa";
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const ai = (user: User, path: string, method = "GET", body?: unknown) =>
  fetch(`${BASE_URL}/api/ai/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function bookFor(user: User) {
  const created = await user.app("/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Ours",
      time_zone: "UTC",
      text: `option "operating_currency" "USD"
2026-01-01 open ${CARD} USD
2026-01-01 open Expenses:Groceries
2026-01-01 open Expenses:Household
`,
    }),
  });
  return ((await created.json()) as { id: string }).id;
}

async function capture(user: User, book: string, hints: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new Blob([PHOTO], { type: "image/jpeg" }), "jewel.jpg");
  for (const [k, v] of Object.entries(hints)) form.set(k, v);
  const response = await user.app(`/books/${book}/receipts`, { method: "POST", body: form });
  assert.equal(response.status, 201);
  return (await response.json()) as { transaction_id: string; read: boolean; note: string | null };
}

describe("M16: receipt capture", () => {
  before(stackIsUp);

  it("keeps a book's AI settings, its key sealed and never sent back", async () => {
    const user = await newUser();
    const book = await bookFor(user);
    const health = (await (await ai(user, "/health")).json()) as { providers: string[] };
    assert.deepEqual(health.providers.sort(), ["claude", "fake"]);

    const start = (await (await ai(user, `/books/${book}/settings`)).json()) as {
      ready: boolean;
      updated_at: string | null;
    };
    assert.deepEqual([start.ready, start.updated_at], [false, null]);
    const keyed = await ai(user, `/books/${book}/credential`, "PUT", {
      api_key: "sk-ant-not-real-9876",
    });
    const text = await keyed.text();
    assert.doesNotMatch(text, /not-real/);
    assert.match(text, /"hint":"9876"/);
    // Someone else's book: not found.
    const stranger = await newUser();
    assert.equal((await ai(stranger, `/books/${book}/settings`)).status, 404);
  });

  it("reads a receipt into an unconfirmed transaction, itemized, with the receipt attached", async () => {
    const user = await newUser();
    const book = await bookFor(user);
    const settings = (await (await ai(user, `/books/${book}/settings`)).json()) as {
      updated_at: string | null;
    };
    await ai(user, `/books/${book}/settings`, "PATCH", {
      updated_at: settings.updated_at,
      enabled: true,
      provider: "fake",
      itemize: true,
    });

    const captured = await capture(user, book, { account: CARD });
    assert.equal(captured.read, true);

    const { data: t } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      {
        params: { path: { book_id: book, directive_id: captured.transaction_id } },
      }
    );
    assert.equal(t!.flag, "!");
    assert.equal(t!.attachments, 1);
    assert.deepEqual(
      t!.postings.map((p) => [p.account, p.units?.number]),
      [
        [CARD, "-12.34"],
        ["Expenses:Groceries", "6.17"],
        ["Expenses:Groceries", "6.17"],
      ]
    );
    const { data: files } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}/attachments",
      { params: { path: { book_id: book, directive_id: captured.transaction_id } } }
    );
    const file = await fetch(
      `${BASE_URL}/api/ledger/v1/books/${book}/attachments/${files![0]!.id}`,
      {
        headers: { authorization: `Bearer ${user.token}` },
      }
    );
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PHOTO);
  });

  it("makes one from what you typed when the book has no AI", async () => {
    const user = await newUser();
    const book = await bookFor(user);

    const captured = await capture(user, book, { account: CARD, total: "-8.50", payee: "Cafe" });

    assert.equal(captured.read, false);
    const { data: t } = await user.ledger.GET(
      "/api/ledger/v1/books/{book_id}/transactions/{directive_id}",
      {
        params: { path: { book_id: book, directive_id: captured.transaction_id } },
      }
    );
    assert.deepEqual(
      [t!.payee, t!.postings[0]!.account, t!.postings[0]!.units?.number],
      ["Cafe", CARD, "-8.50"]
    );
    assert.equal(t!.attachments, 1);
  });
});

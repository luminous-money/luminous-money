/** M16 through the real stack: a book's AI settings (its key kept secret); receipts extracted
 * and categorized by the fake provider into unconfirmed transactions, paid by the account
 * holding their card, with the receipt attached, or made without AI; accounts' cards; and split
 * flags, from staging to confirming. */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BASE_URL, newUser, stackIsUp } from "./support.ts";

type User = Awaited<ReturnType<typeof newUser>>;
const CARD = "Liabilities:Fidelity-Visa";
const CHECKING = "Assets:Bank:Checking";
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
2026-01-01 open ${CHECKING} USD
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

/** Set an account's cards; the response. */
async function setCards(user: User, book: string, account: string, cards: object[]) {
  const { data: accounts } = await user.ledger.GET("/api/ledger/v1/books/{book_id}/accounts", {
    params: { path: { book_id: book } },
  });
  const updated_at = accounts!.find((a) => a.name === account)!.updated_at!;
  return user.ledger.PATCH("/api/ledger/v1/books/{book_id}/accounts/{account}", {
    params: { path: { book_id: book, account } },
    body: { updated_at, cards: cards as never },
  });
}

const transaction = async (user: User, book: string, id: string) =>
  (
    await user.ledger.GET("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
      params: { path: { book_id: book, directive_id: id } },
    })
  ).data!;

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

  it("reads a receipt into an unconfirmed transaction, paid by its card, itemized, attached", async () => {
    const user = await newUser();
    const book = await bookFor(user);
    // The fake provider's receipts are paid with the Visa ending 4242: this card's.
    const carded = await setCards(user, book, CARD, [
      { brand: "visa", last_four: "4242" },
      { brand: "visa", last_four: "0417" },
    ]);
    assert.equal(carded.response.status, 200);
    const settings = (await (await ai(user, `/books/${book}/settings`)).json()) as {
      updated_at: string | null;
    };
    await ai(user, `/books/${book}/settings`, "PATCH", {
      updated_at: settings.updated_at,
      enabled: true,
      provider: "fake",
      itemize: true,
    });

    // From checking's page (the hint), but the card says the Visa paid.
    const captured = await capture(user, book, { account: CHECKING });
    assert.equal(captured.read, true);

    const t = await transaction(user, book, captured.transaction_id);
    assert.equal(t.flag, "!");
    assert.equal(t.attachments, 1);
    assert.deepEqual(
      t.postings.map((p) => [p.account, p.units?.number, p.flag ?? null, p.meta?.memo ?? null]),
      [
        [CARD, "-12.34", null, null],
        ["Expenses:Groceries", "6.17", "!", "FIRST ITEM"],
        ["Expenses:Groceries", "6.17", "!", "SECOND ITEM"],
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

  it("keeps a card on one account only", async () => {
    const user = await newUser();
    const book = await bookFor(user);
    await setCards(user, book, CARD, [{ brand: "visa", last_four: "4242" }]);
    const again = await setCards(user, book, CHECKING, [{ last_four: "4242" }]);
    assert.equal(again.response.status, 422);
  });

  it("stages an import's other side as a split to confirm, and confirming confirms it", async () => {
    const user = await newUser();
    const book = await bookFor(user);
    await user.app(`/books/${book}/profiles/${encodeURIComponent(CHECKING)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        {
          delimiter: ",",
          skip: 0,
          header: true,
          columns: ["Date", "Description", "Amount"],
          date: { column: 0, format: "MM/DD/YYYY" },
          amount: { kind: "signed", column: 2, negate: false },
          description: 1,
          payee: null,
          id: null,
          balance: null,
        },
      ]),
    });
    const form = new FormData();
    form.set("account", CHECKING);
    form.set(
      "file",
      new Blob(["Date,Description,Amount\n01/05/2026,Coffee,-12.00\n"], { type: "text/csv" }),
      "jan.csv"
    );
    const imported = (await (
      await user.app(`/books/${book}/imports`, { method: "POST", body: form })
    ).json()) as { rows: { transaction_id: string }[] };
    const id = imported.rows[0]!.transaction_id;
    const staged = await transaction(user, book, id);
    assert.deepEqual(
      staged.postings.map((p) => p.flag ?? null),
      [null, "!"]
    );

    await user.ledger.PATCH("/api/ledger/v1/books/{book_id}/transactions/{directive_id}", {
      params: { path: { book_id: book, directive_id: id } },
      body: { updated_at: staged.updated_at, flag: "*" },
    });
    const confirmed = await transaction(user, book, id);
    assert.deepEqual(
      [confirmed.flag, ...confirmed.postings.map((p) => p.flag ?? null)],
      ["*", null, null]
    );
  });

  it("makes one from what you typed when the book has no AI", async () => {
    const user = await newUser();
    const book = await bookFor(user);

    const captured = await capture(user, book, { account: CARD, total: "-8.50", payee: "Cafe" });

    assert.equal(captured.read, false);
    const t = await transaction(user, book, captured.transaction_id);
    assert.deepEqual(
      [t.payee, t.postings[0]!.account, t.postings[0]!.units?.number],
      ["Cafe", CARD, "-8.50"]
    );
    assert.equal(t.attachments, 1);
  });
});
